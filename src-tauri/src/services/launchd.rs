//! macOS: launchd jobs of the current user's domain, from `launchctl list`.

use crate::models::{Service, ServiceState};

/// Parses `launchctl list`: a `PID  Status  Label` header, then one job per
/// line; `-` for PID means not running, Status is the last exit code.
pub fn parse(output: &str) -> Vec<Service> {
    let mut services: Vec<Service> = output
        .lines()
        .skip_while(|line| line.starts_with("PID"))
        .filter_map(|line| {
            let mut fields = line.split('\t');
            let pid = fields.next()?.trim();
            let status = fields.next()?.trim();
            let label = fields.next()?.trim();
            if label.is_empty() {
                return None;
            }
            let pid = pid.parse::<u32>().ok();
            let (state, raw_state) = match (pid, status) {
                (Some(_), _) => (ServiceState::Running, "running".to_string()),
                (None, "0") => (ServiceState::Stopped, "not running".to_string()),
                (None, code) => (ServiceState::Failed, format!("last exit {code}")),
            };
            Some(Service {
                name: label.to_string(),
                display_name: label.to_string(),
                description: None,
                state,
                raw_state,
                startup: None,
                pid,
            })
        })
        .collect();
    services.sort_by(|a, b| a.name.cmp(&b.name));
    services
}

#[cfg(target_os = "macos")]
pub fn list() -> Result<Vec<Service>, String> {
    Ok(parse(&super::run("launchctl", &["list"])?))
}

#[cfg(target_os = "macos")]
pub fn control(name: &str, action: crate::models::ServiceAction) -> Result<(), String> {
    use crate::models::ServiceAction;
    match action {
        ServiceAction::Start => super::run("launchctl", &["start", name]).map(|_| ()),
        ServiceAction::Stop => super::run("launchctl", &["stop", name]).map(|_| ()),
        ServiceAction::Restart => {
            super::run("launchctl", &["stop", name])?;
            super::run("launchctl", &["start", name]).map(|_| ())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_running_stopped_and_failed_jobs() {
        let output = "PID\tStatus\tLabel\n\
                      412\t0\tcom.apple.Finder\n\
                      -\t0\tcom.apple.quicklook\n\
                      -\t-9\tcom.example.crashy\n";
        let services = parse(output);
        assert_eq!(services.len(), 3);
        assert_eq!(services[0].name, "com.apple.Finder");
        assert_eq!(services[0].state, ServiceState::Running);
        assert_eq!(services[0].pid, Some(412));
        assert_eq!(services[1].state, ServiceState::Stopped);
        assert_eq!(services[2].state, ServiceState::Failed);
        assert_eq!(services[2].raw_state, "last exit -9");
    }
}
