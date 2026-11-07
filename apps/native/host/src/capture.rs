//! `--capture script.json`: runs the app offscreen on a real-time frame loop, follows a script
//! (wait for the app to settle, click by visible text, type, press keys, snap PNGs) and writes
//! the timings to `NATIVE_BENCH_OUT` as JSON.
use std::sync::Arc;
use std::time::{Duration, Instant};

use rune::edit::{Key, KeyEvent, Mods};
use rune::render::{Gpu, Offscreen, Renderer, write_png};
use rune::{Env, Runtime};
use serde::Deserialize;
use serde_json::json;

use crate::wire::{Node, RuntimeMsg};
use crate::{State, initial_state, spawn_runtime, view, window_size};

const FRAME: Duration = Duration::from_micros(16_667);
const FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba8Unorm;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
enum Step {
    /// Wait until no tree has arrived for this many ms (the app has settled).
    Settle(u64),
    Wait(u64),
    ClickText(String),
    Type(String),
    /// A named key (`"Enter"`), or `{ "name": "Enter", "until": "Hello" }` to also wait for
    /// that text to appear (a sent message) before the round trip counts.
    Key(KeyStep),
    Snap(String),
    /// Tick until a text node contains this string; reported as `textReadyMs` from process start.
    WaitText(String),
    /// Click the first native text field drawn over a DOM-backed editor.
    FocusEditable,
    /// Press Tab this many times: keyboard focus moves in the host, the runtime sees nothing.
    Tab(u32),
    /// Print the presented rect of every observed element and the first rows under it.
    Dump,
    /// Write every element's presented rect, tag, own text and identifying attributes to a JSON
    /// file, for comparing layout with a browser render of the same view.
    ExportLayout(String),
}

#[derive(Deserialize)]
#[serde(untagged)]
enum KeyStep {
    Name(String),
    Until { name: String, until: String },
}

/// The keys a script may press; anything else is a script error, not text to type.
fn named_key(name: &str) -> Option<Key> {
    Some(match name {
        "Enter" => Key::Enter,
        "Backspace" => Key::Backspace,
        "Delete" => Key::Delete,
        "Tab" => Key::Tab,
        "Escape" => Key::Escape,
        "ArrowUp" => Key::Up,
        "ArrowDown" => Key::Down,
        "ArrowLeft" => Key::Left,
        "ArrowRight" => Key::Right,
        _ if name.chars().count() == 1 => Key::Text(name.to_string()),
        _ => return None,
    })
}

#[derive(Default)]
struct Timings {
    frames_with_tree: Vec<f64>,
    idle_frames: Vec<f64>,
    trees: usize,
}

struct Session {
    rt: Runtime<State>,
    messages: std::sync::mpsc::Receiver<RuntimeMsg>,
    started: Instant,
    last_tree: Instant,
    first_tree_ms: Option<f64>,
    timings: Timings,
    scale: f32,
    /// One renderer per session: Rune's glyph atlas uploads each glyph once, to the renderer it met.
    gpu: Option<(Gpu, Renderer, Offscreen)>,
}

impl Session {
    /// One real-time frame: apply what the runtime sent, run the frame, keep the 60 Hz cadence.
    fn tick(&mut self) -> bool {
        let began = Instant::now();
        let mut got_tree = false;
        while let Ok(msg) = self.messages.try_recv() {
            match msg {
                RuntimeMsg::Tree(tree) => {
                    got_tree = true;
                    self.timings.trees += 1;
                    self.rt.update(move |s, _| s.apply(tree));
                }
                RuntimeMsg::Scroll { path, top } => {
                    if std::env::var("NATIVE_DEBUG").is_ok() {
                        eprintln!("[host] scroll_to {top}")
                    }
                    self.rt
                        .update(move |_, tx| tx.scroll_to_instant(path, 0.0, top))
                }
            }
        }
        if crate::images::take_arrived() {
            self.rt.update(|_, tx| tx.invalidate_memos_by_prefix("r"));
        }
        let frame_started = Instant::now();
        self.rt.frame(FRAME.as_secs_f64());
        let frame_ms = frame_started.elapsed().as_secs_f64() * 1000.0;
        if got_tree {
            self.last_tree = Instant::now();
            self.first_tree_ms
                .get_or_insert(self.started.elapsed().as_secs_f64() * 1000.0);
            self.timings.frames_with_tree.push(frame_ms);
        } else {
            self.timings.idle_frames.push(frame_ms);
        }
        if let Some(rest) = FRAME.checked_sub(began.elapsed()) {
            std::thread::sleep(rest)
        }
        got_tree
    }

