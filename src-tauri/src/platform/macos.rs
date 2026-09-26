//! macOS: thread counts through libproc. Thread, module and handle lists
//! would need `task_for_pid`, which Apple reserves for debuggers and
//! root, so those views say "not available" for now.

use crate::models::{HandleRow, ModuleRow, ThreadRow};
use std::collections::HashMap;
use std::path::Path;
use std::process::Command;

pub fn thread_counts(pids: &[u32]) -> HashMap<u32, u32> {
    pids.iter()
        .filter_map(|&pid| thread_count(pid).map(|n| (pid, n)))
        .collect()
}

fn thread_count(pid: u32) -> Option<u32> {
    let mut info: libc::proc_taskinfo = unsafe { std::mem::zeroed() };
    let size = std::mem::size_of::<libc::proc_taskinfo>() as libc::c_int;
    // SAFETY: `info` is a properly sized, writable proc_taskinfo buffer.
    let written = unsafe {
        libc::proc_pidinfo(
            pid as libc::c_int,
            libc::PROC_PIDTASKINFO,
            0,
            &mut info as *mut _ as *mut libc::c_void,
            size,
        )
    };
    (written == size).then(|| info.pti_threadnum.max(0) as u32)
}

pub fn threads(_pid: u32) -> Option<Vec<ThreadRow>> {
    None
}

pub fn modules(_pid: u32) -> Option<Vec<ModuleRow>> {
    None
}

pub fn handles(_pid: u32) -> Option<Vec<HandleRow>> {
    None
}

pub fn reveal_in_file_manager(path: &Path) -> Result<(), String> {
    Command::new("open")
        .arg("-R")
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("could not open Finder: {e}"))
}
