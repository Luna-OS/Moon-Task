//! Acting on processes: end, kill, end tree, suspend, resume, priority.
//!
//! Every request names the process by PID *and* start time, is re-checked
//! against the live system right before it runs, and passes through
//! [`guard::assess`]: protected processes are refused outright, and
//! anything that isn't the user's own business needs an explicit
//! confirmation — decided here, never by the frontend alone.

pub mod guard;

use crate::models::Priority;
use crate::monitor::Monitor;
use crate::platform;
use guard::Risk;
use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ProcessAction {
    /// Ask to quit (SIGTERM; TerminateProcess on Windows).
    Terminate,
    /// End immediately (SIGKILL).
    Kill,
    /// Kill the process and everything it started.
    KillTree,
    Suspend,
    Resume,
    SetPriority {
        priority: Priority,
    },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionRequest {
    pub pid: u32,
    /// The start time the UI saw. A mismatch means the PID now belongs to
    /// a different process, which must not be touched.
    pub start_time: u64,
    pub action: ProcessAction,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionOutcome {
    /// How many processes the action reached (more than one for trees).
    pub affected: u32,
    /// Descendants that couldn't be ended, as "name (pid): reason".
    pub failures: Vec<String>,
}

#[derive(Debug, Error, PartialEq)]
pub enum ControlError {
    #[error("the process has already exited")]
    Gone,
    #[error("{0}")]
    Forbidden(String),
    #[error("this action needs an explicit confirmation")]
    ConfirmationRequired,
    #[error("{0}")]
    Failed(String),
}

pub fn execute(
    monitor: &mut Monitor,
    request: &ActionRequest,
    confirmed: bool,
) -> Result<ActionOutcome, ControlError> {
    let target = monitor.target(request.pid).ok_or(ControlError::Gone)?;
    if target.start_time != request.start_time {
        return Err(ControlError::Gone);
    }
    match guard::assess(&request.action, &target) {
        Risk::Forbidden(reason) => return Err(ControlError::Forbidden(reason)),
        Risk::High if !confirmed => return Err(ControlError::ConfirmationRequired),
        Risk::High | Risk::Low => {}
    }

    let pid = target.pid;
    let single = |result: Result<(), String>| {
        result
            .map(|_| ActionOutcome {
                affected: 1,
                failures: Vec::new(),
            })
            .map_err(ControlError::Failed)
    };
    match request.action {
        ProcessAction::Terminate => single(platform::terminate(pid, false)),
        ProcessAction::Kill => single(platform::terminate(pid, true)),
        ProcessAction::Suspend => single(platform::suspend(pid)),
        ProcessAction::Resume => single(platform::resume(pid)),
        ProcessAction::SetPriority { priority } => single(platform::set_priority(pid, priority)),
        ProcessAction::KillTree => {
            let mut outcome = ActionOutcome {
                affected: 0,
                failures: Vec::new(),
            };
            for child in monitor.descendants(pid) {
                if child.protected {
                    outcome.failures.push(format!(
                        "{} ({}): protected, left running",
                        child.name, child.pid
                    ));
                    continue;
                }
                match platform::terminate(child.pid, true) {
                    Ok(()) => outcome.affected += 1,
                    Err(e) => outcome
                        .failures
                        .push(format!("{} ({}): {e}", child.name, child.pid)),
                }
            }
            platform::terminate(pid, true).map_err(ControlError::Failed)?;
            outcome.affected += 1;
            Ok(outcome)
        }
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::process::{Child, Command};
    use std::time::Duration;

    fn sleeper() -> Child {
        Command::new("sleep").arg("30").spawn().unwrap()
    }

    fn request(monitor: &mut Monitor, pid: u32, action: ProcessAction) -> ActionRequest {
        let start_time = monitor.target(pid).unwrap().start_time;
        ActionRequest {
            pid,
            start_time,
            action,
        }
    }

    #[test]
    fn ends_an_own_process_without_confirmation() {
        let mut child = sleeper();
        let mut monitor = Monitor::new();
        let req = request(&mut monitor, child.id(), ProcessAction::Terminate);
        let outcome = execute(&mut monitor, &req, false).unwrap();
        assert_eq!(outcome.affected, 1);
        let status = child.wait().unwrap();
        assert!(!status.success());
    }

    #[test]
    fn suspends_and_resumes() {
        let mut child = sleeper();
        let mut monitor = Monitor::new();
        let pid = child.id();
        let req = request(&mut monitor, pid, ProcessAction::Suspend);
        execute(&mut monitor, &req, false).unwrap();
        std::thread::sleep(Duration::from_millis(100));
        let req = request(&mut monitor, pid, ProcessAction::Resume);
        execute(&mut monitor, &req, false).unwrap();
        child.kill().unwrap();
        child.wait().unwrap();
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn a_priority_change_reaches_every_thread() {
        // python3 is on every CI runner and on any desktop Linux.
        let mut child = Command::new("python3")
            .args([
                "-c",
                "import threading,time\n\
                 [threading.Thread(target=time.sleep,args=(30,)).start() for _ in range(3)]\n\
                 time.sleep(30)",
            ])
            .spawn()
            .unwrap();
        let pid = child.id();
        std::thread::sleep(Duration::from_millis(500));
        let mut monitor = Monitor::new();
        let req = request(
            &mut monitor,
            pid,
            ProcessAction::SetPriority {
                priority: Priority::BelowNormal,
            },
        );
        execute(&mut monitor, &req, false).unwrap();
        let threads = platform::threads(pid).unwrap();
        assert!(threads.len() >= 4, "{threads:?}");
        assert!(
            threads.iter().all(|t| t.priority == Some(10)),
            "{threads:?}"
        );
        child.kill().unwrap();
        child.wait().unwrap();
    }

    #[test]
    fn lowers_the_priority_of_an_own_process() {
        let mut child = sleeper();
        let mut monitor = Monitor::new();
        let pid = child.id();
        let req = request(
            &mut monitor,
            pid,
            ProcessAction::SetPriority {
                priority: Priority::Idle,
            },
        );
        execute(&mut monitor, &req, false).unwrap();
        assert_eq!(platform::priority(pid).unwrap().0, Priority::Idle);
        child.kill().unwrap();
        child.wait().unwrap();
    }

    #[test]
    fn refuses_a_reused_pid() {
        let mut child = sleeper();
        let mut monitor = Monitor::new();
        let mut req = request(&mut monitor, child.id(), ProcessAction::Kill);
        req.start_time += 1;
        assert_eq!(
            execute(&mut monitor, &req, false).unwrap_err(),
            ControlError::Gone
        );
        child.kill().unwrap();
        child.wait().unwrap();
    }

    #[test]
    fn refuses_to_end_itself() {
        let mut monitor = Monitor::new();
        let req = request(&mut monitor, std::process::id(), ProcessAction::Kill);
        assert!(matches!(
            execute(&mut monitor, &req, true),
            Err(ControlError::Forbidden(_))
        ));
    }

    #[test]
    fn a_tree_kill_needs_confirmation_and_ends_the_children() {
        let mut parent = Command::new("sh")
            .args(["-c", "sleep 30 & sleep 30 & wait"])
            .spawn()
            .unwrap();
        std::thread::sleep(Duration::from_millis(200));
        let mut monitor = Monitor::new();
        let pid = parent.id();
        let req = request(&mut monitor, pid, ProcessAction::KillTree);
        assert_eq!(
            execute(&mut monitor, &req, false).unwrap_err(),
            ControlError::ConfirmationRequired
        );
        let outcome = execute(&mut monitor, &req, true).unwrap();
        assert_eq!(outcome.affected, 3, "sh and both sleeps: {outcome:?}");
        assert!(outcome.failures.is_empty());
        parent.wait().unwrap();
    }
}