    fn settle(&mut self, quiet_ms: u64) -> f64 {
        let deadline = Instant::now() + Duration::from_secs(60);
        while Instant::now() < deadline {
            self.tick();
            if self.first_tree_ms.is_some()
                && self.last_tree.elapsed() >= Duration::from_millis(quiet_ms)
            {
                break;
            }
        }
        (self.last_tree - self.started).as_secs_f64() * 1000.0
    }

    /// After an input: run the frame that delivers it, then wait for the runtime's tree that
    /// acknowledges it (and, with `until`, shows that text) and draw it at once, as a window does
    /// when an update wakes its loop. The round trip in ms, or `None` if it never arrives.
    fn round_trip(&mut self, until: Option<&str>) -> Option<f64> {
        let sent = Instant::now();
        self.rt.frame(0.0);
        // Every event the host sends takes the next sequence number; the runtime acks it.
        let want = crate::SEQ.load(std::sync::atomic::Ordering::SeqCst);
        while sent.elapsed() < Duration::from_secs(5) {
            if let Ok(msg) = self.messages.try_recv() {
                let ack = match &msg {
                    RuntimeMsg::Tree(tree) => Some(tree.ack),
                    RuntimeMsg::Scroll { .. } => None,
                };
                self.apply(msg);
                let Some(ack) = ack else { continue };
                let frame_started = Instant::now();
                self.rt.frame(0.0);
                self.timings
                    .frames_with_tree
                    .push(frame_started.elapsed().as_secs_f64() * 1000.0);
                self.last_tree = Instant::now();
                let shows = until.is_none_or(|text| self.shows_text(text));
                if ack >= want && shows {
                    return Some(sent.elapsed().as_secs_f64() * 1000.0);
                }
                continue;
            }
            std::thread::sleep(Duration::from_micros(500));
        }
        None
    }

    fn shows_text(&self, needle: &str) -> bool {
        self.rt
            .state
            .root
            .as_ref()
            .is_some_and(|root| text_of(root).contains(needle))
    }

    fn apply(&mut self, msg: RuntimeMsg) {
        match msg {
            RuntimeMsg::Tree(tree) => {
                self.timings.trees += 1;
                self.rt.update(move |s, _| s.apply(tree));
            }
            RuntimeMsg::Scroll { path, top } => self
                .rt
                .update(move |_, tx| tx.scroll_to_instant(path, 0.0, top)),
        }
    }

    fn click_text(&mut self, label: &str) -> Option<f64> {
        let mut candidates = Vec::new();
        if let Some(root) = self.rt.state.root.clone() {
            find_pressables(&root, "r", label, &mut candidates);
        }
        // The first match that is drawn: a narrow layout hides the desktop copy of a link.
        let (x, y) = candidates.iter().find_map(|path| self.rt.find(path))?;
        self.rt.pointer_move(x, y);
        self.rt.pointer_down(x, y);
        self.rt.pointer_up(x, y);
        self.round_trip(None)
    }

    /// Each key's round trip, or `None` if any key never got its update.
    fn type_text(&mut self, text: &str) -> Option<Vec<f64>> {
        text.chars()
            .map(|c| {
                self.rt.key(KeyEvent {
                    key: Key::Text(c.to_string()),
                    mods: Mods::default(),
                });
                self.round_trip(None)
            })
            .collect()
    }

