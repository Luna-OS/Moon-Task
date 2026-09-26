//! Linux: systemd services, read through `systemctl`'s plain-text output
//! (stable for a decade, unlike its JSON mode), and their main processes
//! through each process' cgroup.

use crate::models::{Service, ServiceState};
use std::collections::BTreeMap;

/// Parses `systemctl list-units --type=service --all --plain --no-legend`:
/// `UNIT LOAD ACTIVE SUB DESCRIPTION…`, failed units prefixed with `●`.
pub fn parse_list_units(output: &str) -> Vec<Service> {
    output
        .lines()
        .filter_map(|line| {
            let line = line
                .trim_start()
                .trim_start_matches(['●', '*'])
                .trim_start();
            let mut fields = line.split_whitespace();
            let unit = fields.next()?;
            let load = fields.next()?;
            let active = fields.next()?;
            let sub = fields.next()?;
            if !unit.ends_with(".service") || load == "not-found" {
                return None;
            }
            let description = fields.collect::<Vec<_>>().join(" ");
            Some(Service {
                name: unit.to_string(),
                display_name: unit.trim_end_matches(".service").to_string(),
                description: (!description.is_empty()).then_some(description),
                state: map_state(active, sub),
                raw_state: format!("{active} ({sub})"),
                startup: None,
                pid: None,
            })
        })
        .collect()
}

fn map_state(active: &str, sub: &str) -> ServiceState {
    match (active, sub) {
        ("active" | "reloading", "running") => ServiceState::Running,
        ("activating", _) => ServiceState::Starting,
        ("deactivating", _) => ServiceState::Stopping,
        ("failed", _) => ServiceState::Failed,
        ("inactive", _) => ServiceState::Stopped,
        // e.g. "active (exited)": a one-shot that ran and finished.
        _ => ServiceState::Other,
    }
}

/// Parses `systemctl list-unit-files --type=service --plain --no-legend`:
/// `UNIT STATE [PRESET]`. Template units (`getty@.service`) are skipped —
/// they only run as named instances.
pub fn parse_unit_files(output: &str) -> Vec<(String, String)> {
    output
        .lines()
        .filter_map(|line| {
            let mut fields = line.split_whitespace();
            let unit = fields.next()?;
            let state = fields.next()?;
            (unit.ends_with(".service") && !unit.ends_with("@.service"))
                .then(|| (unit.to_string(), state.to_string()))
        })
        .collect()
}

/// Combines the loaded units with every installed unit file, so services
/// that are installed but never started show up as stopped.
pub fn merge(units: Vec<Service>, files: Vec<(String, String)>) -> Vec<Service> {
    let mut by_name: BTreeMap<String, Service> =
        units.into_iter().map(|s| (s.name.clone(), s)).collect();
    for (name, state) in files {
        by_name
            .entry(name.clone())
            .or_insert_with(|| Service {
                display_name: name.trim_end_matches(".service").to_string(),
                name,
                description: None,
                state: ServiceState::Stopped,
                raw_state: "inactive (dead)".into(),
                startup: None,
                pid: None,
            })
            .startup = Some(state);
    }
    by_name.into_values().collect()
}

/// The service a process belongs to, from its `/proc/<pid>/cgroup`
/// (`0::/system.slice/ssh.service`). The innermost `.service` wins, so a
/// user's own services aren't all attributed to `user@1000.service`.
pub fn service_of_cgroup(content: &str) -> Option<&str> {
    content
        .lines()
        .filter_map(|line| line.splitn(3, ':').nth(2))
        .flat_map(|path| path.split('/'))
        .rfind(|segment| segment.ends_with(".service"))
}

