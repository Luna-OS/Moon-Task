//! Process control shared by Linux and macOS: signals and nice values.

use super::{nice_for, priority_for_nice};
use crate::models::Priority;
use std::io;

fn pid_t(pid: u32) -> Result<libc::pid_t, String> {
    // pid 0 and "negative" pids address process groups in kill(2) — never
    // what the user clicked on.
    match libc::pid_t::try_from(pid) {
        Ok(p) if p > 0 => Ok(p),
        _ => Err(format!("invalid process id {pid}")),
    }
}

fn describe(err: io::Error) -> String {
    match err.raw_os_error() {
        Some(libc::EPERM) | Some(libc::EACCES) => {
            "permission denied — the process belongs to another user (run MoonTask as root to manage it)"
                .into()
        }
        Some(libc::ESRCH) => "the process no longer exists".into(),
        _ => err.to_string(),
    }
}

fn signal(pid: u32, sig: libc::c_int) -> Result<(), String> {
    let pid = pid_t(pid)?;
    // SAFETY: kill(2) takes plain integers and has no memory effects.
    if unsafe { libc::kill(pid, sig) } == 0 {
        Ok(())
    } else {
        Err(describe(io::Error::last_os_error()))
    }
}

pub fn terminate(pid: u32, force: bool) -> Result<(), String> {
    signal(pid, if force { libc::SIGKILL } else { libc::SIGTERM })
}

pub fn suspend(pid: u32) -> Result<(), String> {
    signal(pid, libc::SIGSTOP)
}

pub fn resume(pid: u32) -> Result<(), String> {
    signal(pid, libc::SIGCONT)
}

fn clear_errno() {
    // SAFETY: both return a valid pointer to this thread's errno.
    unsafe {
        #[cfg(target_os = "linux")]
        {
            *libc::__errno_location() = 0;
        }
        #[cfg(target_os = "macos")]
        {
            *libc::__error() = 0;
        }
    }
}

pub fn priority(pid: u32) -> Option<(Priority, Option<i32>)> {
    let pid = pid_t(pid).ok()?;
    // getpriority(2) may legitimately return -1, so errno is the only way
    // to tell an error apart.
    clear_errno();
    // SAFETY: plain integer arguments. The `as _` casts cover the
    // differing `which`/`who` parameter types between libc targets.
    let nice = unsafe { libc::getpriority(libc::PRIO_PROCESS as _, pid as _) };
    if nice == -1 && io::Error::last_os_error().raw_os_error().unwrap_or(0) != 0 {
        return None;
    }
    Some((priority_for_nice(nice), Some(nice)))
}

pub fn set_priority(pid: u32, priority: Priority) -> Result<(), String> {
    let nice = nice_for(priority);
    set_nice(pid_t(pid)?, nice)?;
    // On Linux a nice value belongs to a single thread, and setpriority(2)
    // on a PID only reaches the main one — a browser's workers would keep
    // running at full priority. Apply it to every thread of the process.
    #[cfg(target_os = "linux")]
    for tid in std::fs::read_dir(format!("/proc/{pid}/task"))
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| e.file_name().to_str()?.parse::<libc::pid_t>().ok())
    {
        // Threads may exit meanwhile; the main thread's result counts.
        let _ = set_nice(tid, nice);
    }
    Ok(())
}

fn set_nice(pid: libc::pid_t, nice: i32) -> Result<(), String> {
    // SAFETY: plain integer arguments, see `priority`.
    let rc = unsafe { libc::setpriority(libc::PRIO_PROCESS as _, pid as _, nice) };
    if rc == 0 {
        return Ok(());
    }
    let err = io::Error::last_os_error();
    if err.raw_os_error() == Some(libc::EACCES) {
        return Err("raising a priority needs root rights — lowering it works without".into());
    }
    Err(describe(err))
}
