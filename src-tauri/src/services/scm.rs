//! Windows: services from the Service Control Manager, read through
//! PowerShell's CIM cmdlets as JSON.

use crate::models::{Service, ServiceState};
use serde::Deserialize;

#[cfg(windows)]
const LIST_SCRIPT: &str = "[Console]::OutputEncoding = [Text.Encoding]::UTF8; \
    Get-CimInstance -ClassName Win32_Service | \
    Select-Object Name,DisplayName,State,StartMode,ProcessId,Description | \
    ConvertTo-Json -Compress";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct CimService {
    name: String,
    display_name: Option<String>,
    state: Option<String>,
    start_mode: Option<String>,
    process_id: Option<u32>,
    description: Option<String>,
}

/// ConvertTo-Json emits a bare object instead of an array when there is
/// exactly one item; both are accepted.
pub fn parse(json: &str) -> Result<Vec<Service>, String> {
    let json = json.trim_start_matches('\u{feff}').trim();
    if json.is_empty() {
        return Ok(Vec::new());
    }
    let value: serde_json::Value =
        serde_json::from_str(json).map_err(|e| format!("unexpected service list: {e}"))?;
    let items = match value {
        serde_json::Value::Array(items) => items,
        other => vec![other],
    };
    let mut services: Vec<Service> = items
        .into_iter()
        .filter_map(|item| serde_json::from_value::<CimService>(item).ok())
        .map(|s| {
            let raw_state = s.state.unwrap_or_else(|| "Unknown".into());
            Service {
                display_name: s
                    .display_name
                    .filter(|d| !d.is_empty())
                    .unwrap_or_else(|| s.name.clone()),
                name: s.name,
                description: s.description.filter(|d| !d.is_empty()),
                state: map_state(&raw_state),
                raw_state,
                startup: s.start_mode,
                pid: s.process_id.filter(|&pid| pid != 0),
            }
        })
        .collect();
    services.sort_by_key(|s| s.display_name.to_lowercase());
    Ok(services)
}

fn map_state(state: &str) -> ServiceState {
    match state {
        "Running" => ServiceState::Running,
        "Stopped" => ServiceState::Stopped,
        "Start Pending" | "Continue Pending" => ServiceState::Starting,
        "Stop Pending" | "Pause Pending" => ServiceState::Stopping,
        _ => ServiceState::Other,
    }
}

#[cfg(windows)]
pub fn list() -> Result<Vec<Service>, String> {
    parse(&powershell(LIST_SCRIPT, None)?)
}

#[cfg(windows)]
pub fn control(name: &str, action: crate::models::ServiceAction) -> Result<(), String> {
    use crate::models::ServiceAction;
    let cmdlet = match action {
        ServiceAction::Start => "Start-Service",
        ServiceAction::Stop => "Stop-Service",
        ServiceAction::Restart => "Restart-Service",
    };
    // The name travels in an environment variable, never spliced into the
    // script text, so no service name can inject PowerShell code.
    let script = format!("{cmdlet} -Name $env:MOONTASK_SERVICE -ErrorAction Stop");
    powershell(&script, Some(name)).map(|_| ()).map_err(|e| {
        if e.contains("Cannot open") || e.to_lowercase().contains("access") {
            format!("{e} (start MoonTask as administrator to control services)")
        } else {
            e
        }
    })
}

#[cfg(windows)]
fn powershell(script: &str, service: Option<&str>) -> Result<String, String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let mut command = std::process::Command::new("powershell.exe");
    command
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .creation_flags(CREATE_NO_WINDOW);
    if let Some(service) = service {
        command.env("MOONTASK_SERVICE", service);
    }
    super::output(command, "powershell")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_an_array() {
        let json = r#"[
            {"Name":"Spooler","DisplayName":"Print Spooler","State":"Running","StartMode":"Auto","ProcessId":2980,"Description":"Queues print jobs."},
            {"Name":"wuauserv","DisplayName":"Windows Update","State":"Stopped","StartMode":"Manual","ProcessId":0,"Description":null},
            {"Name":"BITS","DisplayName":"","State":"Start Pending","StartMode":"Auto","ProcessId":0,"Description":""}
        ]"#;
        let services = parse(json).unwrap();
        assert_eq!(services.len(), 3);
        let spooler = services.iter().find(|s| s.name == "Spooler").unwrap();
        assert_eq!(spooler.state, ServiceState::Running);
        assert_eq!(spooler.pid, Some(2980));
        assert_eq!(spooler.startup.as_deref(), Some("Auto"));
        let update = services.iter().find(|s| s.name == "wuauserv").unwrap();
        assert_eq!(update.pid, None);
        assert_eq!(update.description, None);
        let bits = services.iter().find(|s| s.name == "BITS").unwrap();
        assert_eq!(bits.display_name, "BITS");
        assert_eq!(bits.state, ServiceState::Starting);
    }

    #[test]
    fn parses_a_single_object_and_a_bom() {
        let json = "\u{feff}{\"Name\":\"One\",\"DisplayName\":\"Only one\",\"State\":\"Paused\",\"StartMode\":\"Disabled\",\"ProcessId\":0,\"Description\":\"x\"}";
        let services = parse(json).unwrap();
        assert_eq!(services.len(), 1);
        assert_eq!(services[0].state, ServiceState::Other);
        assert_eq!(services[0].raw_state, "Paused");
    }

    #[test]
    fn empty_output_is_an_empty_list() {
        assert!(parse("  ").unwrap().is_empty());
        assert!(parse("not json").is_err());
    }
}
