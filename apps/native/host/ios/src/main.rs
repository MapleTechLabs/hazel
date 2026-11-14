//! Hazel on iOS: the runtime runs in a Web Worker inside a hidden `WKWebView` (`bridge.rs`), and
//! Rune draws the tree it renders with `hazel_native`, as the macOS app draws its Bun child's.
#[cfg(target_os = "ios")]
mod bridge;
#[cfg(target_os = "ios")]
mod context_menu;
#[cfg(target_os = "ios")]
mod http;
#[cfg(target_os = "ios")]
mod islands;
#[cfg(target_os = "ios")]
mod keyboard;
#[cfg(target_os = "ios")]
mod menu_sheet;
#[cfg(any(test, target_os = "ios"))]
mod page;
#[cfg(target_os = "ios")]
mod push;
#[cfg(target_os = "ios")]
mod sign_in;
#[cfg(target_os = "ios")]
mod system;

#[cfg(target_os = "ios")]
fn main() {
    use hazel_native::{State, TEXT_SMOOTHING, dom_motion, frames, images, view, window_key};
    use rune::{App, AppSpec};

    bridge::mark_launch();
    dom_motion();
    // The app's public assets sit at the bundle's top, beside the binary.
    if let Some(bundle) = std::env::current_exe()
        .ok()
        .and_then(|exe| Some(exe.parent()?.join("public")))
    {
        images::set_assets_root(bundle);
    }
    let spec = AppSpec {
        setup: Some(|_: &mut State, waker| images::set_waker(waker)),
        poll: Some(bridge::poll),
        on_key: Some(window_key),
        // iOS gives the window the whole screen whatever size is asked for.
        ..AppSpec::new("Hazel", (402.0, 874.0), State::default, view)
    };
    // The UIKit views the app's `data-native` elements get, and HTML renders' web views, go
    // where their boxes were drawn, after every frame.
    islands::install();
    // Before the app runs, as Apple asks: a tap on a notification that launches it is heard.
    if let Some(mtm) = objc2::MainThreadMarker::new() {
        push::install(mtm);
    }
    let app = App::new(spec)
        .font_smoothing(TEXT_SMOOTHING)
        .on_frame_drawn(|runtime| {
            bridge::frame_drawn();
            frames::sync(runtime);
            hazel_native::islands::sync(runtime);
        });
    bridge::set_handle(app.handle());
    app.run();
}

#[cfg(not(target_os = "ios"))]
fn main() {
    eprintln!("hazel-ios runs on iOS: `bun run ios` in apps/native builds it for the simulator");
    std::process::exit(1);
}