#[cfg(target_os = "linux")]
pub fn list() -> Result<Vec<Service>, String> {
    use std::collections::HashMap;

    let units = super::run(
        "systemctl",
        &[
            "list-units",
            "--type=service",
            "--all",
            "--plain",
            "--no-legend",
            "--no-pager",
        ],
    )?;
    let files = super::run(
        "systemctl",
        &[
            "list-unit-files",
            "--type=service",
            "--plain",
            "--no-legend",
            "--no-pager",
        ],
    )
    .unwrap_or_default();
    let mut services = merge(parse_list_units(&units), parse_unit_files(&files));

    // Lowest PID per service ≈ its main process.
    let mut main_pids: HashMap<String, u32> = HashMap::new();
    for entry in std::fs::read_dir("/proc").into_iter().flatten().flatten() {
        let Some(pid) = entry
            .file_name()
            .to_str()
            .and_then(|n| n.parse::<u32>().ok())
        else {
            continue;
        };
        let Ok(cgroup) = std::fs::read_to_string(entry.path().join("cgroup")) else {
            continue;
        };
        if let Some(service) = service_of_cgroup(&cgroup) {
            let current = main_pids.entry(service.to_string()).or_insert(pid);
            *current = (*current).min(pid);
        }
    }
    for service in &mut services {
        if service.state == ServiceState::Running {
            service.pid = main_pids.get(&service.name).copied();
        }
    }
    Ok(services)
}

#[cfg(target_os = "linux")]
pub fn control(name: &str, action: crate::models::ServiceAction) -> Result<(), String> {
    // Without root, systemctl asks polkit, which shows the desktop's own
    // password prompt.
    super::run("systemctl", &[action.verb(), name]).map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    const UNITS: &str = "\
  cron.service                 loaded    active   running Regular background program processing daemon
● nginx.service                loaded    failed   failed  A high performance web server
  ssh.service                  loaded    inactive dead    OpenBSD Secure Shell server
  plymouth-quit.service        loaded    active   exited  Terminate Plymouth Boot Screen
  ghost.service                not-found inactive dead    ghost.service
  apt-daily.timer              loaded    active   waiting Daily apt download activities
";

    const FILES: &str = "\
cron.service                 enabled         enabled
getty@.service               enabled         enabled
ssh.service                  disabled        enabled
bluetooth.service            enabled         enabled
";

    #[test]
    fn parses_loaded_units() {
        let services = parse_list_units(UNITS);
        let names: Vec<&str> = services.iter().map(|s| s.name.as_str()).collect();
        assert_eq!(
            names,
            [
                "cron.service",
                "nginx.service",
                "ssh.service",
                "plymouth-quit.service"
            ]
        );
        assert_eq!(services[0].state, ServiceState::Running);
        assert_eq!(services[0].display_name, "cron");
        assert_eq!(
            services[0].description.as_deref(),
            Some("Regular background program processing daemon")
        );
        assert_eq!(services[1].state, ServiceState::Failed);
        assert_eq!(services[2].state, ServiceState::Stopped);
        assert_eq!(services[3].state, ServiceState::Other);
        assert_eq!(services[3].raw_state, "active (exited)");
    }

    #[test]
    fn merges_in_installed_but_unloaded_services() {
        let merged = merge(parse_list_units(UNITS), parse_unit_files(FILES));
        let bt = merged
            .iter()
            .find(|s| s.name == "bluetooth.service")
            .unwrap();
        assert_eq!(bt.state, ServiceState::Stopped);
        assert_eq!(bt.startup.as_deref(), Some("enabled"));
        let ssh = merged.iter().find(|s| s.name == "ssh.service").unwrap();
        assert_eq!(ssh.startup.as_deref(), Some("disabled"));
        assert!(merged.iter().all(|s| s.name != "getty@.service"));
    }

    #[test]
    fn finds_the_innermost_service_in_a_cgroup() {
        assert_eq!(
            service_of_cgroup("0::/system.slice/ssh.service\n"),
            Some("ssh.service")
        );
        assert_eq!(
            service_of_cgroup(
                "0::/user.slice/user-1000.slice/user@1000.service/app.slice/pipewire.service"
            ),
            Some("pipewire.service")
        );
        assert_eq!(
            service_of_cgroup("12:pids:/\n1:name=systemd:/system.slice/cron.service"),
            Some("cron.service")
        );
        assert_eq!(service_of_cgroup("0::/init.scope"), None);
    }
}
