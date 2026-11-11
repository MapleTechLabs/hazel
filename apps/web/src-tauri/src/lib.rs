use std::collections::HashMap;
use std::io::Read;
use std::sync::{Mutex, OnceLock};
use std::thread;
use tauri::{command, AppHandle, Emitter, Manager};
#[cfg(desktop)]
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri_plugin_decorum::WebviewWindowExt;
use tiny_http::{Header, Method, Response, Server};

// Port range for OAuth callback server (dynamic)
const OAUTH_PORT_MIN: u16 = 17900;
const OAUTH_PORT_MAX: u16 = 17999;

// Active nonces storage (port -> nonce mapping)
fn active_nonces() -> &'static Mutex<HashMap<u16, String>> {
    static NONCES: OnceLock<Mutex<HashMap<u16, String>>> = OnceLock::new();
    NONCES.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Generate a unique nonce for OAuth session
fn generate_nonce() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    // Add some randomness by mixing with thread id
    let thread_id = format!("{:?}", std::thread::current().id());
    format!("{:x}{}", timestamp, thread_id.len())
}

/// Create CORS headers for OAuth responses
fn cors_headers() -> Vec<Header> {
    vec![
        Header::from_bytes("Access-Control-Allow-Origin", "*").unwrap(),
        Header::from_bytes("Access-Control-Allow-Methods", "POST, OPTIONS").unwrap(),
        Header::from_bytes("Access-Control-Allow-Headers", "Content-Type").unwrap(),
        Header::from_bytes("Content-Type", "application/json").unwrap(),
        Header::from_bytes("Connection", "close").unwrap(),
    ]
}

