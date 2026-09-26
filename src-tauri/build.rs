fn main() {
    // Only the Tauri app needs Tauri's build step; the headless core
    // (`--no-default-features`) is built without it.
    //
    // Unlike MoonDisk, MoonTask does not demand administrator rights on
    // Windows: watching processes works fine as a normal user, and the
    // actions that need more (ending another user's process, changing a
    // service) report a clear "access denied" instead. Start MoonTask
    // "as administrator" to manage everything.
    #[cfg(feature = "gui")]
    tauri_build::build();
}
