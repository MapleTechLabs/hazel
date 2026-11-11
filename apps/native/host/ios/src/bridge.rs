//! The runtime's home on iOS: a hidden `WKWebView` whose page starts the bundled runtime
//! (`dist/ios/runtime.js`, from `src/ios.ts`) in a Web Worker and relays between it and Rune.
//! Lines the worker posts are the render protocol the macOS app reads from its Bun child; the
//! host's lines go back through `outbox`, each batch evaluated in the page on the main thread.
use std::cell::{Cell, RefCell};
use std::io::Write;
use std::sync::{Mutex, OnceLock};

use dispatch2::DispatchQueue;
use hazel_native::wire::RuntimeMsg;
use hazel_native::{State, note_scroll, outbox};
use objc2::rc::Retained;
use objc2::runtime::{AnyObject, ProtocolObject};
use objc2::{MainThreadMarker, MainThreadOnly, define_class, extern_class, msg_send};
use objc2_core_foundation::{CGPoint, CGRect, CGSize};
use objc2_foundation::{
    NSDictionary, NSError, NSObject, NSObjectProtocol, NSString, NSURL, ns_string,
};
use objc2_ui_kit::{UIApplication, UIPasteboard, UIResponder, UIView, UIWindow, UIWindowScene};
use objc2_web_kit::{
    WKScriptMessage, WKScriptMessageHandler, WKUserContentController, WKWebViewConfiguration,
};
use rune::AppHandle;

/// The page's origin. HTTPS makes it a secure context, where the web APIs the app needs exist
/// (`crypto.randomUUID`, `crypto.subtle`); nothing is fetched from it.
const ORIGIN: &str = "https://app.hazel.test/";

extern_class!(
    /// WebKit's web view, a `UIView` on iOS (objc2-web-kit declares it for macOS only).
    #[unsafe(super(UIView, UIResponder, NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "WKWebView"]
    struct WebView;
);

static HANDLE: OnceLock<Mutex<AppHandle<State>>> = OnceLock::new();

thread_local! {
    static WEB: RefCell<Option<Retained<WebView>>> = const { RefCell::new(None) };
    /// The host's lines from before the page could take them (`None` once it said it is ready).
    static EARLY: RefCell<Option<Vec<String>>> = const { RefCell::new(Some(Vec::new())) };
    static STARTED: Cell<bool> = const { Cell::new(false) };
}

/// Where the runtime's trees go: the running app.
/// Lines from now on go to the worker, held until its page is ready: the first frames' size and
/// layout reports come before the window, and so the web view, exists.
pub fn set_handle(handle: AppHandle<State>) {
    let _ = HANDLE.set(Mutex::new(handle));
    outbox::set_writer(Box::new(ToWorker));
}

/// Each frame's poll; the first one, with the window up, starts the runtime.
pub fn poll(s: &mut State, at: f64, tx: &mut rune::Tx) -> bool {
    if !STARTED.get() {
        STARTED.set(start());
    }
    hazel_native::poll(s, at, tx)
}

/// A diagnostic line: stderr, and `hazel.log` in the app's temporary directory, which
/// `xcrun simctl get_app_container <device> sh.hazel.ios data` finds under `tmp/`.
pub fn log(line: &str) {
    eprintln!("{line}");
    let path = std::env::temp_dir().join("hazel.log");
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    {
        let _ = writeln!(file, "{line}");
    }
}

/// The host's lines, on to the worker: batched by `outbox`'s writer thread, evaluated on the main thread.
struct ToWorker;

