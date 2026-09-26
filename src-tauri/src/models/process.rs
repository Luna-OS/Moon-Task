use serde::{Deserialize, Serialize};

/// One row of the process list. Sent every refresh, so it carries only
/// what the list shows and searches; everything else lives in
/// [`ProcessDetails`], which is fetched for the selected process only.
///
/// Byte counts are plain JSON numbers: a process would need 8 PiB of
/// memory before they lose precision in JavaScript.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessRow {
    pub pid: u32,
    pub parent_pid: Option<u32>,
    pub name: String,
    pub exe: Option<String>,
    /// The full command line, joined with spaces (for display and search).
    pub command: String,
    pub user: Option<String>,
    pub owner: Owner,
    pub status: ProcessState,
    /// CPU usage as a share of the *whole machine*, 0–100 (not per core
    /// like `top`, so the column always adds up to the CPU total).
    pub cpu: f32,
    /// GPU load of this process, 0–100 (its busiest engine); `None` where
    /// the platform can't attribute GPU load to processes.
    pub gpu: Option<f32>,
    /// Resident memory in bytes.
    pub memory: u64,
    pub virtual_memory: u64,
    pub threads: Option<u32>,
    /// Disk read/write in bytes per second since the last refresh.
    pub disk_read: u64,
    pub disk_write: u64,
    /// Unix timestamp in seconds. Together with `pid` it identifies a
    /// process unambiguously — PIDs get reused, start times don't repeat.
    pub start_time: u64,
    /// Ending, suspending or re-prioritizing this process would crash the
    /// system — or freeze MoonTask itself (see `monitor::classify`). The UI
    /// disables such actions; the backend refuses them regardless.
    pub protected: bool,
}

/// Who a process belongs to, from MoonTask's point of view.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Owner {
    /// Runs as the same user as MoonTask.
    Current,
    /// Another interactive user.
    Other,
    /// root/SYSTEM or a system service account.
    System,
    /// A kernel thread or the kernel itself.
    Kernel,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ProcessState {
    Running,
    Sleeping,
    Idle,
    /// Waiting for I/O (Linux "D" state).
    Waiting,
    /// Stopped by a signal or suspended.
    Stopped,
    Zombie,
    Dead,
    Unknown,
}

impl From<sysinfo::ProcessStatus> for ProcessState {
    fn from(status: sysinfo::ProcessStatus) -> Self {
        use sysinfo::ProcessStatus as S;
        match status {
            S::Run | S::Waking => ProcessState::Running,
            S::Sleep | S::Parked => ProcessState::Sleeping,
            S::Idle => ProcessState::Idle,
            S::UninterruptibleDiskSleep | S::LockBlocked | S::Wakekill => ProcessState::Waiting,
            S::Stop | S::Tracing | S::Suspended => ProcessState::Stopped,
            S::Zombie => ProcessState::Zombie,
            S::Dead => ProcessState::Dead,
            _ => ProcessState::Unknown,
        }
    }
}

/// Scheduling priority in the same six steps on every platform. On Unix
/// it maps onto nice values (see `platform::priority`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Priority {
    Idle,
    BelowNormal,
    Normal,
    AboveNormal,
    High,
    /// Shown when a process already has it, never set by MoonTask: a
    /// realtime process can starve the whole machine, input included.
    Realtime,
}

/// Everything about one process, for the detail panel.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessDetails {
    pub pid: u32,
    pub name: String,
    pub exe: Option<String>,
    pub command: Vec<String>,
    pub cwd: Option<String>,
    pub environment: Vec<EnvVar>,
    pub parent: Option<ProcessRef>,
    pub user: Option<String>,
    pub owner: Owner,
    pub status: ProcessState,
    pub start_time: u64,
    /// Seconds since start.
    pub run_time: u64,
    /// Total CPU time used, in milliseconds.
    pub cpu_time: u64,
    pub memory: u64,
    pub virtual_memory: u64,
    pub priority: Option<Priority>,
    /// The raw nice value on Unix (`None` on Windows).
    pub nice: Option<i32>,
    pub open_files: Option<u32>,
    pub total_disk_read: u64,
    pub total_disk_written: u64,
    /// `None` when the platform (or missing permissions) doesn't allow
    /// listing them — the UI says so instead of showing an empty table.
    pub threads: Option<Vec<ThreadRow>>,
    pub modules: Option<Vec<ModuleRow>>,
    pub handles: Option<Vec<HandleRow>>,
    pub protected: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvVar {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessRef {
    pub pid: u32,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadRow {
    pub tid: u32,
    pub name: Option<String>,
    pub state: Option<String>,
    /// Total CPU time of this thread in milliseconds, if known.
    pub cpu_time: Option<u64>,
    /// Nice value (Unix) or base priority (Windows).
    pub priority: Option<i32>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModuleRow {
    pub name: String,
    pub path: String,
    /// Load address, as a hex string (`0x7f…`) — it doesn't fit a JS number.
    pub base: Option<String>,
    /// Mapped size in bytes.
    pub size: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HandleRow {
    pub fd: u32,
    pub kind: HandleKind,
    pub target: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum HandleKind {
    File,
    Directory,
    Device,
    Socket,
    Pipe,
    Other,
}
