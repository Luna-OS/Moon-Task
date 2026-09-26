use super::process::ProcessRow;
use serde::Serialize;

/// Facts about the machine that don't change while MoonTask runs. Fetched
/// once at start.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    pub app_version: String,
    /// "windows", "linux" or "macos" — lets the frontend hide actions a
    /// platform doesn't have (e.g. suspend on nothing but Unix signals).
    pub platform: &'static str,
    pub host_name: Option<String>,
    pub os_name: Option<String>,
    pub os_version: Option<String>,
    pub kernel_version: Option<String>,
    pub arch: String,
    pub cpu_brand: String,
    pub physical_cores: Option<usize>,
    pub logical_cores: usize,
    pub total_memory: u64,
    pub boot_time: u64,
    /// MoonTask's own PID, so the UI can mark (and protect) it.
    pub self_pid: u32,
}

/// One refresh worth of live data. The frontend polls this at the chosen
/// refresh interval and keeps the history for charts itself.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    /// Milliseconds since the Unix epoch.
    pub timestamp: u64,
    /// The real time the rates below were measured over, in milliseconds.
    pub interval_ms: u64,
    pub uptime: u64,
    pub cpu: CpuStats,
    pub memory: MemoryStats,
    pub load: Option<LoadAverage>,
    pub network: NetworkStats,
    pub disk: DiskStats,
    pub sensors: Vec<Sensor>,
    pub gpus: Vec<Gpu>,
    pub processes: Vec<ProcessRow>,
    pub process_count: usize,
    pub thread_count: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CpuStats {
    /// 0–100.
    pub total: f32,
    pub cores: Vec<CoreStats>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoreStats {
    pub usage: f32,
    /// MHz.
    pub frequency: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryStats {
    pub total: u64,
    pub used: u64,
    pub available: u64,
    pub swap_total: u64,
    pub swap_used: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadAverage {
    pub one: f64,
    pub five: f64,
    pub fifteen: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkStats {
    /// Bytes per second over all interfaces except loopback.
    pub rx_rate: u64,
    pub tx_rate: u64,
    pub interfaces: Vec<NetworkInterface>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkInterface {
    pub name: String,
    pub rx_rate: u64,
    pub tx_rate: u64,
    pub total_rx: u64,
    pub total_tx: u64,
    pub loopback: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskStats {
    /// Bytes per second over all physical disks.
    pub read_rate: u64,
    pub write_rate: u64,
    pub volumes: Vec<Volume>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Volume {
    pub name: String,
    pub mount_point: String,
    pub file_system: String,
    pub total: u64,
    pub available: u64,
    pub removable: bool,
    /// "ssd", "hdd" or "unknown".
    pub kind: &'static str,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Sensor {
    pub label: String,
    /// °C.
    pub temperature: f32,
    pub critical: Option<f32>,
}

/// A graphics card. Every figure is optional: what a card reports depends
/// on vendor, driver and platform.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Gpu {
    pub name: String,
    pub vendor: Option<&'static str>,
    /// Overall load, 0–100: the busiest engine's, like Task Manager.
    pub utilization: Option<f32>,
    /// Load per engine type (3D, Video Decode, Copy, …), busiest first.
    pub engines: Vec<GpuEngine>,
    /// Dedicated video memory in bytes.
    pub memory_used: Option<u64>,
    pub memory_total: Option<u64>,
    /// System memory the GPU uses (Windows "shared", AMD "GTT").
    pub shared_used: Option<u64>,
    pub shared_total: Option<u64>,
    /// °C.
    pub temperature: Option<f32>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuEngine {
    pub name: String,
    pub utilization: f32,
}
