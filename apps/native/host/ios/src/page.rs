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

/// `scheme://host[:port]` of an absolute http(s) URL (no user info).
fn origin_of(url: &str) -> Option<String> {
    let (scheme, rest) = url.split_once("://")?;
    let scheme = scheme.to_ascii_lowercase();
    if !matches!(scheme.as_str(), "http" | "https") {
        return None;
    }
    let authority = rest.split(['/', '?', '#']).next()?;
    let host = authority
        .rsplit_once('@')
        .map_or(authority, |(_, host)| host);
    (!host.is_empty()).then(|| format!("{scheme}://{host}"))
}

/// Why a live page could not take the web app's origin it was given, and uses production's.
pub fn origin_problem(env: &Value) -> Option<String> {
    let live = env.get("HAZEL_DATA").and_then(Value::as_str) == Some("live");
    let app = env
        .get("VITE_APP_URL")
        .and_then(Value::as_str)
        .filter(|url| !url.is_empty())?;
    (live && origin_of(app).is_none())
        .then(|| format!("VITE_APP_URL {app:?} is no http(s) URL: the page takes {APP_URL}"))
}

/// What the worker reads as `process.env`: the bundle's environment (`environment.json`) over the
/// viewport's size and safe area (top, right, bottom, left), the page's origin (for the app's
/// `location`), and the path to open.
pub fn environment(
    bundled: Option<Value>,
    size: (f64, f64),
    inset: [f64; 4],
    path: Option<&str>,
) -> Value {
    let mut env = json!({
        "NATIVE_WIDTH": size.0.round().to_string(),
        "NATIVE_HEIGHT": size.1.round().to_string(),
        "NATIVE_INSET": inset.map(|edge| edge.max(0.0).round().to_string()).join(" "),
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
/// environment and `storage`: the saved `localStorage` entries, one JSON object of strings, which
/// the worker reads as that object) and relays between it and the host.
pub fn html(source: &str, env: &Value, storage: Option<&str>, id: u64) -> String {
    let start = format!(
        "__hazel.start({}, {}, {})",
        json!(source),
        env,
        json!(storage)
    );
    // Nothing in the inline script may end it early (`</script>`, `<!--`): every `<` is inside a
    // JSON string there, where `\u003c` reads the same.
    let start = start.replace('<', "\\u003c");
    format!(
        r#"<!doctype html><meta charset="utf-8"><script>
const host = window.webkit.messageHandlers.hazel
let worker
const early = []
window.__hazel = {{
    start(source, env, storage) {{
        // Parsed in the worker, not written as an object: a key such as `__proto__` stays a key.
        const head =
            `globalThis.__HAZEL_ENV__ = ${{JSON.stringify(env)}};\n` +
            `globalThis.__HAZEL_STORAGE__ = JSON.parse(${{JSON.stringify(storage ?? "null")}});\n`
        const url = URL.createObjectURL(new Blob([head, source], {{ type: "text/javascript" }}))
        worker = new Worker(url, {{ type: "module" }})
        worker.onmessage = (event) => host.postMessage(event.data)
        worker.onerror = (event) =>
            host.postMessage({{ log: `[worker] ${{event.message}} ${{event.filename}}:${{event.lineno}}` }})
        for (const batch of early.splice(0)) worker.postMessage(batch)
    }},
    reply(message) {{
        worker?.postMessage(message)
    }},
    // A frame's lines cross in one message, as they do down the desktop's pipe: the worker
    // splits them, and handles a frame's reports in one task.
    toWorker(text) {{
        if (text !== "") worker === undefined ? early.push(text) : worker.postMessage(text)
    }},
}}
host.postMessage({{ ready: {id} }})
</script><script>{start}</script>"#
    )
}

/// The lines of a batch a replacing page's runtime should still hear: the window's size, theme
/// and safe area. Events and layout reports name the replaced runtime's tree, not the new one's.
pub fn for_replacement(text: &str) -> String {
    text.lines()
        .filter(|line| serde_json::from_str::<Value>(line).is_ok_and(|v| v["t"] == "env"))
        .map(|line| format!("{line}\n"))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_replacing_page_hears_only_the_window() {
        let batch = concat!(
            r#"{"t":"event","seq":3,"gen":7,"id":12,"type":"click"}"#,
            "\n",
            r#"{"t":"env","width":402,"height":778,"dark":true}"#,
            "\n",
            r#"{"t":"layout","path":"r/1","x":0,"y":0,"w":10,"h":10}"#,
            "\n",
        );
        assert_eq!(
            for_replacement(batch),
            "{\"t\":\"env\",\"width\":402,\"height\":778,\"dark\":true}\n"
        );
        assert_eq!(for_replacement("not json\n"), "");
    }

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
        assert!(origin_problem(&bad).is_some());
        assert_eq!(origin_problem(&dev), None);
        let odd = json!({ "HAZEL_DATA": "live", "VITE_APP_URL": "HTTPS://me@app.example.com/x" });
        assert_eq!(origin(&odd), "https://app.example.com");
        let v6 = json!({ "HAZEL_DATA": "live", "VITE_APP_URL": "http://[::1]:3100" });
        assert_eq!(origin(&v6), "http://[::1]:3100");
    }

    #[test]
    fn the_environment_carries_size_bundle_path_and_origin() {
        let bundled = json!({ "HAZEL_DATA": "live", "NATIVE_DEBUG": "1" });
        let inset = [62.0, 0.0, 34.4, 0.0];
        let env = environment(Some(bundled), (402.4, 778.6), inset, Some("/hazel/chat"));
        assert_eq!(
            env,
            json!({
                "NATIVE_WIDTH": "402", "NATIVE_HEIGHT": "779", "NATIVE_INSET": "62 0 34 0", "HAZEL_DATA": "live",
                "NATIVE_DEBUG": "1", "NATIVE_PATH": "/hazel/chat", "NATIVE_ORIGIN": "https://app.hazel.sh",
            })
        );
        // A path the bundle names gives way to the one a reload asks for.
        let reload = environment(
            Some(json!({ "NATIVE_PATH": "/" })),
            (1.0, 1.0),
            [0.0; 4],
            Some("/b"),
        );
        assert_eq!(reload["NATIVE_PATH"], "/b");
        assert_eq!(
            environment(None, (1.0, 1.0), [0.0; 4], None)["NATIVE_ORIGIN"],
            OFFLINE_ORIGIN
        );
    }

    #[test]
    fn nothing_in_the_source_or_environment_ends_the_inline_script() {
        let source = r#"const a = "</script><script>alert(1)</script>"; // <!-- -->"#;
        let env = json!({ "NATIVE_PATH": "/</script>" });
        let storage = r#"{"note":"</script><!--"}"#;
        let page = html(source, &env, Some(storage), 1);
        let (_, inline) = page.split_once("</script><script>").expect("two scripts");
        let inline = inline.strip_suffix("</script>").expect("one closing tag");
        assert!(!inline.contains('<'), "{inline}");
        // The escapes still read as the same strings.
        let call = inline
            .strip_prefix("__hazel.start(")
            .and_then(|s| s.strip_suffix(')'))
            .unwrap();
        let args: Value = serde_json::from_str(&format!("[{call}]")).unwrap();
        assert_eq!(args, json!([source, env, storage]));
        // Without saved entries the worker is handed `null`.
        assert!(html("", &env, None, 1).ends_with(", null)</script>"));
    }

    #[test]
    fn the_page_says_it_is_ready_before_it_starts_the_worker() {
        let page = html("", &json!({}), None, 7);
        // With its load's id: a page a later load replaced cannot release the new one's lines.
        let ready = page.find("host.postMessage({ ready: 7 })").expect("ready");
        let start = page.find("__hazel.start(").expect("start");
        assert!(ready < start);
        // Lines that arrive before the worker exists wait for it, in order.
        assert!(
            page.contains("worker === undefined ? early.push(text) : worker.postMessage(text)")
        );
        assert!(page.contains("for (const batch of early.splice(0)) worker.postMessage(batch)"));
    }
}
