use serde::{Deserialize, Serialize};

/// A system service (systemd unit, Windows service or launchd job).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Service {
    /// The name the service manager knows it by (`sshd.service`, `Spooler`,
    /// `com.apple.Finder`). Also the key for [`ServiceAction`]s.
    pub name: String,
    pub display_name: String,
    pub description: Option<String>,
    pub state: ServiceState,
    /// The manager's own state text (`active (running)`, `Stopped`, …),
    /// shown as-is next to the simplified [`ServiceState`].
    pub raw_state: String,
    /// How it starts: `enabled`/`disabled`/`static` (systemd),
    /// `Auto`/`Manual`/`Disabled` (Windows); `None` on macOS.
    pub startup: Option<String>,
    pub pid: Option<u32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ServiceState {
    Running,
    Stopped,
    Starting,
    Stopping,
    Failed,
    Other,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ServiceAction {
    Start,
    Stop,
    Restart,
}

impl ServiceAction {
    pub fn verb(self) -> &'static str {
        match self {
            ServiceAction::Start => "start",
            ServiceAction::Stop => "stop",
            ServiceAction::Restart => "restart",
        }
    }
}
