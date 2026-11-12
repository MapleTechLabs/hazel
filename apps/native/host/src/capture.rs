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

use hazel_native::wire::{Node, RuntimeMsg};
use hazel_native::{
    PRESS_EVENTS, State, TEXT_SMOOTHING, images, note_scroll, outbox, view, window_key,
};

use crate::runtime::{FromRuntime, RuntimeChild, spawn_runtime};
use crate::{initial_state, window_size};

const FRAME: Duration = Duration::from_micros(16_667);
const FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Rgba8Unorm;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
enum Step {
    /// Wait until no tree has arrived for this many ms (the app has settled).
    Settle(u64),
    Wait(u64),
    ClickText(String),
    /// Move the pointer over the first element with this text that listens for `mouseenter`.
    HoverText(String),
    /// Move the pointer to a point (window points) and draw a frame.
    Move([f32; 2]),
    /// Press and release at a point (window points), then let the app answer.
    ClickAt([f32; 2]),
    /// Glide the pointer from `from` to `to` over `ms`, one move per 120 Hz frame, and report
    /// each frame's CPU time against the 8.3 ms budget and how many trees arrived.
    Sweep(SweepStep),
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
    /// Press a key and let 400 ms of frames run, whatever it changes (`key` waits for text).
    Press(String),
    /// Right-click the deepest element whose text contains this (a context menu).
    RightClickText(String),
    /// Click the deepest pressable whose `aria-label` or `title` contains this (an icon button).
    ClickLabel(String),
    /// Print to stderr what has focus, what is hovered and which of `texts` are visible.
    Probe(ProbeStep),
    /// Hold still (after an optional pointer move and a settle), recording each frame: print the
    /// elements whose place, size or opacity kept changing (flicker, jitter) and the trees sent.
    Watch(WatchStep),
}

#[derive(Deserialize)]
struct WatchStep {
    label: String,
    ms: u64,
    #[serde(default)]
    at: Option<[f32; 2]>,
    /// Glide the pointer from `at` to here over `ms`, as a hand moves it.
    #[serde(default)]
    to: Option<[f32; 2]>,
    #[serde(default = "default_watch_settle")]
    settle: u64,
    /// Print, each frame, the elements whose path contains this and their state.
    #[serde(default)]
    trace: Option<String>,
}

fn default_watch_settle() -> u64 {
    400
}

/// An element as `watch` compares it frame to frame: its drawn box and opacity, rounded so
/// sub-pixel settling isn't counted.
fn watch_state(e: &rune::ElementInfo) -> (i32, i32, i32, i32, i32) {
    let q = |v: f32| (v * 2.0).round() as i32;
    let r = e.visible;
    (
        q(r[0]),
        q(r[1]),
        q(r[2]),
        q(r[3]),
        (e.opacity * 20.0).round() as i32,
    )
}

#[derive(Deserialize)]
struct ProbeStep {
    label: String,
    #[serde(default)]
    texts: Vec<String>,
}

#[derive(Deserialize)]
struct SweepStep {
    from: [f32; 2],
    to: [f32; 2],
    ms: u64,
    /// Scroll by this many points each frame at `from` instead of moving the pointer.
    #[serde(default)]
    wheel: Option<f32>,
    /// Also encode and submit each frame on the GPU, as a window does, and time that work.
    #[serde(default)]
    render: bool,
}

/// One 120 Hz frame: the budget a sweep's frames are held to.
const FRAME_120: Duration = Duration::from_micros(8_333);

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
    messages: std::sync::mpsc::Receiver<FromRuntime>,
    started: Instant,
    last_tree: Instant,
    first_tree_ms: Option<f64>,
    timings: Timings,
    scale: f32,
    /// One renderer per session: Rune's glyph atlas uploads each glyph once, to the renderer it met.
    gpu: Option<(Gpu, Renderer, Offscreen)>,
    fx: hazel_native::fx::Effects,
}

impl Session {
    /// One real-time frame: apply what the runtime sent, run the frame, keep the 60 Hz cadence.
    fn tick(&mut self) -> bool {
        self.tick_every(FRAME).0
    }

