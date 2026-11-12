//! The runtime's home on iOS: a hidden `WKWebView` whose page starts the bundled runtime
//! (`dist/ios/runtime.js`, from `src/ios.ts`) in a Web Worker and relays between it and Rune.
//! Lines the worker posts are the render protocol the macOS app reads from its Bun child; the
//! host's lines go back through `outbox`, each batch evaluated in the page on the main thread.
use std::cell::{Cell, RefCell};
use std::io::Write;
use std::sync::{Mutex, OnceLock};

use dispatch2::DispatchQueue;
use hazel_native::shell::{self, Restarts, Routed, ShellRequest};
use hazel_native::wire::RuntimeMsg;
use hazel_native::{State, outbox};
use objc2::rc::Retained;
use objc2::runtime::{AnyObject, ProtocolObject};
use objc2::{MainThreadMarker, MainThreadOnly, define_class, extern_class, msg_send};
use objc2_core_foundation::{CGPoint, CGRect, CGSize};
use objc2_foundation::{
    NSDictionary, NSError, NSNumber, NSObject, NSObjectProtocol, NSString, NSURL, ns_string,
};
use objc2_ui_kit::{UIApplication, UIPasteboard, UIResponder, UIView, UIWindow, UIWindowScene};
use objc2_web_kit::{
    WKScriptMessage, WKScriptMessageHandler, WKUserContentController, WKWebViewConfiguration,
};
use rune::AppHandle;

use crate::page;

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
    /// The runtime's source and the bundle's environment, read once, for every page load.
    static BUNDLE: RefCell<Option<(String, Option<serde_json::Value>)>> = const { RefCell::new(None) };
    /// The page loaded last (0 before the first): only its `ready` releases the held lines.
    static PAGE: Cell<u64> = const { Cell::new(0) };
    /// Hears the page's process end (the web view holds it weakly).
    static NAVIGATION: RefCell<Option<Retained<PageNavigation>>> = const { RefCell::new(None) };
    /// A page replacing a runtime is loading: until it is ready, it is held only the window.
    static REPLACING: Cell<bool> = const { Cell::new(false) };
    /// Where the last full page load went; a restart goes back there.
    static LAST_PATH: RefCell<Option<String>> = const { RefCell::new(None) };
    static RESTARTS: RefCell<Restarts> = RefCell::new(Restarts::default());
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
                    if REPLACING.get() {
                        early.push(page::for_replacement(&text));
                    } else {
                        early.push(text);
                    }
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

/// A host reply to one of the worker's requests (an object, not a protocol line).
pub(crate) fn reply(message: &serde_json::Value) {
    let script = format!("__hazel.reply({message})");
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
    match shell::route(message) {
        Routed::Done => {}
        Routed::Window(message) => shell::apply(message, &handle),
        // A full page load (after sign-in or sign-out): a fresh runtime at that path.
        Routed::Shell(ShellRequest::Reload { path }) => {
            if let Some(mtm) = MainThreadMarker::new() {
                load_page(mtm, Some(&path));
                LAST_PATH.set(Some(path));
            }
        }
        Routed::Shell(ShellRequest::Update { .. } | ShellRequest::Relaunch { .. }) => {
            log("[host] updates are not on iOS");
        }
        // Not offered on iOS (no `HAZEL_NOTIFICATIONS`); a request still gets its answer.
        Routed::Shell(ShellRequest::NotifyPermission { id, .. }) => {
            outbox::write_line(shell::permission_reply(id, false));
        }
        Routed::Shell(ShellRequest::Notify { .. }) => {}
    }
}