impl Write for ToWorker {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        let text = String::from_utf8_lossy(buf).into_owned();
        DispatchQueue::main().exec_async(move || {
            // Held while the page is not ready yet; otherwise handed back to send now.
            let ready = EARLY.with_borrow_mut(|early| match early {
                Some(early) => {
                    early.push(text);
                    None
                }
                None => Some(text),
            });
            if let Some(text) = ready {
                to_worker(&text);
            }
        });
        Ok(buf.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

fn to_worker(text: &str) {
    let script = format!("__hazel.toWorker({})", json_string(text));
    WEB.with_borrow(|web| {
        if let Some(web) = web {
            evaluate(web, &script);
        }
    });
}

fn json_string(text: &str) -> String {
    serde_json::Value::String(text.to_string()).to_string()
}

fn evaluate(web: &WebView, script: &str) {
    // A page that cannot take the line (its script failed, `new Worker` refused) says so in the log.
    let handler = block2::RcBlock::new(|_result: *mut AnyObject, error: *mut NSError| {
        // SAFETY: WebKit passes a valid error, or null when the script ran.
        if let Some(error) = unsafe { error.as_ref() } {
            log(&format!(
                "[host] the page refused a line: {}",
                error.localizedDescription()
            ));
        }
    });
    unsafe {
        let _: () = msg_send![web, evaluateJavaScript: &*NSString::from_str(script), completionHandler: &*handler];
    }
}

/// One line the worker posted: a tree or a request for Rune, as the macOS app handles its child's.
fn receive(line: &str) {
    let message = match serde_json::from_str::<RuntimeMsg>(line) {
        Ok(message) => message,
        Err(error) => return log(&format!("[host] bad message: {error}")),
    };
    let Some(handle) = HANDLE.get().map(|h| h.lock().unwrap().clone()) else {
        return;
    };
    match message {
        RuntimeMsg::Tree(tree) => handle.update_if(move |s: &mut State, _| s.apply(tree)),
        RuntimeMsg::Scroll { path, top, seq } => {
            note_scroll(&path, seq);
            handle.update(move |_: &mut State, tx| tx.scroll_to_instant(path, 0.0, top));
        }
        RuntimeMsg::Reload { .. }
        | RuntimeMsg::Vault { .. }
        | RuntimeMsg::Update { .. }
        | RuntimeMsg::Relaunch { .. } => {
            log("[host] reload, keychain and updates are not on iOS yet");
        }
        request => {
            if let Some(run) = request.request() {
                handle.update(move |_: &mut State, tx| run(tx));
            }
        }
    }
}

/// A request from the worker that is not render protocol (`IosRequest` in `src/ios.ts`).
fn request(mtm: MainThreadMarker, body: &NSDictionary<NSString, AnyObject>) {
    let field = |name: &str| {
        body.objectForKey(&NSString::from_str(name))
            .and_then(|value| value.downcast::<NSString>().ok())
            .map(|value| value.to_string())
    };
    if body.objectForKey(ns_string!("ready")).is_some() {
        // The page can take lines now: the ones held until then go first.
        for text in EARLY.take().unwrap_or_default() {
            to_worker(&text);
        }
    } else if let Some(line) = field("log") {
        log(&line);
    } else if let Some(href) = field("open") {
        if let Some(url) = NSURL::URLWithString(&NSString::from_str(&href)) {
            let app = UIApplication::sharedApplication(mtm);
            unsafe { app.openURL_options_completionHandler(&url, &NSDictionary::new(), None) };
        }
    } else if let Some(text) = field("copy") {
        unsafe { UIPasteboard::generalPasteboard().setString(Some(&NSString::from_str(&text))) };
    }
}

define_class!(
    // SAFETY: NSObject has no subclassing requirements; the class does not implement `Drop`.
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "HazelRuntimeMessages"]
    /// What the runtime's page posts to the host.
    struct RuntimeMessages;

    unsafe impl NSObjectProtocol for RuntimeMessages {}

    unsafe impl WKScriptMessageHandler for RuntimeMessages {
        #[unsafe(method(userContentController:didReceiveScriptMessage:))]
        fn did_receive(&self, _controller: &WKUserContentController, message: &WKScriptMessage) {
            let body = unsafe { message.body() };
            if let Some(line) = body.downcast_ref::<NSString>() {
                receive(&line.to_string());
            } else if let Ok(fields) = body.downcast::<NSDictionary>() {
                // SAFETY: the page posts plain objects, which arrive with string keys.
                let fields = unsafe {
                    Retained::cast_unchecked::<NSDictionary<NSString, AnyObject>>(fields)
                };
                request(self.mtm(), &fields);
            }
        }
    }
);

/// The app's window, once the scene has one.
pub(crate) fn window(mtm: MainThreadMarker) -> Option<Retained<UIWindow>> {
    let scenes = UIApplication::sharedApplication(mtm).connectedScenes();
    scenes.iter().find_map(|scene| {
        let scene = scene.downcast::<UIWindowScene>().ok()?;
        scene.windows().firstObject()
    })
}

/// The page: it runs the runtime's source in a module worker (from a Blob, after the host's
/// environment) and relays between it and the host.
fn page(source: &str, env: &serde_json::Value) -> String {
    let start = format!("__hazel.start({}, {})", json_string(source), env);
    // Nothing in the inline script may end it early (`</script>`, `<!--`): every `<` is inside a
    // JSON string there, where `\u003c` reads the same.
    let start = start.replace('<', "\\u003c");
    format!(
        r#"<!doctype html><meta charset="utf-8"><script>
const host = window.webkit.messageHandlers.hazel
let worker
const early = []
window.__hazel = {{
    start(source, env) {{
        const head = `globalThis.__HAZEL_ENV__ = ${{JSON.stringify(env)}};\n`
        const url = URL.createObjectURL(new Blob([head, source], {{ type: "text/javascript" }}))
        worker = new Worker(url, {{ type: "module" }})
        worker.onmessage = (event) => host.postMessage(event.data)
        worker.onerror = (event) =>
            host.postMessage({{ log: `[worker] ${{event.message}} ${{event.filename}}:${{event.lineno}}` }})
        for (const line of early.splice(0)) worker.postMessage(line)
    }},
    toWorker(text) {{
        for (const line of text.split("\n"))
            if (line !== "") worker === undefined ? early.push(line) : worker.postMessage(line)
    }},
}}
host.postMessage({{ ready: true }})
</script><script>{start}</script>"#
    )
}

/// Builds the hidden web view in the window and loads the runtime; false until the window exists.
fn start() -> bool {
    let Some(mtm) = MainThreadMarker::new() else {
        return false;
    };
    let Some(window) = window(mtm) else {
        return false;
    };
    let bundle = std::env::current_exe()
        .ok()
        .and_then(|exe| Some(exe.parent()?.to_path_buf()));
    let read = |name: &str| {
        bundle
            .as_ref()
            .and_then(|dir| std::fs::read_to_string(dir.join(name)).ok())
    };
    let Some(source) = read("runtime.js") else {
        log("[host] runtime.js is missing from the bundle");
        return true;
    };
    // The bundle's environment (`scripts/ios.ts` writes it), over the window's size.
    // The page's first size: the window inside its safe area, as the host's first report says.
    let (bounds, insets) = (window.bounds(), window.safeAreaInsets());
    let mut env = serde_json::json!({
        "NATIVE_WIDTH": (bounds.size.width - insets.left - insets.right).round().to_string(),
        "NATIVE_HEIGHT": (bounds.size.height - insets.top - insets.bottom).round().to_string(),
    });
    if let Some(serde_json::Value::Object(bundled)) =
        read("environment.json").and_then(|text| serde_json::from_str(&text).ok())
    {
        env.as_object_mut().expect("an object").extend(bundled);
    }

    let configuration = unsafe { WKWebViewConfiguration::new(mtm) };
    let messages: Retained<RuntimeMessages> = {
        let this = RuntimeMessages::alloc(mtm).set_ivars(());
        unsafe { msg_send![super(this), init] }
    };
    unsafe {
        configuration
            .userContentController()
            .addScriptMessageHandler_name(
                ProtocolObject::from_ref(&*messages),
                ns_string!("hazel"),
            );
    }
    // In the window, so WebKit keeps the worker running, but a point wide, under Rune's view.
    let frame = CGRect::new(CGPoint::new(0.0, 0.0), CGSize::new(1.0, 1.0));
    let web: Retained<WebView> = unsafe {
        msg_send![WebView::alloc(mtm), initWithFrame: frame, configuration: &*configuration]
    };
    window.insertSubview_atIndex(&web, 0);
    let html = NSString::from_str(&page(&source, &env));
    let origin = NSURL::URLWithString(ns_string!(ORIGIN));
    unsafe {
        let _: Option<Retained<AnyObject>> =
            msg_send![&*web, loadHTMLString: &*html, baseURL: origin.as_deref()];
    }
    WEB.set(Some(web));
    if let Some(handle) = HANDLE.get().map(|h| h.lock().unwrap().clone()) {
        crate::keyboard::observe(mtm, handle);
    }
    log("[host] runtime started");
    true
}