/// Start OAuth server with dynamic port and nonce validation.
/// Returns (port, nonce) tuple for the frontend to use.
/// The web app callback page will POST auth data to this server.
#[command]
fn start_oauth_server(app: AppHandle) -> Result<(u16, String), String> {
    // Find available port
    let mut port = None;
    let mut server = None;
    for p in OAUTH_PORT_MIN..=OAUTH_PORT_MAX {
        if let Ok(s) = Server::http(format!("127.0.0.1:{}", p)) {
            port = Some(p);
            server = Some(s);
            break;
        }
    }
    let port = port.ok_or("No available ports in range 17900-17999")?;
    let server = server.unwrap();

    // Generate and store nonce
    let nonce = generate_nonce();
    {
        let mut nonces = active_nonces().lock().unwrap();
        nonces.insert(port, nonce.clone());
    }

    let app_handle = app.clone();
    let expected_nonce = nonce.clone();
    let server_port = port;

    thread::spawn(move || {
        // Handle up to 10 requests (OPTIONS preflight + POST + retries)
        for _ in 0..10 {
            let Ok(mut request) = server.recv() else {
                continue;
            };

            // Handle CORS preflight
            if *request.method() == Method::Options {
                let response = Response::empty(204)
                    .with_header(Header::from_bytes("Access-Control-Max-Age", "86400").unwrap());
                let response = cors_headers()
                    .into_iter()
                    .fold(response, |r, h| r.with_header(h));
                let _ = request.respond(response);
                continue;
            }

            // Handle POST
            if *request.method() == Method::Post {
                let mut body = String::new();
                if request.as_reader().read_to_string(&mut body).is_err() {
                    let response = Response::from_string(r#"{"error":"Failed to read body"}"#)
                        .with_status_code(400);
                    let response = cors_headers()
                        .into_iter()
                        .fold(response, |r, h| r.with_header(h));
                    let _ = request.respond(response);
                    continue;
                }

                let Ok(json): Result<serde_json::Value, _> = serde_json::from_str(&body) else {
                    let response =
                        Response::from_string(r#"{"error":"Invalid JSON"}"#).with_status_code(400);
                    let response = cors_headers()
                        .into_iter()
                        .fold(response, |r, h| r.with_header(h));
                    let _ = request.respond(response);
                    continue;
                };

                let code = json.get("code").and_then(|v| v.as_str());
                let nonce = json.get("nonce").and_then(|v| v.as_str());
                let state = json.get("state").and_then(|v| v.as_str());

                match (code, nonce, state) {
                    (Some(code), Some(nonce), Some(state)) if nonce == expected_nonce => {
                        // Clear nonce
                        {
                            let mut nonces = active_nonces().lock().unwrap();
                            nonces.remove(&server_port);
                        }

                        // Emit callback
                        let callback_url = format!(
                            "http://localhost:{}?code={}&state={}",
                            server_port,
                            urlencoding::encode(code),
                            urlencoding::encode(state)
                        );
                        let _ = app_handle.emit("oauth-callback", callback_url);

                        // Send success response with explicit content length
                        let body = r#"{"success":true}"#;
                        let response = Response::from_string(body)
                            .with_header(
                                Header::from_bytes("Content-Length", body.len().to_string())
                                    .unwrap(),
                            );
                        let response = cors_headers()
                            .into_iter()
                            .fold(response, |r, h| r.with_header(h));
                        let _ = request.respond(response);
                        // Delay to ensure response is fully sent before thread exits
                        thread::sleep(std::time::Duration::from_millis(500));
                        break;
                    }
                    (Some(_), Some(_), Some(_)) => {
                        let response = Response::from_string(r#"{"error":"Invalid nonce"}"#)
                            .with_status_code(403);
                        let response = cors_headers()
                            .into_iter()
                            .fold(response, |r, h| r.with_header(h));
                        let _ = request.respond(response);
                    }
                    _ => {
                        let response = Response::from_string(r#"{"error":"Missing fields"}"#)
                            .with_status_code(400);
                        let response = cors_headers()
                            .into_iter()
                            .fold(response, |r, h| r.with_header(h));
                        let _ = request.respond(response);
                    }
                }
            }
        }
    });

    Ok((port, nonce))
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

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .invoke_handler(tauri::generate_handler![start_oauth_server]);

    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_decorum::init());

    builder
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Configure custom titlebar with decorum
            #[cfg(desktop)]
            if let Some(main_window) = app.get_webview_window("main") {
                // Create overlay titlebar (handles Windows custom controls)
                main_window.create_overlay_titlebar().unwrap();

                // macOS: Position traffic lights
                #[cfg(target_os = "macos")]
                main_window.set_traffic_lights_inset(16.0, 20.0).unwrap();
            }

            // Create native menu
            #[cfg(desktop)]
            {
                let settings = MenuItem::with_id(app, "settings", "Settings...", true, Some("CmdOrCtrl+,"))?;
                let check_updates = MenuItem::with_id(app, "check_updates", "Check for Updates...", true, None::<&str>)?;

                let app_submenu = Submenu::with_items(
                    app,
                    "Hazel",
                    true,
                    &[
                        &settings,
                        &check_updates,
                        &PredefinedMenuItem::separator(app)?,
                        &PredefinedMenuItem::quit(app, Some("Quit Hazel"))?,
                    ],
                )?;

                let new_channel = MenuItem::with_id(app, "new_channel", "New Channel...", true, Some("CmdOrCtrl+Alt+N"))?;
                let invite = MenuItem::with_id(app, "invite", "Invite People...", true, Some("CmdOrCtrl+Alt+I"))?;

                let file_submenu = Submenu::with_items(
                    app,
                    "File",
                    true,
                    &[
                        &new_channel,
                        &PredefinedMenuItem::separator(app)?,
                        &invite,
                    ],
                )?;

                let menu = Menu::with_items(app, &[&app_submenu, &file_submenu])?;
                app.set_menu(menu)?;

                // Handle menu events
                let app_handle = app.handle().clone();
                app.on_menu_event(move |_app, event| {
                    match event.id().as_ref() {
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
                    }
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
