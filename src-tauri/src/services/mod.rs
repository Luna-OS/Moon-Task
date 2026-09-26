//! System services: list them, and start/stop/restart one.
//!
//! Every service change counts as high risk — a stopped service can take
//! networking, sound or the login screen with it — so it always needs the
//! user's explicit confirmation, and the name must be one the service
//! manager itself just listed.

pub mod launchd;
pub mod scm;
pub mod systemd;

use crate::models::{Service, ServiceAction};

#[cfg(target_os = "macos")]
use launchd as manager;
#[cfg(windows)]
use scm as manager;
#[cfg(target_os = "linux")]
use systemd as manager;

pub fn list() -> Result<Vec<Service>, String> {
    manager::list()
}

pub fn control(name: &str, action: ServiceAction, confirmed: bool) -> Result<(), String> {
    if !confirmed {
        return Err("changing a service needs an explicit confirmation".into());
    }
    // Only names the manager reported are accepted: nothing from the UI
    // reaches a command line unchecked.
    if !list()?.iter().any(|s| s.name == name) {
        return Err(format!("unknown service {name}"));
    }
    manager::control(name, action)
}

#[cfg(unix)]
fn run(program: &str, args: &[&str]) -> Result<String, String> {
    let mut command = std::process::Command::new(program);
    command.args(args);
    output(command, program)
}

fn output(mut command: std::process::Command, program: &str) -> Result<String, String> {
    let out = command
        .output()
        .map_err(|e| format!("could not run {program}: {e}"))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    } else {
        let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
        Err(if stderr.is_empty() {
            format!("{program} failed ({})", out.status)
        } else {
            stderr
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refuses_without_confirmation() {
        assert!(control("anything", ServiceAction::Stop, false).is_err());
    }
}
