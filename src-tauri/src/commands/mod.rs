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

pub struct AppState {
    monitor: Arc<Mutex<Monitor>>,
}

impl AppState {
    pub fn new() -> Self {
        AppState {
            monitor: Arc::new(Mutex::new(Monitor::new())),
        }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}

fn lock(monitor: &Mutex<Monitor>) -> Result<MutexGuard<'_, Monitor>, String> {
    monitor
        .lock()
        .map_err(|_| "internal state is corrupted".to_string())
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
    blocking(move || Ok(lock(&monitor)?.system_info())).await
}

#[tauri::command]
pub async fn snapshot(state: tauri::State<'_, AppState>) -> Result<Snapshot, String> {
    let monitor = state.monitor.clone();
    blocking(move || Ok(lock(&monitor)?.snapshot())).await
}

#[tauri::command]
pub async fn process_details(
    state: tauri::State<'_, AppState>,
    pid: u32,
) -> Result<ProcessDetails, String> {
    let monitor = state.monitor.clone();
    blocking(move || lock(&monitor)?.details(pid)).await
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
        control::execute(&mut *lock(&monitor)?, &request, confirmed).map_err(|e| e.to_string())
    })
    .await
}

/// Shows a process' executable in the file manager. Takes a PID, not a
/// path: the frontend never gets to name a file to open.
#[tauri::command]
pub async fn process_reveal(state: tauri::State<'_, AppState>, pid: u32) -> Result<(), String> {
    let monitor = state.monitor.clone();
    blocking(move || {
        let exe = lock(&monitor)?
            .exe_of(pid)
            .ok_or_else(|| "the executable's location is unknown".to_string())?;
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
