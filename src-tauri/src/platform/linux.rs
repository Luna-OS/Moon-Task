//! Linux: the deeper process views come straight from `/proc`.

use super::procfs;
use crate::models::{HandleKind, HandleRow, ModuleRow, ThreadRow};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::process::{Command, Stdio};

/// Handle lists can run into the hundreds of thousands (databases, file
/// indexers); the panel shows the first ones and says how many exist.
const MAX_HANDLES: usize = 5_000;

pub fn thread_counts(_pids: &[u32]) -> HashMap<u32, u32> {
    // The monitor reads Linux thread counts from sysinfo's task lists.
    HashMap::new()
}

fn clock_ticks_per_second() -> u64 {
    // SAFETY: sysconf has no memory effects.
    let ticks = unsafe { libc::sysconf(libc::_SC_CLK_TCK) };
    if ticks > 0 {
        ticks as u64
    } else {
        100
    }
}

pub fn threads(pid: u32) -> Option<Vec<ThreadRow>> {
    let ticks = clock_ticks_per_second();
    let entries = fs::read_dir(format!("/proc/{pid}/task")).ok()?;
    let mut rows: Vec<ThreadRow> = entries
        .flatten()
        .filter_map(|entry| {
            let tid: u32 = entry.file_name().to_str()?.parse().ok()?;
            let stat = fs::read_to_string(entry.path().join("stat")).ok()?;
            let stat = procfs::parse_stat(&stat)?;
            Some(ThreadRow {
                tid,
                name: Some(stat.comm),
                state: Some(procfs::state_label(stat.state).to_string()),
                cpu_time: Some((stat.utime + stat.stime) * 1000 / ticks),
                priority: Some(stat.nice),
            })
        })
        .collect();
    rows.sort_by_key(|t| t.tid);
    Some(rows)
}

pub fn modules(pid: u32) -> Option<Vec<ModuleRow>> {
    // Unreadable (permission denied) for other users' processes unless
    // MoonTask runs as root — `None` makes the UI say exactly that.
    let maps = fs::read_to_string(format!("/proc/{pid}/maps")).ok()?;
    Some(procfs::parse_maps(&maps))
}

pub fn handles(pid: u32) -> Option<Vec<HandleRow>> {
    let entries = fs::read_dir(format!("/proc/{pid}/fd")).ok()?;
    let mut rows: Vec<HandleRow> = entries
        .flatten()
        .take(MAX_HANDLES)
        .filter_map(|entry| {
            let fd: u32 = entry.file_name().to_str()?.parse().ok()?;
            let target = fs::read_link(entry.path()).ok()?;
            let target = target.to_string_lossy().into_owned();
            let mut kind = procfs::classify_fd_target(&target);
            if kind == HandleKind::File && Path::new(&target).is_dir() {
                kind = HandleKind::Directory;
            }
            Some(HandleRow { fd, kind, target })
        })
        .collect();
    rows.sort_by_key(|h| h.fd);
    Some(rows)
}

/// Percent-encodes a path for a `file://` URI (spaces, `#`, `%` …).
fn percent_encode(path: &str) -> String {
    let mut out = String::with_capacity(path.len());
    for byte in path.bytes() {
        if byte.is_ascii_alphanumeric() || b"/-._~".contains(&byte) {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

pub fn reveal_in_file_manager(path: &Path) -> Result<(), String> {
    // The freedesktop FileManager1 interface selects the file itself; not
    // every desktop has it, so fall back to opening the folder.
    let uri = format!("file://{}", percent_encode(&path.to_string_lossy()));
    let selected = Command::new("dbus-send")
        .args([
            "--session",
            "--dest=org.freedesktop.FileManager1",
            "--type=method_call",
            "/org/freedesktop/FileManager1",
            "org.freedesktop.FileManager1.ShowItems",
        ])
        .arg(format!("array:string:{uri}"))
        .arg("string:")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    if selected {
        return Ok(());
    }
    let folder = path.parent().unwrap_or(path);
    Command::new("xdg-open")
        .arg(folder)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("could not open the file manager: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_paths_for_file_uris() {
        assert_eq!(percent_encode("/usr/bin/vim"), "/usr/bin/vim");
        assert_eq!(percent_encode("/opt/My App/a#1"), "/opt/My%20App/a%231");
        assert_eq!(percent_encode("/tmp/ü"), "/tmp/%C3%BC");
    }
}