    fn snap(&mut self, path: &str) {
        let (w, h) = window_size();
        let (dw, dh) = ((w * self.scale) as u32, (h * self.scale) as u32);
        let (gpu, renderer, target) = self.gpu.get_or_insert_with(|| {
            let gpu = Gpu::headless();
            let mut renderer = Renderer::new(&gpu.device, FORMAT);
            // Blend in sRGB encoding as the window does, into a non-sRGB target.
            renderer.set_srgb_blend(true);
            let target = Offscreen::with_format(&gpu.device, dw, dh, FORMAT);
            (gpu, renderer, target)
        });
        self.rt.settle_all();
        self.rt.frame(0.0);
        // Pictures and colour emoji live in the runtime's image atlas, uploaded separately.
        renderer.upload_images(&gpu.device, &gpu.queue, &mut self.rt.images);
        renderer.prepare(
            &gpu.device,
            &gpu.queue,
            &mut self.rt.text.atlas,
            &self.rt.instances,
            (dw, dh),
        );
        let mut encoder = gpu.device.create_command_encoder(&Default::default());
        renderer.draw(&mut encoder, &target.view, self.rt.clear_color());
        target.copy(&mut encoder);
        renderer.submit(&gpu.queue, encoder);
        let pixels = target.read(&gpu.device);
        if let Err(error) = write_png(std::path::Path::new(path), dw, dh, &pixels) {
            eprintln!("[capture] {path}: {error}");
        }
    }
}

/// Every element with a press handler (or a link) whose text contains `label`, deepest first,
/// skipping hidden subtrees.
fn find_pressables(node: &Arc<Node>, path: &str, label: &str, out: &mut Vec<String>) {
    let Node::Elem {
        children,
        on,
        attrs,
        tag,
        st,
        ..
    } = node.as_ref()
    else {
        return;
    };
    if st.display.as_deref() == Some("none") || st.visibility.as_deref() == Some("hidden") {
        return;
    }
    let before = out.len();
    for (i, child) in children.iter().enumerate() {
        let child_path = match child.as_ref() {
            Node::Elem { key: Some(key), .. } => format!("{path}/k{key}"),
            _ => format!("{path}/{i}"),
        };
        find_pressables(child, &child_path, label, out);
    }
    let is_pressable = crate::PRESS_EVENTS.iter().any(|k| on.contains_key(*k))
        || (tag == "a" && attrs.contains_key("href"));
    // An ancestor is a fallback only when nothing inside it matched.
    if out.len() == before && is_pressable && text_of(node).contains(label) {
        out.push(path.to_string());
    }
}

fn text_of(node: &Node) -> String {
    match node {
        Node::Text(s) => s.clone(),
        Node::Elem { children, .. } => children
            .iter()
            .map(|c| text_of(c))
            .collect::<Vec<_>>()
            .join(" "),
        Node::Svg { .. } => String::new(),
    }
}

fn percentile(values: &[f64], p: f64) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    let mut sorted = values.to_vec();
    sorted.sort_by(|a, b| a.total_cmp(b));
    sorted[((sorted.len() - 1) as f64 * p).round() as usize]
}

fn summary(values: &[f64]) -> serde_json::Value {
    json!({ "n": values.len(), "p50": percentile(values, 0.5), "p95": percentile(values, 0.95), "max": percentile(values, 1.0) })
}

