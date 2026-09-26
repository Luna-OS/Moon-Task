//! Pure rules for "whose process is this?" and "may MoonTask touch it?".
//! Kept free of `sysinfo` types and parameterized by [`Os`] so every
//! platform's rules are unit-tested on every platform.

use crate::models::Owner;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Os {
    Linux,
    MacOs,
    Windows,
}

impl Os {
    pub const CURRENT: Os = if cfg!(windows) {
        Os::Windows
    } else if cfg!(target_os = "macos") {
        Os::MacOs
    } else {
        Os::Linux
    };
}

/// `uid` is a numeric uid on Unix and a SID string on Windows.
pub fn owner(
    os: Os,
    pid: u32,
    parent: Option<u32>,
    uid: Option<&str>,
    self_uid: Option<&str>,
) -> Owner {
    let kernel = match os {
        // kthreadd (pid 2) is the parent of every kernel thread.
        Os::Linux => pid == 2 || parent == Some(2),
        Os::MacOs => pid == 0,
        // "System Idle Process" and "System".
        Os::Windows => pid == 0 || pid == 4,
    };
    if kernel {
        return Owner::Kernel;
    }
    let Some(uid) = uid else {
        // Unix always knows the uid; on Windows an unreadable owner means
        // a protected system process.
        return Owner::System;
    };
    if Some(uid) == self_uid {
        return Owner::Current;
    }
    let system = match os {
        // Regular accounts start at 1000 on Linux and 500 on macOS; below
        // that live root and the service accounts (messagebus, _windowserver…).
        Os::Linux => uid.parse::<u32>().map_or(true, |n| n < 1000),
        Os::MacOs => uid.parse::<u32>().map_or(true, |n| n < 500),
        // LocalSystem, LocalService, NetworkService, and the per-session
        // Window Manager (DWM) and font driver (UMFD) accounts.
        Os::Windows => {
            matches!(uid, "S-1-5-18" | "S-1-5-19" | "S-1-5-20")
                || uid.starts_with("S-1-5-90-")
                || uid.starts_with("S-1-5-96-")
        }
    };
    if system {
        Owner::System
    } else {
        Owner::Other
    }
}

/// Names of Windows processes that bluescreen or log out the machine
/// when ended. Only honored for non-user processes, so malware can't hide
/// from MoonTask by calling itself `csrss.exe`.
const WINDOWS_CRITICAL: &[&str] = &[
    "system",
    "registry",
    "secure system",
    "memory compression",
    "smss.exe",
    "csrss.exe",
    "wininit.exe",
    "winlogon.exe",
    "services.exe",
    "lsass.exe",
    "lsaiso.exe",
];

const MACOS_CRITICAL: &[&str] = &["kernel_task", "launchd", "WindowServer", "loginwindow"];

/// A protected process can't be ended, suspended or re-prioritized from
/// MoonTask: doing so would crash or log out the system — or, for
/// MoonTask's own process, freeze the very window the user clicks in.
pub fn is_protected(os: Os, pid: u32, name: &str, owner: Owner, self_pid: u32) -> bool {
    if pid == self_pid || owner == Owner::Kernel {
        return true;
    }
    if owner == Owner::Current {
        return false;
    }
    match os {
        // init/systemd: ending it panics the kernel.
        Os::Linux => pid == 1,
        Os::MacOs => pid == 1 || MACOS_CRITICAL.contains(&name),
        Os::Windows => WINDOWS_CRITICAL.contains(&name.to_ascii_lowercase().as_str()),
    }
}

