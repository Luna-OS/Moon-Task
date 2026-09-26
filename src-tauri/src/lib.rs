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
pub mod gpu;
pub mod models;
pub mod monitor;
pub mod network;
pub mod platform;
pub mod services;

/// Release builds abort on panic without a console, so a crash would leave
/// no trace. Write the panic message to `moontask-crash.log` in the temp
/// directory first, so users can send it in.
#[cfg(feature = "gui")]
fn install_crash_log() {
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let path = std::env::temp_dir().join("moontask-crash.log");
        let _ = std::fs::write(
            &path,
            format!(
                "MoonTask {} crashed.\n\n{info}\n\n{}\n",
                env!("CARGO_PKG_VERSION"),
                std::backtrace::Backtrace::force_capture()
            ),
        );
        default_hook(info);
    }));
}

#[cfg(feature = "gui")]
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    install_crash_log();
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