pub fn run(script_path: &str) {
    let steps: Vec<Step> =
        serde_json::from_str(&std::fs::read_to_string(script_path).expect("read script"))
            .expect("parse script");
    let started = Instant::now();
    let (mut child, messages) = spawn_runtime();
    let scale: f32 = std::env::var("NATIVE_SCALE")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(2.0);
    let state = initial_state();
    let dark = state.dark;
    let mut rt = Runtime::new(state, view, window_size(), Env::new(dark, scale));
    rt.set_srgb_blend(true);
    let mut session = Session {
        rt,
        messages,
        started,
        last_tree: started,
        first_tree_ms: None,
        timings: Timings::default(),
        scale,
        gpu: None,
    };
    let mut report = serde_json::Map::new();
    let mut interactions = Vec::new();
    for step in steps {
        match step {
            Step::Settle(quiet) => {
                let settled = session.settle(quiet);
                if session.first_tree_ms.is_none() {
                    fail(&mut child, "settle: the runtime sent no tree");
                }
                report.entry("settledMs").or_insert(json!(settled));
            }
            Step::Wait(ms) => {
                let until = Instant::now() + Duration::from_millis(ms);
                while Instant::now() < until {
                    session.tick();
                }
            }
            Step::Tab(times) => {
                for _ in 0..times {
                    session.rt.key(KeyEvent {
                        key: Key::Tab,
                        mods: Mods::default(),
                    });
                    session.tick();
                }
            }
            Step::ClickText(label) => {
                let rtt = session.click_text(&label);
                interactions.push(json!({ "click": label, "roundTripMs": rtt }));
                if rtt.is_none() {
                    eprintln!("[capture] click \"{label}\": no response")
                }
            }
            Step::Type(text) => {
                let Some(keys) = session.type_text(&text) else {
                    fail(
                        &mut child,
                        &format!("type \"{text}\": a key got no update within 5 s"),
                    );
                };
                interactions.push(json!({ "type": text, "perKey": summary(&keys) }));
            }
            Step::Key(step) => {
                let (name, until) = match step {
                    KeyStep::Name(name) => (name, None),
                    KeyStep::Until { name, until } => (name, Some(until)),
                };
                let Some(key) = named_key(&name) else {
                    fail(&mut child, &format!("key: unsupported key name \"{name}\""));
                };
                session.rt.key(KeyEvent {
                    key,
                    mods: Mods::default(),
                });
                let rtt = session.round_trip(until.as_deref());
                if rtt.is_none() {
                    fail(&mut child, &format!("key \"{name}\": no update within 5 s"));
                }
                interactions.push(json!({ "key": name, "roundTripMs": rtt }));
            }
            Step::Snap(path) => session.snap(&path),
            Step::WaitText(needle) => {
                let deadline = Instant::now() + Duration::from_secs(30);
                loop {
                    if Instant::now() >= deadline {
                        fail(
                            &mut child,
                            &format!("waitText \"{needle}\": not shown within 30 s"),
                        );
                    }
                    session.tick();
                    if session.shows_text(&needle) {
                        // The frame that shows it is built (laid out, draw list made) by `tick`;
                        // the GPU presents it at the next vsync, which this does not include.
                        report.insert(
                            "textReadyMs".into(),
                            json!(session.started.elapsed().as_secs_f64() * 1000.0),
                        );
                        break;
                    }
                }
            }
            Step::FocusEditable => {
                let path = session
                    .rt
                    .state
                    .root
                    .as_ref()
                    .and_then(|root| find_editable(root, "r"));
                if let Some((x, y)) = path.and_then(|p| session.rt.find(&p)) {
                    session.rt.pointer_move(x, y);
                    session.rt.pointer_down(x, y);
                    session.rt.pointer_up(x, y);
                    session.tick();
                } else {
                    eprintln!("[capture] no editable field");
                }
            }
            Step::ExportLayout(path) => {
                session.rt.settle_all();
                session.rt.frame(0.0);
                let mut out = Vec::new();
                if let Some(root) = session.rt.state.root.clone() {
                    export_layout(&session.rt, &root, "r", &mut out);
                }
                let doc = json!({ "scale": session.scale, "elements": out });
                if let Err(error) = std::fs::write(&path, serde_json::to_string(&doc).unwrap()) {
                    eprintln!("[capture] {path}: {error}");
                }
            }
            Step::Dump => {
                let root = session.rt.state.root.clone();
                if let Some(root) = root {
                    dump(&session.rt, &root, "r", 0, false)
                }
            }
        }
    }
    report.insert("firstTreeMs".into(), json!(session.first_tree_ms));
    report.insert("trees".into(), json!(session.timings.trees));
    report.insert(
        "frameWithTreeMs".into(),
        summary(&session.timings.frames_with_tree),
    );
    report.insert("idleFrameMs".into(), summary(&session.timings.idle_frames));
    report.insert("interactions".into(), json!(interactions));
    report.insert("hostPid".into(), json!(std::process::id()));
    report.insert("runtimePid".into(), json!(child.id()));
    report.insert(
        "rssKb".into(),
        json!(rss_kb(&[std::process::id(), child.id()])),
    );
    let out = serde_json::Value::Object(report);
    match std::env::var("NATIVE_BENCH_OUT") {
        Ok(path) => {
            std::fs::write(path, serde_json::to_string_pretty(&out).unwrap()).expect("write bench")
        }
        Err(_) => println!("{}", serde_json::to_string_pretty(&out).unwrap()),
    }
    let _ = child.kill();
}

