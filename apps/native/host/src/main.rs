//! Hazel's native window on macOS: runs Hazel's Foldkit app in a Bun child process and draws the
//! tree it renders (`hazel_native`), sending presses, edits and the window's size and theme back.
mod capture;
mod platform;
mod runtime;
mod updater;

use hazel_native::outbox::write_line;
use hazel_native::wire::RuntimeMsg;
use hazel_native::{
    State, TEXT_SMOOTHING, dom_motion, frames, images, note_scroll, poll, view, window_key,
};
use rune::{App, AppSpec};

use runtime::spawn_runtime;

/// The band the window's controls sit in, as the Tauri app's (`set_traffic_lights_inset(16, 20)`):
/// 40 points tall, the traffic lights 16 points in and centred. The web layout leaves this room
/// under `hasDesktopTitlebar`, and only `data-tauri-drag-region` elements move the window.
const TITLEBAR: rune::Titlebar = rune::Titlebar::new(40.0).traffic_lights(16.0, 13.0);

/// A link the system opened with the app (the sign-in callback): to the runtime as it came.
fn open_url(_: &mut State, url: &str, _: &mut rune::Tx) {
    write_line(hazel_native::sign_in::open_url_message(url));
}

fn window_size() -> (f32, f32) {
    let width = std::env::var("NATIVE_WIDTH")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(1280.0);
    let height = std::env::var("NATIVE_HEIGHT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(800.0);
    (width, height)
}

fn initial_state() -> State {
    State::new(std::env::var("NATIVE_THEME").as_deref() == Ok("dark"))
}

fn main() {
    dom_motion();
    if let Some(assets) = platform::bundled_assets() {
        images::set_assets_root(assets);
    }
    let args: Vec<String> = std::env::args().collect();
    if let Some(at) = args.iter().position(|a| a == "--capture") {
        let script = args.get(at + 1).expect("--capture <script.json>");
        capture::run(script);
        return;
    }
    let (mut child, messages) = spawn_runtime();
    // Block on the first tree so the window opens with the app in it.
    let mut initial = initial_state();
    for msg in messages.iter() {
        if let RuntimeMsg::Tree(tree) = msg {
            initial.apply(tree);
            break;
        }
    }
    let spec = AppSpec {
        setup: Some(|_: &mut State, waker| images::set_waker(waker)),
        poll: Some(poll),
        on_key: Some(window_key),
        ..AppSpec::new("Hazel", window_size(), State::default, view)
    };
    let app = App::new(spec)
        .font_smoothing(TEXT_SMOOTHING)
        .titlebar(TITLEBAR)
        .init(move || initial)
        .on_open_url(open_url)
        .on_frame_drawn(frames::sync);
    let handle = app.handle();
    std::thread::spawn(move || {
        for msg in messages.iter() {
            match msg {
                RuntimeMsg::Tree(tree) => handle.update_if(move |s: &mut State, _| s.apply(tree)),
                RuntimeMsg::Scroll { path, top, seq } => {
                    note_scroll(&path, seq);
                    handle.update(move |_: &mut State, tx| tx.scroll_to_instant(path, 0.0, top))
                }
                request => {
                    if let Some(run) = request.request() {
                        handle.update(move |_: &mut State, tx| run(tx))
                    }
                }
            }
        }
    });
    app.run();
    child.kill();
}
