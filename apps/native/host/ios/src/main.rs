//! Hazel on iOS: the runtime runs in a Web Worker inside a hidden `WKWebView` (`bridge.rs`), and
//! Rune draws the tree it renders with `hazel_native`, as the macOS app draws its Bun child's.
#[cfg(target_os = "ios")]
mod bridge;
#[cfg(target_os = "ios")]
mod keyboard;
#[cfg(any(test, target_os = "ios"))]
mod page;
#[cfg(target_os = "ios")]
mod sign_in;

#[cfg(target_os = "ios")]
fn main() {
    use hazel_native::{State, TEXT_SMOOTHING, dom_motion, images, view, window_key};
    use rune::{App, AppSpec};

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
    let app = App::new(spec).font_smoothing(TEXT_SMOOTHING);
    bridge::set_handle(app.handle());
    app.run();
}

#[cfg(not(target_os = "ios"))]
fn main() {
    eprintln!("hazel-ios runs on iOS: `bun run ios` in apps/native builds it for the simulator");
    std::process::exit(1);
}
