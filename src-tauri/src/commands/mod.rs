//! Tauri IPC layer: thin commands that deserialize, delegate to
//! `monitor`/`control`/`services`/`network`, and map errors to strings.
//! No business logic lives here.
//!
//! Every command is `async` and does its work on a blocking worker thread:
//! synchronous Tauri commands run on the main thread, and a slow
//! `systemctl` or socket scan must never freeze the window.

use crate::control::{self, ActionOutcome, ActionRequest};
use crate::models::{Connection, ProcessDetails, Service, ServiceAction, Snapshot, SystemInfo};
use crate::monitor::Monitor;
use crate::{network, platform, services};
use std::sync::{Arc, Mutex, MutexGuard};

/// The monitor is created on first use, on a worker thread — never on the
/// main thread, which belongs to the window and WebView2: anything that
/// initializes COM there first (as sysinfo's WMI code did) makes the
/// webview fail to start.
type SharedMonitor = Arc<Mutex<Option<Monitor>>>;

pub struct AppState {
    monitor: SharedMonitor,
}

impl AppState {
    pub fn new() -> Self {
        AppState {
            monitor: Arc::new(Mutex::new(None)),
        }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}

/// Runs `work` with the monitor, creating it on first use.
fn with_monitor<T>(
    monitor: &Mutex<Option<Monitor>>,
    work: impl FnOnce(&mut Monitor) -> Result<T, String>,
) -> Result<T, String> {
    let mut guard: MutexGuard<'_, Option<Monitor>> = monitor
        .lock()
        .map_err(|_| "internal state is corrupted".to_string())?;
    work(guard.get_or_insert_with(Monitor::new))
}

/// Runs `work` on a blocking worker thread.
async fn blocking<T, F>(work: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| format!("background task failed: {e}"))?
}

#[tauri::command]
pub async fn system_info(state: tauri::State<'_, AppState>) -> Result<SystemInfo, String> {
    let monitor = state.monitor.clone();
    blocking(move || with_monitor(&monitor, |m| Ok(m.system_info()))).await
}

#[tauri::command]
pub async fn snapshot(state: tauri::State<'_, AppState>) -> Result<Snapshot, String> {
    let monitor = state.monitor.clone();
    blocking(move || with_monitor(&monitor, |m| Ok(m.snapshot()))).await
}

#[tauri::command]
pub async fn process_details(
    state: tauri::State<'_, AppState>,
    pid: u32,
) -> Result<ProcessDetails, String> {
    let monitor = state.monitor.clone();
    blocking(move || with_monitor(&monitor, |m| m.details(pid))).await
}

/// Runs a process action. `confirmed` must be `true` for anything
/// `control::guard` rates as high risk — the frontend asks first, and this
/// is checked again here regardless of what the UI showed.
#[tauri::command]
pub async fn process_action(
    state: tauri::State<'_, AppState>,
    request: ActionRequest,
    confirmed: bool,
) -> Result<ActionOutcome, String> {
    let monitor = state.monitor.clone();
    blocking(move || {
        with_monitor(&monitor, |m| {
            control::execute(m, &request, confirmed).map_err(|e| e.to_string())
        })
    })
    .await
}

/// Shows a process' executable in the file manager. Takes a PID, not a
/// path: the frontend never gets to name a file to open.
#[tauri::command]
pub async fn process_reveal(state: tauri::State<'_, AppState>, pid: u32) -> Result<(), String> {
    let monitor = state.monitor.clone();
    blocking(move || {
        let exe = with_monitor(&monitor, |m| {
            m.exe_of(pid)
                .ok_or_else(|| "the executable's location is unknown".to_string())
        })?;
        platform::reveal_in_file_manager(&exe)
    })
    .await
}

#[tauri::command]
pub async fn connections_list() -> Result<Vec<Connection>, String> {
    blocking(network::list_connections).await
}

#[tauri::command]
pub async fn services_list() -> Result<Vec<Service>, String> {
    blocking(services::list).await
}

#[tauri::command]
pub async fn service_action(
    name: String,
    action: ServiceAction,
    confirmed: bool,
) -> Result<(), String> {
    blocking(move || services::control(&name, action, confirmed)).await
}
