//! Windows: process control through the Win32 API, thread and module
//! lists through ToolHelp snapshots.

use crate::models::{HandleRow, ModuleRow, Priority, ThreadRow};
use std::collections::HashMap;
use std::os::windows::process::CommandExt;
use std::path::Path;
use std::process::Command;
use windows_sys::Win32::Foundation::{
    CloseHandle, GetLastError, ERROR_ACCESS_DENIED, ERROR_INVALID_PARAMETER, HANDLE,
    INVALID_HANDLE_VALUE,
};
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Module32FirstW, Module32NextW, Process32FirstW, Process32NextW,
    Thread32First, Thread32Next, MODULEENTRY32W, PROCESSENTRY32W, TH32CS_SNAPMODULE,
    TH32CS_SNAPMODULE32, TH32CS_SNAPPROCESS, TH32CS_SNAPTHREAD, THREADENTRY32,
};
use windows_sys::Win32::System::Threading::{
    GetPriorityClass, OpenProcess, SetPriorityClass, TerminateProcess, ABOVE_NORMAL_PRIORITY_CLASS,
    BELOW_NORMAL_PRIORITY_CLASS, HIGH_PRIORITY_CLASS, IDLE_PRIORITY_CLASS, NORMAL_PRIORITY_CLASS,
    PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SET_INFORMATION, PROCESS_SUSPEND_RESUME,
    PROCESS_TERMINATE, REALTIME_PRIORITY_CLASS,
};

// Undocumented but stable since Windows XP, and what every task manager
// (Process Explorer, System Informer, TaskExplorer) uses: suspending each
// thread one by one would race against the process creating new ones.
#[link(name = "ntdll")]
extern "system" {
    fn NtSuspendProcess(process: HANDLE) -> i32;
    fn NtResumeProcess(process: HANDLE) -> i32;
}

/// Closes the wrapped handle when dropped.
struct Owned(HANDLE);

impl Drop for Owned {
    fn drop(&mut self) {
        // SAFETY: `self.0` is a handle we opened and haven't closed yet.
        unsafe { CloseHandle(self.0) };
    }
}

fn last_error() -> String {
    // SAFETY: GetLastError only reads thread-local state.
    match unsafe { GetLastError() } {
        ERROR_ACCESS_DENIED => {
            "access denied — start MoonTask as administrator to manage this process".into()
        }
        ERROR_INVALID_PARAMETER => "the process no longer exists".into(),
        code => format!("Windows error {code}"),
    }
}

fn open(pid: u32, access: u32) -> Result<Owned, String> {
    // SAFETY: plain value arguments; a null return is handled below.
    let handle = unsafe { OpenProcess(access, 0, pid) };
    if handle.is_null() {
        Err(last_error())
    } else {
        Ok(Owned(handle))
    }
}

fn snapshot(flags: u32, pid: u32) -> Option<Owned> {
    // SAFETY: plain value arguments; the invalid-handle return is handled.
    let handle = unsafe { CreateToolhelp32Snapshot(flags, pid) };
    (handle != INVALID_HANDLE_VALUE).then_some(Owned(handle))
}

fn wide_to_string(wide: &[u16]) -> String {
    let len = wide.iter().position(|&c| c == 0).unwrap_or(wide.len());
    String::from_utf16_lossy(&wide[..len])
}

pub fn terminate(pid: u32, _force: bool) -> Result<(), String> {
    let process = open(pid, PROCESS_TERMINATE)?;
    // Exit code 1, as Task Manager uses.
    // SAFETY: `process` is a valid handle with PROCESS_TERMINATE access.
    if unsafe { TerminateProcess(process.0, 1) } == 0 {
        return Err(last_error());
    }
    Ok(())
}

pub fn suspend(pid: u32) -> Result<(), String> {
    let process = open(pid, PROCESS_SUSPEND_RESUME)?;
    // SAFETY: `process` is a valid handle with PROCESS_SUSPEND_RESUME access.
    let status = unsafe { NtSuspendProcess(process.0) };
    if status < 0 {
        return Err(format!(
            "could not suspend the process (NTSTATUS {status:#x})"
        ));
    }
    Ok(())
}

pub fn resume(pid: u32) -> Result<(), String> {
    let process = open(pid, PROCESS_SUSPEND_RESUME)?;
    // SAFETY: see `suspend`.
    let status = unsafe { NtResumeProcess(process.0) };
    if status < 0 {
        return Err(format!(
            "could not resume the process (NTSTATUS {status:#x})"
        ));
    }
    Ok(())
}

