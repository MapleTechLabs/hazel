//! The hidden page the runtime's worker runs in: its HTML, its origin and the environment it hands
//! the worker. Plain data, so it is tested on the host (`cargo test -p hazel-ios`).
use serde_json::{Value, json};

/// The origin offline runs use: made up, and HTTPS, so the page is a secure context
/// (`crypto.randomUUID`, `crypto.subtle`). Nothing is fetched from it.
const OFFLINE_ORIGIN: &str = "https://app.hazel.test";
/// The web app a live build signs in through and talks to the API as, unless it names another.
const APP_URL: &str = "https://app.hazel.sh";

/// The page's origin. Live, the web app's own (`VITE_APP_URL`): WebKit checks the API's CORS
/// answers against it, and the API allows its web app. Offline, a made-up one.
pub fn origin(env: &Value) -> String {
    let live = env.get("HAZEL_DATA").and_then(Value::as_str) == Some("live");
    if !live {
        return OFFLINE_ORIGIN.to_string();
    }
    let app = env
        .get("VITE_APP_URL")
        .and_then(Value::as_str)
        .filter(|url| !url.is_empty());
    app.and_then(origin_of)
        .unwrap_or_else(|| APP_URL.to_string())
}

/// `scheme://host[:port]` of an absolute http(s) URL.
fn origin_of(url: &str) -> Option<String> {
    let (scheme, rest) = url.split_once("://")?;
    if !matches!(scheme, "http" | "https") {
        return None;
    }
    let host = rest
        .split(['/', '?', '#'])
        .next()
        .filter(|host| !host.is_empty())?;
    Some(format!("{scheme}://{host}"))
}

/// What the worker reads as `process.env`: the bundle's environment (`environment.json`) over the
/// viewport's size, the page's origin (for the app's `location`), and the path to open.
pub fn environment(bundled: Option<Value>, size: (f64, f64), path: Option<&str>) -> Value {
    let mut env = json!({
        "NATIVE_WIDTH": size.0.round().to_string(),
        "NATIVE_HEIGHT": size.1.round().to_string(),
    });
    let fields = env.as_object_mut().expect("an object");
    if let Some(Value::Object(bundled)) = bundled {
        fields.extend(bundled);
    }
    if let Some(path) = path {
        fields.insert("NATIVE_PATH".into(), path.into());
    }
    let origin = origin(&env);
    env["NATIVE_ORIGIN"] = origin.into();
    env
}

/// The page: it runs the runtime's source in a module worker (from a Blob, after the host's
/// environment) and relays between it and the host.
pub fn html(source: &str, env: &Value) -> String {
    let start = format!("__hazel.start({}, {})", json!(source), env);
    // Nothing in the inline script may end it early (`</script>`, `<!--`): every `<` is inside a
    // JSON string there, where `<` reads the same.
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_live_page_takes_the_web_apps_origin_and_an_offline_one_a_made_up_one() {
        assert_eq!(origin(&json!({})), "https://app.hazel.test");
        assert_eq!(
            origin(&json!({ "HAZEL_DATA": "offline" })),
            "https://app.hazel.test"
        );
        assert_eq!(
            origin(&json!({ "HAZEL_DATA": "live" })),
            "https://app.hazel.sh"
        );
        let dev = json!({ "HAZEL_DATA": "live", "VITE_APP_URL": "http://localhost:3100/chat?x=1" });
        assert_eq!(origin(&dev), "http://localhost:3100");
        let bad = json!({ "HAZEL_DATA": "live", "VITE_APP_URL": "tauri://localhost" });
        assert_eq!(origin(&bad), "https://app.hazel.sh");
    }

    #[test]
    fn the_environment_carries_size_bundle_path_and_origin() {
        let bundled = json!({ "HAZEL_DATA": "live", "NATIVE_DEBUG": "1" });
        let env = environment(Some(bundled), (402.4, 778.6), Some("/hazel/chat"));
        assert_eq!(
            env,
            json!({
                "NATIVE_WIDTH": "402", "NATIVE_HEIGHT": "779", "HAZEL_DATA": "live",
                "NATIVE_DEBUG": "1", "NATIVE_PATH": "/hazel/chat", "NATIVE_ORIGIN": "https://app.hazel.sh",
            })
        );
        // A path the bundle names gives way to the one a reload asks for.
        let reload = environment(Some(json!({ "NATIVE_PATH": "/" })), (1.0, 1.0), Some("/b"));
        assert_eq!(reload["NATIVE_PATH"], "/b");
        assert_eq!(
            environment(None, (1.0, 1.0), None)["NATIVE_ORIGIN"],
            OFFLINE_ORIGIN
        );
    }

    #[test]
    fn nothing_in_the_source_or_environment_ends_the_inline_script() {
        let source = r#"const a = "</script><script>alert(1)</script>"; // <!-- -->"#;
        let env = json!({ "NATIVE_PATH": "/</script>" });
        let page = html(source, &env);
        let (_, inline) = page.split_once("</script><script>").expect("two scripts");
        let inline = inline.strip_suffix("</script>").expect("one closing tag");
        assert!(!inline.contains('<'), "{inline}");
        // The escapes still read as the same strings.
        let call = inline
            .strip_prefix("__hazel.start(")
            .and_then(|s| s.strip_suffix(')'))
            .unwrap();
        let args: Value = serde_json::from_str(&format!("[{call}]")).unwrap();
        assert_eq!(args, json!([source, env]));
    }

    #[test]
    fn the_page_says_it_is_ready_before_it_starts_the_worker() {
        let page = html("", &json!({}));
        let ready = page
            .find("host.postMessage({ ready: true })")
            .expect("ready");
        let start = page.find("__hazel.start(").expect("start");
        assert!(ready < start);
        // Lines that arrive before the worker exists wait for it, in order.
        assert!(
            page.contains("worker === undefined ? early.push(line) : worker.postMessage(line)")
        );
        assert!(page.contains("for (const line of early.splice(0)) worker.postMessage(line)"));
    }
}