/// A script step that cannot complete fails the run, so a benchmark never reports a partial one.
fn fail(child: &mut std::process::Child, message: &str) -> ! {
    eprintln!("[capture] {message}");
    let _ = child.kill();
    std::process::exit(1)
}

/// Resident memory of each process, from `ps` (macOS and Linux).
fn rss_kb(pids: &[u32]) -> serde_json::Value {
    let list = pids
        .iter()
        .map(u32::to_string)
        .collect::<Vec<_>>()
        .join(",");
    let output = std::process::Command::new("ps")
        .args(["-o", "pid=,rss=", "-p", &list])
        .output();
    let text = output
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .unwrap_or_default();
    json!(text.lines().filter_map(|line| {
        let mut parts = line.split_whitespace();
        Some(json!({ "pid": parts.next()?.parse::<u32>().ok()?, "rssKb": parts.next()?.parse::<u64>().ok()? }))
    }).collect::<Vec<_>>())
}

fn dump(rt: &Runtime<State>, node: &Arc<Node>, path: &str, depth: usize, inside: bool) {
    let Node::Elem {
        children,
        observed,
        st,
        ..
    } = node.as_ref()
    else {
        return;
    };
    let show = *observed || (inside && depth < 4);
    if show {
        eprintln!(
            "[dump] {}{path} presented={:?} scroll={:?} abs={:?} h={:?}",
            "  ".repeat(depth),
            rt.presented(path),
            st.scroll_y,
            st.absolute,
            st.h
        );
    }
    for (i, child) in children
        .iter()
        .enumerate()
        .take(if show { 3 } else { usize::MAX })
    {
        let child_path = match child.as_ref() {
            Node::Elem { key: Some(key), .. } => format!("{path}/k{key}"),
            _ => format!("{path}/{i}"),
        };
        dump(
            rt,
            child,
            &child_path,
            if show { depth + 1 } else { depth },
            inside || *observed,
        );
    }
}

fn find_editable(node: &Arc<Node>, path: &str) -> Option<String> {
    let Node::Elem {
        children, attrs, ..
    } = node.as_ref()
    else {
        return None;
    };
    if attrs.contains_key("data-editable") {
        return Some(path.to_string());
    }
    children.iter().enumerate().find_map(|(i, child)| {
        let child_path = match child.as_ref() {
            Node::Elem { key: Some(key), .. } => format!("{path}/k{key}"),
            _ => format!("{path}/{i}"),
        };
        find_editable(child, &child_path)
    })
}

/// Elements in tree order: path, tag, the text directly inside, identifying attributes and the
/// rect Rune presented (logical points; `null` when the element is not drawn).
fn export_layout(
    rt: &Runtime<State>,
    node: &Arc<Node>,
    path: &str,
    out: &mut Vec<serde_json::Value>,
) {
    let Node::Elem {
        tag,
        attrs,
        children,
        ..
    } = node.as_ref()
    else {
        return;
    };
    let own_text: String = children
        .iter()
        .filter_map(|c| match c.as_ref() {
            Node::Text(s) => Some(s.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("");
    let rect = rt.presented(path).map(
        |(r, opacity)| json!({ "x": r[0], "y": r[1], "w": r[2], "h": r[3], "opacity": opacity }),
    );
    let keep: serde_json::Map<String, serde_json::Value> = attrs
        .iter()
        .filter(|(k, _)| {
            k.starts_with("data-")
                || matches!(
                    k.as_str(),
                    "role" | "aria-label" | "href" | "src" | "alt" | "placeholder"
                )
        })
        .map(|(k, v)| (k.clone(), json!(v)))
        .collect();
    out.push(json!({ "path": path, "tag": tag, "text": own_text, "fullText": text_of(node), "attrs": keep, "rect": rect }));
    for (i, child) in children.iter().enumerate() {
        let child_path = match child.as_ref() {
            Node::Elem { key: Some(key), .. } => format!("{path}/k{key}"),
            _ => format!("{path}/{i}"),
        };
        export_layout(rt, child, &child_path, out);
    }
}