pub fn priority(pid: u32) -> Option<(Priority, Option<i32>)> {
    let process = open(pid, PROCESS_QUERY_LIMITED_INFORMATION).ok()?;
    // SAFETY: `process` is a valid handle with query access.
    let class = unsafe { GetPriorityClass(process.0) };
    let priority = match class {
        IDLE_PRIORITY_CLASS => Priority::Idle,
        BELOW_NORMAL_PRIORITY_CLASS => Priority::BelowNormal,
        NORMAL_PRIORITY_CLASS => Priority::Normal,
        ABOVE_NORMAL_PRIORITY_CLASS => Priority::AboveNormal,
        HIGH_PRIORITY_CLASS => Priority::High,
        REALTIME_PRIORITY_CLASS => Priority::Realtime,
        _ => return None,
    };
    Some((priority, None))
}

pub fn set_priority(pid: u32, priority: Priority) -> Result<(), String> {
    let class = match priority {
        Priority::Idle => IDLE_PRIORITY_CLASS,
        Priority::BelowNormal => BELOW_NORMAL_PRIORITY_CLASS,
        Priority::Normal => NORMAL_PRIORITY_CLASS,
        Priority::AboveNormal => ABOVE_NORMAL_PRIORITY_CLASS,
        Priority::High => HIGH_PRIORITY_CLASS,
        Priority::Realtime => return Err("realtime priority is never set".into()),
    };
    let process = open(pid, PROCESS_SET_INFORMATION)?;
    // SAFETY: `process` is a valid handle with PROCESS_SET_INFORMATION access.
    if unsafe { SetPriorityClass(process.0, class) } == 0 {
        return Err(last_error());
    }
    Ok(())
}

pub fn thread_counts(_pids: &[u32]) -> HashMap<u32, u32> {
    let mut counts = HashMap::new();
    let Some(snap) = snapshot(TH32CS_SNAPPROCESS, 0) else {
        return counts;
    };
    let mut entry = PROCESSENTRY32W {
        dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
        ..Default::default()
    };
    // SAFETY: `entry` is a writable PROCESSENTRY32W with dwSize set.
    let mut ok = unsafe { Process32FirstW(snap.0, &mut entry) } != 0;
    while ok {
        counts.insert(entry.th32ProcessID, entry.cntThreads);
        // SAFETY: as above.
        ok = unsafe { Process32NextW(snap.0, &mut entry) } != 0;
    }
    counts
}

pub fn threads(pid: u32) -> Option<Vec<ThreadRow>> {
    // A thread snapshot always covers the whole system; filter by owner.
    let snap = snapshot(TH32CS_SNAPTHREAD, 0)?;
    let mut entry = THREADENTRY32 {
        dwSize: std::mem::size_of::<THREADENTRY32>() as u32,
        ..Default::default()
    };
    let mut rows = Vec::new();
    // SAFETY: `entry` is a writable THREADENTRY32 with dwSize set.
    let mut ok = unsafe { Thread32First(snap.0, &mut entry) } != 0;
    while ok {
        if entry.th32OwnerProcessID == pid {
            rows.push(ThreadRow {
                tid: entry.th32ThreadID,
                name: None,
                state: None,
                cpu_time: None,
                priority: Some(entry.tpBasePri),
            });
        }
        // SAFETY: as above.
        ok = unsafe { Thread32Next(snap.0, &mut entry) } != 0;
    }
    Some(rows)
}

pub fn modules(pid: u32) -> Option<Vec<ModuleRow>> {
    // Fails with access denied for protected and (without admin) other
    // users' processes — `None` makes the UI explain that.
    let snap = snapshot(TH32CS_SNAPMODULE | TH32CS_SNAPMODULE32, pid)?;
    let mut entry = MODULEENTRY32W {
        dwSize: std::mem::size_of::<MODULEENTRY32W>() as u32,
        ..Default::default()
    };
    let mut rows = Vec::new();
    // SAFETY: `entry` is a writable MODULEENTRY32W with dwSize set.
    let mut ok = unsafe { Module32FirstW(snap.0, &mut entry) } != 0;
    while ok {
        rows.push(ModuleRow {
            name: wide_to_string(&entry.szModule),
            path: wide_to_string(&entry.szExePath),
            base: Some(format!("{:#x}", entry.modBaseAddr as usize)),
            size: Some(u64::from(entry.modBaseSize)),
        });
        // SAFETY: as above.
        ok = unsafe { Module32NextW(snap.0, &mut entry) } != 0;
    }
    Some(rows)
}

pub fn handles(_pid: u32) -> Option<Vec<HandleRow>> {
    // Needs NtQuerySystemInformation(SystemExtendedHandleInformation) plus
    // a driver-free way to name each handle — future work.
    None
}

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub fn reveal_in_file_manager(path: &Path) -> Result<(), String> {
    // `/select,` must be glued to the path in one argument, which Rust's
    // own quoting would split — raw_arg passes it through untouched.
    Command::new("explorer.exe")
        .raw_arg(format!("/select,\"{}\"", path.display()))
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("could not open Explorer: {e}"))
}
