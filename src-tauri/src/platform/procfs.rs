//! Pure parsers for Linux `/proc` files. Kept free of I/O so they are
//! unit-tested on every platform; `linux.rs` does the reading.

use crate::models::{HandleKind, ModuleRow};
use std::collections::BTreeMap;

/// The fields MoonTask needs from `/proc/<pid>/task/<tid>/stat`.
#[derive(Debug, Clone, PartialEq)]
pub struct TaskStat {
    pub comm: String,
    pub state: char,
    /// Clock ticks spent in user and kernel mode.
    pub utime: u64,
    pub stime: u64,
    pub nice: i32,
}

/// Parses a `stat` line. The command name sits in parentheses and may
/// itself contain spaces and parentheses, so everything is split around
/// the *last* `)`.
pub fn parse_stat(line: &str) -> Option<TaskStat> {
    let open = line.find('(')?;
    let close = line.rfind(')')?;
    let comm = line.get(open + 1..close)?.to_string();
    let rest: Vec<&str> = line.get(close + 1..)?.split_whitespace().collect();
    // `rest[0]` is field 3 (state); utime/stime/nice are fields 14/15/19.
    Some(TaskStat {
        comm,
        state: rest.first()?.chars().next()?,
        utime: rest.get(11)?.parse().ok()?,
        stime: rest.get(12)?.parse().ok()?,
        nice: rest.get(16)?.parse().ok()?,
    })
}

pub fn state_label(state: char) -> &'static str {
    match state {
        'R' => "Running",
        'S' => "Sleeping",
        'D' => "Waiting (I/O)",
        'T' => "Stopped",
        't' => "Traced",
        'Z' => "Zombie",
        'X' | 'x' => "Dead",
        'I' => "Idle",
        'P' => "Parked",
        'W' => "Waking",
        'K' => "Wakekill",
        _ => "Unknown",
    }
}

/// Collects the files mapped into a process from `/proc/<pid>/maps` — its
/// executable, shared libraries and other mapped files — one row per
/// file, with the lowest mapping address and the total mapped size.
pub fn parse_maps(content: &str) -> Vec<ModuleRow> {
    struct Acc {
        base: u64,
        size: u64,
    }
    let mut by_path: BTreeMap<String, Acc> = BTreeMap::new();

    for line in content.lines() {
        let mut fields = line.splitn(6, char::is_whitespace);
        let (Some(range), Some(_perms), Some(_offset), Some(_dev), Some(inode), Some(path)) = (
            fields.next(),
            fields.next(),
            fields.next(),
            fields.next(),
            fields.next(),
            fields.next(),
        ) else {
            continue;
        };
        let path = path.trim_start();
        // Anonymous memory, [heap], [stack], [vdso] … aren't modules.
        if inode == "0" || !path.starts_with('/') {
            continue;
        }
        let Some((start, end)) = range.split_once('-') else {
            continue;
        };
        let (Ok(start), Ok(end)) = (u64::from_str_radix(start, 16), u64::from_str_radix(end, 16))
        else {
            continue;
        };
        let acc = by_path.entry(path.to_string()).or_insert(Acc {
            base: start,
            size: 0,
        });
        acc.base = acc.base.min(start);
        acc.size += end.saturating_sub(start);
    }

    let mut rows: Vec<ModuleRow> = by_path
        .into_iter()
        .map(|(path, acc)| {
            let clean = path.strip_suffix(" (deleted)").unwrap_or(&path);
            ModuleRow {
                name: clean.rsplit('/').next().unwrap_or(clean).to_string(),
                path,
                base: Some(format!("0x{:x}", acc.base)),
                size: Some(acc.size),
            }
        })
        .collect();
    rows.sort_by_key(ModuleRow::base_value);
    rows
}

impl ModuleRow {
    fn base_value(&self) -> u64 {
        self.base
            .as_deref()
            .and_then(|b| u64::from_str_radix(b.trim_start_matches("0x"), 16).ok())
            .unwrap_or(u64::MAX)
    }
}

/// Classifies the target of a `/proc/<pid>/fd/<n>` link. Directories
/// can't be told from the link text; the caller checks those on disk.
pub fn classify_fd_target(target: &str) -> HandleKind {
    if target.starts_with("socket:[") {
        HandleKind::Socket
    } else if target.starts_with("pipe:[") {
        HandleKind::Pipe
    } else if target.starts_with("/dev/") {
        HandleKind::Device
    } else if target.starts_with('/') {
        HandleKind::File
    } else {
        HandleKind::Other
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_plain_stat_line() {
        let line = "1234 (bash) S 1000 1234 1234 34816 1300 4194304 1802 7061 0 1 \
                    12 7 22 9 20 0 1 0 25680 11378688 1343 18446744073709551615";
        let stat = parse_stat(line).unwrap();
        assert_eq!(stat.comm, "bash");
        assert_eq!(stat.state, 'S');
        assert_eq!(stat.utime, 12);
        assert_eq!(stat.stime, 7);
        assert_eq!(stat.nice, 0);
    }

    #[test]
    fn parses_a_command_name_with_spaces_and_parentheses() {
        let line = "77 (Web Content (x)) R 1 77 77 0 -1 4194560 0 0 0 0 \
                    500 60 0 0 20 -5 30 0 100 0 0 0";
        let stat = parse_stat(line).unwrap();
        assert_eq!(stat.comm, "Web Content (x)");
        assert_eq!(stat.state, 'R');
        assert_eq!(stat.utime, 500);
        assert_eq!(stat.nice, -5);
    }

    #[test]
    fn rejects_truncated_stat_lines() {
        assert_eq!(parse_stat("12 (x) S 1 2 3"), None);
        assert_eq!(parse_stat("garbage"), None);
    }

    #[test]
    fn groups_mappings_per_file_and_skips_anonymous_ones() {
        let maps = "\
55d0c0a00000-55d0c0a28000 r--p 00000000 08:01 131 /usr/bin/bash
55d0c0a28000-55d0c0b00000 r-xp 00028000 08:01 131 /usr/bin/bash
55d0c1000000-55d0c1100000 rw-p 00000000 00:00 0 [heap]
7f0000000000-7f0000010000 r--p 00000000 08:01 777 /usr/lib/libc.so.6
7f0000010000-7f0000020000 rw-p 00000000 00:00 0
7f0000030000-7f0000031000 r--p 00000000 08:01 900 /tmp/my lib.so (deleted)
7ffd00000000-7ffd00021000 rw-p 00000000 00:00 0 [stack]";
        let rows = parse_maps(maps);
        assert_eq!(rows.len(), 3);

        assert_eq!(rows[0].name, "bash");
        assert_eq!(rows[0].base.as_deref(), Some("0x55d0c0a00000"));
        assert_eq!(rows[0].size, Some(0x100000));

        assert_eq!(rows[1].name, "libc.so.6");
        assert_eq!(rows[2].path, "/tmp/my lib.so (deleted)");
        assert_eq!(rows[2].name, "my lib.so");
    }

    #[test]
    fn classifies_fd_targets() {
        assert_eq!(classify_fd_target("socket:[4242]"), HandleKind::Socket);
        assert_eq!(classify_fd_target("pipe:[99]"), HandleKind::Pipe);
        assert_eq!(classify_fd_target("/dev/null"), HandleKind::Device);
        assert_eq!(classify_fd_target("/home/me/notes.txt"), HandleKind::File);
        assert_eq!(
            classify_fd_target("anon_inode:[eventfd]"),
            HandleKind::Other
        );
    }
}
