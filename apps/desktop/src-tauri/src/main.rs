// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// On macOS Chromium runs this same executable as its renderer, GPU and utility processes: for
/// those (a `--type=` switch) the attribute runs CEF's helper side and returns before the app is built.
#[cfg_attr(target_os = "macos", tauri_runtime_cef::cef_entry_point)]
fn main() {
    app_lib::run();
}