    /// `tick` at another cadence (a 120 Hz display's), with the frame's CPU time.
    fn tick_every(&mut self, period: Duration) -> (bool, f64) {
        let began = Instant::now();
        let mut got_tree = false;
        while let Ok(msg) = self.messages.try_recv() {
            got_tree |= matches!(msg, FromRuntime::Message(RuntimeMsg::Tree(_)));
            self.apply(msg);
        }
        let arrived = images::take_arrived();
        if arrived {
            self.rt.update(|_, tx| tx.invalidate_memos_by_prefix("r"));
        }
        let frame_started = Instant::now();
        self.rt.frame(period.as_secs_f64());
        let frame_ms = frame_started.elapsed().as_secs_f64() * 1000.0;
        if std::env::var("NATIVE_TRACE").is_ok() && (frame_ms > 12.0 || arrived) {
            eprintln!("[host-frame] {frame_ms:.1}ms tree={got_tree} images_arrived={arrived}");
        }
        if got_tree {
            self.last_tree = Instant::now();
            self.first_tree_ms
                .get_or_insert(self.started.elapsed().as_secs_f64() * 1000.0);
            self.timings.frames_with_tree.push(frame_ms);
        } else {
            self.timings.idle_frames.push(frame_ms);
        }
        if let Some(rest) = period.checked_sub(began.elapsed()) {
            std::thread::sleep(rest)
        }
        (got_tree, frame_ms)
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
        let want = outbox::last_seq();
        while sent.elapsed() < Duration::from_secs(5) {
            if let Ok(msg) = self.messages.try_recv() {
                let ack = match &msg {
                    FromRuntime::Message(RuntimeMsg::Tree(tree)) => Some(tree.ack),
                    _ => None,
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
            .root()
            .is_some_and(|root| text_of(root).contains(needle))
    }

    fn apply(&mut self, msg: FromRuntime) {
        let msg = match msg {
            FromRuntime::Message(msg) => msg,
            FromRuntime::Replaced => return self.rt.update(|s, _| s.runtime_replaced()),
        };
        match msg {
            RuntimeMsg::Tree(tree) => {
                self.timings.trees += 1;
                self.rt.update_if(move |s, _| s.apply(tree));
            }
            RuntimeMsg::Scroll { path, top, seq } => {
                note_scroll(&path, seq);
                if std::env::var("NATIVE_DEBUG").is_ok() {
                    eprintln!("[host] scroll_to {top}")
                }
                self.rt
                    .update(move |_, tx| tx.scroll_to_instant(path, 0.0, top))
            }
            request => {
                if let Some(run) = request.request() {
                    self.rt.update(move |_, tx| run(tx))
                }
            }
        }
    }

    fn click_text(&mut self, label: &str) -> Option<f64> {
        let mut candidates = Vec::new();
        if let Some(root) = self.rt.state.root().cloned() {
            find_pressables(&root, "r", label, &mut candidates);
        }
        // The first match that is drawn: a narrow layout hides the desktop copy of a link.
        let (x, y) = candidates.iter().find_map(|path| self.rt.find(path))?;
        if std::env::var("NATIVE_DEBUG").is_ok() {
            let hit = self.rt.element_at(x, y).map(|p| p.path().to_string());
            eprintln!("[click] \"{label}\" candidates {candidates:?} at ({x}, {y}) hits {hit:?}");
        }
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

    /// Encodes and submits the frame on screen as a window would, without reading it back: the
    /// CPU side of drawing (instance prep, text atlas, command encoding), in ms.
    fn encode_frame(&mut self) -> f64 {
        let began = Instant::now();
        let (w, h) = window_size();
        let (dw, dh) = ((w * self.scale) as u32, (h * self.scale) as u32);
        let (gpu, renderer, target) = self.gpu.get_or_insert_with(|| {
            let gpu = Gpu::headless();
            let mut renderer = Renderer::new(&gpu.device, FORMAT);
            renderer.set_srgb_blend(true);
            let target = Offscreen::with_format(&gpu.device, dw, dh, FORMAT);
            (gpu, renderer, target)
        });
        renderer.upload_images(&gpu.device, &gpu.queue, &mut self.rt.images);
        let mut encoder = gpu.device.create_command_encoder(&Default::default());
        // As the window's compositor draws it, effects included.
        self.fx.draw(
            &gpu.device,
            &gpu.queue,
            &mut encoder,
            &target.view,
            FORMAT,
            (dw, dh),
            &mut self.rt,
            renderer,
        );
        renderer.submit(&gpu.queue, encoder);
        began.elapsed().as_secs_f64() * 1000.0
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
        let mut encoder = gpu.device.create_command_encoder(&Default::default());
        self.fx.draw(
            &gpu.device,
            &gpu.queue,
            &mut encoder,
            &target.view,
            FORMAT,
            (dw, dh),
            &mut self.rt,
            renderer,
        );
        target.copy(&mut encoder);
        renderer.submit(&gpu.queue, encoder);
        let pixels = target.read(&gpu.device);
        if let Err(error) = write_png(std::path::Path::new(path), dw, dh, &pixels) {
            eprintln!("[capture] {path}: {error}");
        }
    }
}

/// Elements listening for `mouseenter` whose text contains `label`, deepest first.
fn find_hoverables(node: &Arc<Node>, path: &str, label: &str, out: &mut Vec<String>) {
    let Node::Elem { children, on, .. } = node.as_ref() else {
        return;
    };
    let before = out.len();
    for (i, child) in children.iter().enumerate() {
        let child_path = match child.as_ref() {
            Node::Elem { key: Some(key), .. } => format!("{path}/k{key}"),
            _ => format!("{path}/{i}"),
        };
        find_hoverables(child, &child_path, label, out);
    }
    if out.len() == before && on.contains_key("mouseenter") && text_of(node).contains(label) {
        out.push(path.to_string());
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
    let is_pressable = PRESS_EVENTS.iter().any(|k| on.contains_key(*k))
        || (tag == "a" && attrs.contains_key("href"));
    // An ancestor is a fallback only when nothing inside it matched.
    if out.len() == before && is_pressable && text_of(node).contains(label) {
        out.push(path.to_string());
    }
}

fn find_texts(node: &Arc<Node>, path: &str, label: &str, out: &mut Vec<String>) {
    let Node::Elem { children, .. } = node.as_ref() else {
        return;
    };
    let before = out.len();
    for (i, child) in children.iter().enumerate() {
        let child_path = match child.as_ref() {
            Node::Elem { key: Some(key), .. } => format!("{path}/k{key}"),
            _ => format!("{path}/{i}"),
        };
        find_texts(child, &child_path, label, out);
    }
    if out.len() == before && text_of(node).contains(label) {
        out.push(path.to_string());
    }
}

fn find_labelled(node: &Arc<Node>, path: &str, label: &str, out: &mut Vec<String>) {
    let Node::Elem {
        children,
        on,
        attrs,
        tag,
        ..
    } = node.as_ref()
    else {
        return;
    };
    for (i, child) in children.iter().enumerate() {
        let child_path = match child.as_ref() {
            Node::Elem { key: Some(key), .. } => format!("{path}/k{key}"),
            _ => format!("{path}/{i}"),
        };
        find_labelled(child, &child_path, label, out);
    }
    let named = ["aria-label", "title"]
        .iter()
        .any(|a| attrs.get(*a).is_some_and(|v| v.contains(label)));
    let pressable =
        PRESS_EVENTS.iter().any(|k| on.contains_key(*k)) || tag == "a" || tag == "button";
    if named && pressable {
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
    let (mut child, messages) = spawn_runtime().unwrap_or_else(|error| {
        eprintln!("[capture] {error}");
        std::process::exit(1)
    });
    let scale: f32 = std::env::var("NATIVE_SCALE")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(2.0);
    let state = initial_state();
    let dark = state.dark();
    let mut rt = Runtime::new(state, view, window_size(), Env::new(dark, scale));
    rt.on_key = Some(window_key);
    rt.set_srgb_blend(true);
    rt.set_font_smoothing(TEXT_SMOOTHING);
    let mut session = Session {
        rt,
        messages,
        started,
        last_tree: started,
        first_tree_ms: None,
        timings: Timings::default(),
        scale,
        gpu: None,
        fx: Default::default(),
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
            Step::Move([x, y]) => {
                session.rt.pointer_move(x, y);
                session.tick();
            }
            Step::ClickAt([x, y]) => {
                if std::env::var("NATIVE_DEBUG").is_ok() {
                    let hit = session.rt.element_at(x, y).map(|p| p.path().to_string());
                    eprintln!("[click] at ({x}, {y}) hits {hit:?}");
                }
                session.rt.pointer_move(x, y);
                session.rt.pointer_down(x, y);
                session.rt.pointer_up(x, y);
                let rtt = session.round_trip(None);
                interactions.push(json!({ "clickAt": [x, y], "roundTripMs": rtt }));
            }
            Step::Sweep(sweep) => {
                let frames = (sweep.ms as f64 / FRAME_120.as_secs_f64() / 1000.0)
                    .ceil()
                    .max(1.0) as usize;
                let trees_before = session.timings.trees;
                let mut times = Vec::with_capacity(frames);
                let mut gpu_times = Vec::new();
                for i in 0..=frames {
                    let t = i as f32 / frames as f32;
                    match sweep.wheel {
                        Some(dy) => session.rt.wheel(sweep.from[0], sweep.from[1], dy),
                        None => session.rt.pointer_move(
                            sweep.from[0] + (sweep.to[0] - sweep.from[0]) * t,
                            sweep.from[1] + (sweep.to[1] - sweep.from[1]) * t,
                        ),
                    }
                    let (_, frame_ms) = session.tick_every(FRAME_120);
                    let gpu_ms = if sweep.render {
                        session.encode_frame()
                    } else {
                        0.0
                    };
                    if std::env::var("NATIVE_TRACE").is_ok() && gpu_ms > 12.0 {
                        eprintln!(
                            "[host-encode] frame {i} of sweep: encode {gpu_ms:.1}ms, frame {frame_ms:.1}ms"
                        );
                    }
                    gpu_times.push(gpu_ms);
                    times.push(frame_ms + gpu_ms);
                }
                let budget = FRAME_120.as_secs_f64() * 1000.0;
                interactions.push(json!({
                    "sweep": [sweep.from, sweep.to],
                    "wheel": sweep.wheel,
                    "frameMs": summary(&times),
                    "encodeMs": summary(&gpu_times),
                    "overBudget": times.iter().filter(|t| **t > budget).count(),
                    "trees": session.timings.trees - trees_before,
                }));
            }
            Step::HoverText(label) => {
                let mut candidates = Vec::new();
                if let Some(root) = session.rt.state.root().cloned() {
                    find_hoverables(&root, "r", &label, &mut candidates);
                }
                let Some((x, y)) = candidates.iter().find_map(|path| session.rt.find(path)) else {
                    fail(
                        &mut child,
                        &format!("hoverText: nothing hoverable shows \"{label}\""),
                    );
                };
                session.rt.pointer_move(x, y);
                session.tick();
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
                // `Meta+k`: the key with Command held (a shortcut).
                let (cmd, bare) = match name.strip_prefix("Meta+") {
                    Some(bare) => (true, bare),
                    None => (false, name.as_str()),
                };
                let Some(key) = named_key(bare) else {
                    fail(&mut child, &format!("key: unsupported key name \"{name}\""));
                };
                // A window reports a character typed with Command as `Key::Command`.
                let key = match key {
                    Key::Text(t) if cmd => Key::Command(t.chars().next().unwrap_or(' ')),
                    key => key,
                };
                session.rt.key(KeyEvent {
                    key,
                    mods: Mods {
                        cmd,
                        ..Mods::default()
                    },
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
                    .root()
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
                if let Some(root) = session.rt.state.root().cloned() {
                    export_layout(&session.rt, &root, "r", &mut out);
                }
                let doc = json!({ "scale": session.scale, "elements": out });
                if let Err(error) = std::fs::write(&path, serde_json::to_string(&doc).unwrap()) {
                    eprintln!("[capture] {path}: {error}");
                }
            }
            Step::Press(combo) => {
                // `Meta+k`, `Shift+Tab`: modifiers, then the key.
                let (mods_part, name) = combo
                    .rsplit_once('+')
                    .filter(|(_, k)| !k.is_empty())
                    .unwrap_or(("", combo.as_str()));
                let mut mods = Mods::default();
                for m in mods_part.split('+').filter(|m| !m.is_empty()) {
                    match m {
                        "Meta" | "Cmd" => mods.cmd = true,
                        "Ctrl" | "Control" => mods.ctrl = true,
                        "Alt" | "Option" => mods.alt = true,
                        "Shift" => mods.shift = true,
                        _ => fail(&mut child, &format!("press: unknown modifier \"{m}\"")),
                    }
                }
                let Some(key) = named_key(name) else {
                    fail(
                        &mut child,
                        &format!("press: unsupported key name \"{name}\""),
                    );
                };
                session.rt.key(KeyEvent { key, mods });
                let until = Instant::now() + Duration::from_millis(400);
                while Instant::now() < until {
                    session.tick();
                }
            }
            Step::RightClickText(label) => {
                let mut found = Vec::new();
                if let Some(root) = session.rt.state.root().cloned() {
                    find_texts(&root, "r", &label, &mut found);
                }
                match found.iter().find_map(|p| session.rt.find(p)) {
                    Some((x, y)) => {
                        session.rt.pointer_move(x, y);
                        session.rt.secondary_down(x, y);
                        session.rt.secondary_up(x, y);
                    }
                    None => eprintln!("[capture] rightClick \"{label}\": not found"),
                }
                let until = Instant::now() + Duration::from_millis(500);
                while Instant::now() < until {
                    session.tick();
                }
            }
            Step::ClickLabel(label) => {
                let mut found = Vec::new();
                if let Some(root) = session.rt.state.root().cloned() {
                    find_labelled(&root, "r", &label, &mut found);
                }
                match found.iter().find_map(|p| session.rt.find(p)) {
                    Some((x, y)) => {
                        session.rt.pointer_move(x, y);
                        session.rt.pointer_down(x, y);
                        session.rt.pointer_up(x, y);
                        let rtt = session.round_trip(None);
                        interactions.push(json!({ "clickLabel": label, "roundTripMs": rtt }));
                    }
                    None => eprintln!("[capture] clickLabel \"{label}\": not found"),
                }
            }
            Step::Watch(watch) => {
                if let Some([x, y]) = watch.at {
                    session.rt.pointer_move(x, y);
                }
                let until = Instant::now() + Duration::from_millis(watch.settle);
                while Instant::now() < until {
                    session.tick();
                }
                let trees_before = session.timings.trees;
                let mut last: std::collections::HashMap<String, (i32, i32, i32, i32, i32)> =
                    std::collections::HashMap::new();
                let mut changes: std::collections::HashMap<String, (u32, String)> =
                    std::collections::HashMap::new();
                let mut frames = 0;
                let mut inert_frames = 0;
                let start = Instant::now();
                let until = start + Duration::from_millis(watch.ms);
                while Instant::now() < until {
                    if let (Some([x0, y0]), Some([x1, y1])) = (watch.at, watch.to) {
                        let t = (start.elapsed().as_secs_f32() * 1000.0 / watch.ms as f32).min(1.0);
                        session
                            .rt
                            .pointer_move(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
                    }
                    session.tick();
                    frames += 1;
                    let els = session.rt.elements();
                    if els.iter().any(|e| e.inert && !e.exiting) {
                        inert_frames += 1;
                    }
                    if let Some(needle) = &watch.trace {
                        let line: Vec<String> = els
                            .iter()
                            .filter(|e| e.path.ends_with(needle.as_str()))
                            .map(|e| {
                                format!(
                                    "op {:.2} hover {:.2} focused {}{}",
                                    e.opacity,
                                    e.hover,
                                    e.focused,
                                    if e.exiting { " exiting" } else { "" }
                                )
                            })
                            .collect();
                        eprintln!("[trace {} {frames}] {}", watch.label, line.join(" "));
                    }
                    let mut seen = std::collections::HashSet::new();
                    for e in els.iter().filter(|e| !e.exiting) {
                        let state = watch_state(e);
                        seen.insert(e.path.clone());
                        if let Some(before) = last.insert(e.path.clone(), state)
                            && before != state
                        {
                            let entry = changes.entry(e.path.clone()).or_insert((0, String::new()));
                            entry.0 += 1;
                            if entry.1.is_empty() {
                                entry.1 = e.text.clone().or(e.label.clone()).unwrap_or_default();
                            }
                        }
                    }
                    // An element that comes and goes counts too.
                    for gone in last
                        .keys()
                        .filter(|p| !seen.contains(*p))
                        .cloned()
                        .collect::<Vec<_>>()
                    {
                        last.remove(&gone);
                        changes.entry(gone).or_insert((0, String::new())).0 += 1;
                    }
                }
                let mut changing: Vec<_> = changes.into_iter().collect();
                changing.sort_by_key(|c| std::cmp::Reverse(c.1.0));
                let changing: Vec<_> = changing
                    .iter()
                    .take(12)
                    .map(|(path, (n, text))| json!({ "path": path, "changes": n, "text": text.chars().take(40).collect::<String>() }))
                    .collect();
                eprintln!(
                    "[watch {}] {}",
                    watch.label,
                    json!({ "frames": frames, "inertFrames": inert_frames, "trees": session.timings.trees - trees_before, "changing": changing })
                );
            }
            Step::Probe(probe) => {
                session.rt.settle_all();
                session.rt.frame(0.0);
                let els = session.rt.elements();
                let text_under = |i: usize| -> String {
                    let mut out = String::new();
                    for (j, e) in els.iter().enumerate() {
                        let mut p = Some(j);
                        while let Some(k) = p {
                            if k == i {
                                if let Some(t) = &e.text {
                                    out.push_str(t);
                                    out.push(' ');
                                }
                                break;
                            }
                            p = els[k].parent;
                        }
                        if out.len() > 60 {
                            break;
                        }
                    }
                    out.trim().chars().take(60).collect()
                };
                let mut focused: Vec<_> = els.iter().enumerate().filter(|(_, e)| e.focused)
                    .map(|(i, e)| json!({"path": e.path, "role": e.role, "label": e.label, "vis": e.focus_visible, "text": text_under(i), "rect": e.rect})).collect();
                // A focused 0x0 control is not drawn: report it at its nearest drawn ancestor.
                if let Some(path) = session.rt.focused_path().filter(|_| focused.is_empty()) {
                    let around = els
                        .iter()
                        .filter(|e| path.starts_with(&format!("{}/", e.path)))
                        .max_by_key(|e| e.path.len());
                    focused.push(json!({"path": path, "label": null, "text": "", "rect": around.map(|e| e.rect).unwrap_or_default()}));
                }
                let hovered: Vec<_> = els.iter().enumerate().filter(|(_, e)| e.hover > 0.3 && e.visible[2] > 0.0)
                    .map(|(i, e)| json!({"path": e.path, "hover": e.hover, "fill": format!("{:?}", e.fill), "text": text_under(i), "rect": e.rect})).collect();
                let shown: Vec<_> = probe
                    .texts
                    .iter()
                    .map(|t| {
                        let hit = els.iter().find(|e| {
                            (e.text.as_deref().is_some_and(|x| x.contains(t.as_str()))
                                || e.label.as_deref().is_some_and(|x| x.contains(t.as_str())))
                                && e.opacity > 0.01
                                && e.visible[2] > 0.5
                                && e.visible[3] > 0.5
                                && !e.exiting
                        });
                        json!({"text": t, "rect": hit.map(|e| e.visible)})
                    })
                    .collect();
                let inert = els.iter().filter(|e| e.inert).count();
                eprintln!(
                    "[probe {}] {}",
                    probe.label,
                    json!({"focused": focused, "hovered": hovered, "shown": shown, "inert": inert, "pressing": session.rt.pressing()})
                );
            }
            Step::Dump => {
                let root = session.rt.state.root().cloned();
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
    child.stop();
}

/// A script step that cannot complete fails the run, so a benchmark never reports a partial one.
fn fail(child: &mut RuntimeChild, message: &str) -> ! {
    eprintln!("[capture] {message}");
    child.kill();
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
