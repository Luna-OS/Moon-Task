//! MoonTask – Tauri application entry point.
//!
//! Layout: `monitor` watches the machine, `control` acts on processes
//! (always through `control::guard`), `services` and `network` cover the
//! service manager and open sockets, and `platform` holds everything that
//! differs between Windows, Linux and macOS. `commands` is the thin IPC
//! layer on top.

#[cfg(feature = "gui")]
pub mod commands;
pub mod control;
pub mod models;
pub mod monitor;
pub mod network;
pub mod platform;
pub mod services;

#[cfg(feature = "gui")]
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(commands::AppState::new())
        .invoke_handler(tauri::generate_handler![
            commands::system_info,
            commands::snapshot,
            commands::process_details,
            commands::process_action,
            commands::process_reveal,
            commands::connections_list,
            commands::services_list,
            commands::service_action,
        ])
        .run(tauri::generate_context!())
        .expect("error while running the MoonTask application");
}
