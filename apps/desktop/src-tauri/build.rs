fn main() {
    // Declaring the app's own commands puts them under the capabilities' ACL: without a manifest,
    // Tauri lets any page the webview shows call them, the keychain vault included.
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&["auth_vault_read", "auth_vault_write"]),
    ))
    .expect("failed to run tauri-build");
}
