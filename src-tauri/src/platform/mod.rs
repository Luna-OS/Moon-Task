//! Everything that differs between Windows, Linux and macOS and that
//! `sysinfo` doesn't cover: ending, suspending and re-prioritizing
//! processes, and the deeper per-process views (threads, modules, open
//! handles).
//!
//! Every public function exists on every platform with the same
//! signature. Where a platform can't do something, it returns `None` (for
//! views — the UI shows "not available on this platform") or an error
//! message (for actions), never a silent no-op.

use crate::models::{HandleRow, ModuleRow, Priority, ThreadRow};
use std::collections::HashMap;
use std::path::Path;

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(any(target_os = "linux", test))]
pub mod procfs;
#[cfg(unix)]
mod unix;
#[cfg(windows)]
mod windows;

#[cfg(target_os = "linux")]
use linux as os;
#[cfg(target_os = "macos")]
use macos as os;
#[cfg(windows)]
use windows as os;

#[cfg(unix)]
use unix as family;
#[cfg(windows)]
use windows as family;

pub fn platform_name() -> &'static str {
    if cfg!(windows) {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "linux"
    }
}

/// Ends a process. `force = false` asks it to quit (SIGTERM) so it can
/// save its state; `force = true` kills it outright (SIGKILL). Windows has
/// no polite variant for arbitrary processes, so both terminate there.
pub fn terminate(pid: u32, force: bool) -> Result<(), String> {
    family::terminate(pid, force)
}

/// Freezes every thread of a process until [`resume`] is called.
pub fn suspend(pid: u32) -> Result<(), String> {
    family::suspend(pid)
}

pub fn resume(pid: u32) -> Result<(), String> {
    family::resume(pid)
}

/// The current priority, plus the raw nice value on Unix.
pub fn priority(pid: u32) -> Option<(Priority, Option<i32>)> {
    family::priority(pid)
}

pub fn set_priority(pid: u32, priority: Priority) -> Result<(), String> {
    if priority == Priority::Realtime {
        return Err(
            "MoonTask never sets realtime priority — it can freeze the whole system".into(),
        );
    }
    family::set_priority(pid, priority)
}

/// Thread counts for platforms where `sysinfo` doesn't report them
/// (Windows, macOS). Empty on Linux, where the monitor takes them from
/// `sysinfo`'s task lists instead.
pub fn thread_counts(pids: &[u32]) -> HashMap<u32, u32> {
    os::thread_counts(pids)
}

pub fn threads(pid: u32) -> Option<Vec<ThreadRow>> {
    os::threads(pid)
}

pub fn modules(pid: u32) -> Option<Vec<ModuleRow>> {
    os::modules(pid)
}

pub fn handles(pid: u32) -> Option<Vec<HandleRow>> {
    os::handles(pid)
}

/// Opens the platform's file manager with `path` selected.
pub fn reveal_in_file_manager(path: &Path) -> Result<(), String> {
    os::reveal_in_file_manager(path)
}

/// The six priority steps on the nice scale (-20 = most CPU, 19 = least).
/// Kept here, not in `unix`, so the mapping is unit-tested everywhere.
#[cfg_attr(windows, allow(dead_code))]
pub(crate) fn nice_for(priority: Priority) -> i32 {
    match priority {
        Priority::Idle => 19,
        Priority::BelowNormal => 10,
        Priority::Normal => 0,
        Priority::AboveNormal => -10,
        Priority::High | Priority::Realtime => -15,
    }
}

#[cfg_attr(windows, allow(dead_code))]
pub(crate) fn priority_for_nice(nice: i32) -> Priority {
    match nice {
        15.. => Priority::Idle,
        5..=14 => Priority::BelowNormal,
        -4..=4 => Priority::Normal,
        -14..=-5 => Priority::AboveNormal,
        _ => Priority::High,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nice_mapping_round_trips() {
        for p in [
            Priority::Idle,
            Priority::BelowNormal,
            Priority::Normal,
            Priority::AboveNormal,
            Priority::High,
        ] {
            assert_eq!(priority_for_nice(nice_for(p)), p);
        }
    }

    #[test]
    fn nice_extremes_map_to_the_outer_steps() {
        assert_eq!(priority_for_nice(19), Priority::Idle);
        assert_eq!(priority_for_nice(-20), Priority::High);
        assert_eq!(priority_for_nice(1), Priority::Normal);
    }

    #[test]
    fn realtime_is_refused() {
        assert!(set_priority(std::process::id(), Priority::Realtime).is_err());
    }
}
