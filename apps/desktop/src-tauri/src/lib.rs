#[cfg(desktop)]
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{command, Emitter, Manager};

/// The desktop sign-in vault (`@hazel/auth/desktop`): one opaque JSON record holding the app's
/// session and any sign-in in progress, kept in the OS keychain (Keychain, Credential Manager,
/// Secret Service). The webview never sees the keychain itself, only this record.
const VAULT_SERVICE: &str = "com.hazel.app";
const VAULT_ACCOUNT: &str = "auth";

#[cfg(desktop)]
fn vault_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(VAULT_SERVICE, VAULT_ACCOUNT).map_err(|error| error.to_string())
}

#[command]
fn auth_vault_read() -> Result<Option<String>, String> {
    #[cfg(desktop)]
    {
        match vault_entry()?.get_password() {
            Ok(record) => Ok(Some(record)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(error.to_string()),
        }
    }
    #[cfg(not(desktop))]
    Err("unsupported".into())
}

#[command]
fn auth_vault_write(record: String) -> Result<(), String> {
    #[cfg(desktop)]
    {
        vault_entry()?
            .set_password(&record)
            .map_err(|error| error.to_string())
    }
    #[cfg(not(desktop))]
    {
        let _ = record;
        Err("unsupported".into())
    }
}

/// Holding a key should open the macOS accent picker (e.g. hold "s" for "ß") instead of
/// repeating it. The webview doesn't turn this on by itself, so register it as the app default.
/// A user's own `defaults write` setting still wins over this.
#[cfg(target_os = "macos")]
fn enable_press_and_hold() {
    use objc2::runtime::AnyObject;
    use objc2_foundation::{NSDictionary, NSNumber, NSString, NSUserDefaults};

    let key = NSString::from_str("ApplePressAndHoldEnabled");
    let value = NSNumber::new_bool(true);
    let value: &AnyObject = &value;
    let defaults = NSDictionary::from_slices(&[&*key], &[value]);
    unsafe { NSUserDefaults::standardUserDefaults().registerDefaults(&defaults) };
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "macos")]
    enable_press_and_hold();

    let builder = tauri::Builder::default();

    // Must be the first plugin: a second launch (a `com.hazel.app://` link on Windows and
    // Linux) hands its arguments to the running app, and the deep-link plugin picks them up.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    }));

    let builder = builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .invoke_handler(tauri::generate_handler![auth_vault_read, auth_vault_write]);

    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());

    builder
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // macOS registers the link schemes from the bundle; Windows and Linux at runtime.
            #[cfg(any(windows, target_os = "linux"))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                app.deep_link().register_all()?;
            }

            // Windows and Linux keep the system's own titlebar; on macOS the window draws its
            // content under the traffic lights (`titleBarStyle`, `trafficLightPosition`).

            // Create native menu
            #[cfg(desktop)]
            {
                let settings =
                    MenuItem::with_id(app, "settings", "Settings...", true, Some("CmdOrCtrl+,"))?;
                let check_updates = MenuItem::with_id(
                    app,
                    "check_updates",
                    "Check for Updates...",
                    true,
                    None::<&str>,
                )?;

                let app_submenu = Submenu::with_items(
                    app,
                    "Hazel",
                    true,
                    &[
                        &settings,
                        &check_updates,
                        #[cfg(target_os = "macos")]
                        &PredefinedMenuItem::separator(app)?,
                        #[cfg(target_os = "macos")]
                        &PredefinedMenuItem::hide(app, None::<&str>)?,
                        &PredefinedMenuItem::separator(app)?,
                        &PredefinedMenuItem::quit(app, Some("Quit Hazel"))?,
                    ],
                )?;

                let new_channel = MenuItem::with_id(
                    app,
                    "new_channel",
                    "New Channel...",
                    true,
                    Some("CmdOrCtrl+Alt+N"),
                )?;
                let invite = MenuItem::with_id(
                    app,
                    "invite",
                    "Invite People...",
                    true,
                    Some("CmdOrCtrl+Alt+I"),
                )?;

                let file_submenu = Submenu::with_items(
                    app,
                    "File",
                    true,
                    &[&new_channel, &PredefinedMenuItem::separator(app)?, &invite],
                )?;

                #[cfg(target_os = "macos")]
                let edit_submenu = Submenu::with_items(
                    app,
                    "Edit",
                    true,
                    &[
                        &PredefinedMenuItem::undo(app, None::<&str>)?,
                        &PredefinedMenuItem::redo(app, None::<&str>)?,
                        &PredefinedMenuItem::separator(app)?,
                        &PredefinedMenuItem::cut(app, None::<&str>)?,
                        &PredefinedMenuItem::copy(app, None::<&str>)?,
                        &PredefinedMenuItem::paste(app, None::<&str>)?,
                        &PredefinedMenuItem::separator(app)?,
                        &PredefinedMenuItem::select_all(app, None::<&str>)?,
                    ],
                )?;
                #[cfg(not(target_os = "macos"))]
                let edit_submenu = Submenu::with_items(
                    app,
                    "Edit",
                    true,
                    &[
                        &PredefinedMenuItem::cut(app, None::<&str>)?,
                        &PredefinedMenuItem::copy(app, None::<&str>)?,
                        &PredefinedMenuItem::paste(app, None::<&str>)?,
                        &PredefinedMenuItem::separator(app)?,
                        &PredefinedMenuItem::select_all(app, None::<&str>)?,
                    ],
                )?;

                #[cfg(target_os = "macos")]
                let window_submenu = Submenu::with_items(
                    app,
                    "Window",
                    true,
                    &[&PredefinedMenuItem::minimize(app, None::<&str>)?],
                )?;

                #[cfg(target_os = "macos")]
                let menu =
                    Menu::with_items(app, &[&app_submenu, &file_submenu, &edit_submenu, &window_submenu])?;
                #[cfg(not(target_os = "macos"))]
                let menu = Menu::with_items(app, &[&app_submenu, &file_submenu, &edit_submenu])?;
                app.set_menu(menu)?;

                // Handle menu events
                let app_handle = app.handle().clone();
                app.on_menu_event(move |_app, event| match event.id().as_ref() {
                    "settings" => {
                        let _ = app_handle.emit("menu-open-settings", ());
                    }
                    "check_updates" => {
                        let _ = app_handle.emit("menu-check-updates", ());
                    }
                    "new_channel" => {
                        let _ = app_handle.emit("menu-new-channel", ());
                    }
                    "invite" => {
                        let _ = app_handle.emit("menu-invite", ());
                    }
                    _ => {}
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