/// A request from the worker that is not render protocol (`IosRequest` in `src/ios.ts`).
fn request(mtm: MainThreadMarker, body: &NSDictionary<NSString, AnyObject>) {
    let field = |name: &str| {
        body.objectForKey(&NSString::from_str(name))
            .and_then(|value| value.downcast::<NSString>().ok())
            .map(|value| value.to_string())
    };
    if let Some(ready) = body.objectForKey(ns_string!("ready")) {
        // The page can take lines now: the ones held until then go first. A page another load
        // replaced since says so too late; its lines stay held for the new one.
        let page = ready.downcast::<NSNumber>().ok().map(|n| n.as_u64());
        if page == Some(PAGE.get()) {
            REPLACING.set(false);
            for text in EARLY.take().unwrap_or_default() {
                to_worker(&text);
            }
        }
    } else if let Some(line) = field("log") {
        log(&line);
    } else if let (Some(url), Some(scheme)) = (field("signIn"), field("callbackScheme")) {
        crate::sign_in::start(mtm, &url, &scheme);
    } else if let Some(href) = field("open") {
        // As the runtime filters them: the system opens web and mail links, nothing else.
        if !hazel_native::wire::is_external_link(&href) {
            return log("[host] not opening a link that is not web or mail");
        }
        if let Some(url) = NSURL::URLWithString(&NSString::from_str(&href)) {
            let app = UIApplication::sharedApplication(mtm);
            unsafe { app.openURL_options_completionHandler(&url, &NSDictionary::new(), None) };
        }
    } else if let Some(text) = field("fetch") {
        crate::http::send(&text);
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

define_class!(
    // SAFETY: NSObject has no subclassing requirements; the class does not implement `Drop`.
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "HazelPageNavigation"]
    /// The page's navigation delegate, for the one event the host acts on.
    struct PageNavigation;

    unsafe impl NSObjectProtocol for PageNavigation {}

    impl PageNavigation {
        /// WebKit ended the page's process (memory pressure, a crash): the worker and the
        /// runtime in it are gone, so a fresh page starts another, as a browser reloads a tab.
        #[unsafe(method(webViewWebContentProcessDidTerminate:))]
        fn content_process_ended(&self, _web: &AnyObject) {
            if !RESTARTS.with_borrow_mut(|restarts| restarts.allow(std::time::Instant::now())) {
                return log("[host] the page's process keeps ending; not starting it again");
            }
            log("[host] the page's process ended; starting the runtime again");
            let path = LAST_PATH.with_borrow(Clone::clone);
            load_page(self.mtm(), path.as_deref());
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
    // The bundle's environment (`scripts/ios.ts` writes it).
    let bundled = read("environment.json").and_then(|text| serde_json::from_str(&text).ok());
    BUNDLE.set(Some((source, bundled)));

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
    let navigation: Retained<PageNavigation> = {
        let this = PageNavigation::alloc(mtm).set_ivars(());
        unsafe { msg_send![super(this), init] }
    };
    unsafe {
        let _: () = msg_send![&*web, setNavigationDelegate: &*navigation];
    }
    NAVIGATION.set(Some(navigation));
    WEB.set(Some(web));
    load_page(mtm, None);
    if let Some(handle) = HANDLE.get().map(|h| h.lock().unwrap().clone()) {
        crate::keyboard::observe(mtm, handle);
    }
    true
}

/// Loads the page, and with it a fresh runtime, at `path` (the bundle's start page for `None`).
/// Lines held for a runtime it replaces are dropped; from now on they wait for the new page.
fn load_page(mtm: MainThreadMarker, path: Option<&str>) {
    let Some(bundled) = BUNDLE.with_borrow(|bundle| bundle.as_ref().map(|(_, env)| env.clone()))
    else {
        return;
    };
    let Some(window) = window(mtm) else {
        return log("[host] the page cannot load without a window");
    };
    // The viewport as last reported, else the whole window and its safe area (the first report):
    // the page draws edge to edge.
    let (bounds, insets) = (window.bounds(), window.safeAreaInsets());
    let (size, inset) = hazel_native::last_env().map_or(
        (
            (bounds.size.width, bounds.size.height),
            [insets.top, insets.right, insets.bottom, insets.left],
        ),
        |env| {
            (
                (f64::from(env.width), f64::from(env.height)),
                env.inset.map(f64::from),
            )
        },
    );
    let env = page::environment(bundled, size, inset, path);
    if let Some(problem) = page::origin_problem(&env) {
        log(&format!("[host] {problem}"));
    }
    let origin = format!("{}/", page::origin(&env));
    let id = PAGE.get() + 1;
    if PAGE.replace(id) > 0 {
        EARLY.set(Some(Vec::new()));
        REPLACING.set(true);
        // A fresh runtime starts light at the bundle's size: it hears the window's as the
        // first one did, once its page is ready, and the window forgets the old one's trees.
        let handle = HANDLE.get().map(|h| h.lock().unwrap().clone());
        shell::runtime_replaced(handle.as_ref());
    }
    let Some(html) = BUNDLE.with_borrow(|bundle| {
        let (source, _) = bundle.as_ref()?;
        Some(NSString::from_str(&page::html(source, &env, id)))
    }) else {
        return;
    };
    let base = NSURL::URLWithString(&NSString::from_str(&origin));
    WEB.with_borrow(|web| {
        if let Some(web) = web {
            unsafe {
                let _: Option<Retained<AnyObject>> =
                    msg_send![&**web, loadHTMLString: &*html, baseURL: base.as_deref()];
            }
        }
    });
    log(&format!("[host] runtime started at {origin}"));
}