/// Human-readable names for the well-known Windows service SIDs, which
/// `sysinfo`'s user list doesn't contain.
pub fn well_known_account(uid: &str) -> Option<&'static str> {
    match uid {
        "S-1-5-18" => Some("SYSTEM"),
        "S-1-5-19" => Some("LOCAL SERVICE"),
        "S-1-5-20" => Some("NETWORK SERVICE"),
        _ if uid.starts_with("S-1-5-90-") => Some("DWM"),
        _ if uid.starts_with("S-1-5-96-") => Some("UMFD"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn linux_owners() {
        let me = Some("1000");
        assert_eq!(
            owner(Os::Linux, 900, Some(1), Some("1000"), me),
            Owner::Current
        );
        assert_eq!(owner(Os::Linux, 1, None, Some("0"), me), Owner::System);
        assert_eq!(
            owner(Os::Linux, 700, Some(1), Some("101"), me),
            Owner::System
        );
        assert_eq!(
            owner(Os::Linux, 800, Some(1), Some("1001"), me),
            Owner::Other
        );
        assert_eq!(owner(Os::Linux, 2, Some(0), Some("0"), me), Owner::Kernel);
        assert_eq!(owner(Os::Linux, 15, Some(2), Some("0"), me), Owner::Kernel);
    }

    #[test]
    fn macos_owners() {
        let me = Some("501");
        assert_eq!(owner(Os::MacOs, 0, None, Some("0"), me), Owner::Kernel);
        assert_eq!(
            owner(Os::MacOs, 300, Some(1), Some("88"), me),
            Owner::System
        );
        assert_eq!(
            owner(Os::MacOs, 400, Some(1), Some("502"), me),
            Owner::Other
        );
        assert_eq!(
            owner(Os::MacOs, 500, Some(1), Some("501"), me),
            Owner::Current
        );
    }

    #[test]
    fn windows_owners() {
        let me = Some("S-1-5-21-1-2-3-1001");
        assert_eq!(owner(Os::Windows, 4, Some(0), None, me), Owner::Kernel);
        assert_eq!(
            owner(Os::Windows, 640, Some(500), Some("S-1-5-18"), me),
            Owner::System
        );
        assert_eq!(
            owner(Os::Windows, 900, Some(640), Some("S-1-5-90-0-1"), me),
            Owner::System
        );
        assert_eq!(owner(Os::Windows, 1200, Some(640), None, me), Owner::System);
        assert_eq!(
            owner(
                Os::Windows,
                5000,
                Some(4000),
                Some("S-1-5-21-1-2-3-1001"),
                me
            ),
            Owner::Current
        );
        assert_eq!(
            owner(
                Os::Windows,
                5100,
                Some(4000),
                Some("S-1-5-21-1-2-3-1002"),
                me
            ),
            Owner::Other
        );
    }

    #[test]
    fn self_and_kernel_are_always_protected() {
        assert!(is_protected(
            Os::Linux,
            4242,
            "moontask",
            Owner::Current,
            4242
        ));
        assert!(is_protected(Os::Linux, 15, "kworker/0:1", Owner::Kernel, 1));
    }

    #[test]
    fn critical_names_count_only_for_system_processes() {
        assert!(is_protected(
            Os::Windows,
            700,
            "csrss.exe",
            Owner::System,
            1
        ));
        assert!(is_protected(
            Os::Windows,
            700,
            "LSASS.EXE",
            Owner::System,
            1
        ));
        assert!(!is_protected(
            Os::Windows,
            7000,
            "csrss.exe",
            Owner::Current,
            1
        ));
        assert!(!is_protected(
            Os::Windows,
            800,
            "svchost.exe",
            Owner::System,
            1
        ));
        assert!(is_protected(
            Os::MacOs,
            150,
            "WindowServer",
            Owner::System,
            1
        ));
        assert!(is_protected(Os::Linux, 1, "systemd", Owner::System, 99));
        assert!(!is_protected(Os::Linux, 600, "sshd", Owner::System, 99));
    }

    #[test]
    fn names_well_known_sids() {
        assert_eq!(well_known_account("S-1-5-18"), Some("SYSTEM"));
        assert_eq!(well_known_account("S-1-5-96-0-2"), Some("UMFD"));
        assert_eq!(well_known_account("S-1-5-21-9"), None);
    }
}
