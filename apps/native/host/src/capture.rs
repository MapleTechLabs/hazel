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
    Key(String),
    Snap(String),
    /// Tick until a text node contains this string; reported as `textReadyMs` from process start.
    WaitText(String),
    /// Click the first native text field drawn over a DOM-backed editor.
    FocusEditable,
    /// Print the presented rect of every observed element and the first rows under it.
    Dump,
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

    /// After an input: run the frame that delivers it, then wait for the runtime's tree and draw
    /// it at once, as a window does when an update wakes its loop. The round trip in ms.
    fn round_trip(&mut self) -> Option<f64> {
        let sent = Instant::now();
        self.rt.frame(0.0);
        while sent.elapsed() < Duration::from_secs(5) {
            if let Ok(msg) = self.messages.try_recv() {
                let is_tree = matches!(msg, RuntimeMsg::Tree(_));
                self.apply(msg);
                if is_tree {
                    let frame_started = Instant::now();
                    self.rt.frame(0.0);
                    self.timings
                        .frames_with_tree
                        .push(frame_started.elapsed().as_secs_f64() * 1000.0);
                    self.last_tree = Instant::now();
                    return Some(sent.elapsed().as_secs_f64() * 1000.0);
                }
                continue;
            }
            std::thread::sleep(Duration::from_micros(500));
        }
        None
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
        let path = self
            .rt
            .state
            .root
            .as_ref()
            .and_then(|root| find_pressable(root, "r", label))?;
        let (x, y) = self.rt.find(&path)?;
        self.rt.pointer_move(x, y);
        self.rt.pointer_down(x, y);
        self.rt.pointer_up(x, y);
        self.round_trip()
    }

    fn type_text(&mut self, text: &str) -> Vec<f64> {
        text.chars()
            .filter_map(|c| {
                self.rt.key(KeyEvent {
                    key: Key::Text(c.to_string()),
                    mods: Mods::default(),
                });
                self.round_trip()
            })
            .collect()
    }

    fn snap(&mut self, path: &str) {
        let (w, h) = window_size();
        let (dw, dh) = ((w * self.scale) as u32, (h * self.scale) as u32);
        let (gpu, renderer, target) = self.gpu.get_or_insert_with(|| {
            let gpu = Gpu::headless();
            let renderer = Renderer::new(&gpu.device, FORMAT);
            let target = Offscreen::with_format(&gpu.device, dw, dh, FORMAT);
            (gpu, renderer, target)
        });
        self.rt.settle_all();
        self.rt.frame(0.0);
        renderer.prepare(
            &gpu.device,
            &gpu.queue,
            &mut self.rt.text.atlas,
            &self.rt.instances,
            (dw, dh),
        );
        let mut encoder = gpu.device.create_command_encoder(&Default::default());
        renderer.draw(&mut encoder, &target.view, [0.0, 0.0, 0.0, 1.0]);
        target.copy(&mut encoder);
        renderer.submit(&gpu.queue, encoder);
        let pixels = target.read(&gpu.device);
        if let Err(error) = write_png(std::path::Path::new(path), dw, dh, &pixels) {
            eprintln!("[capture] {path}: {error}");
        }
    }
}

/// The deepest element with a press handler (or a link) whose text contains `label`.
fn find_pressable(node: &Arc<Node>, path: &str, label: &str) -> Option<String> {
    let Node::Elem {
        children,
        on,
        attrs,
        tag,
        ..
    } = node.as_ref()
    else {
        return None;
    };
    for (i, child) in children.iter().enumerate() {
        let child_path = match child.as_ref() {
            Node::Elem { key: Some(key), .. } => format!("{path}/k{key}"),
            _ => format!("{path}/{i}"),
        };
        if let Some(found) = find_pressable(child, &child_path, label) {
            return Some(found);
        }
    }
    let is_pressable = on.contains_key("click") || (tag == "a" && attrs.contains_key("href"));
    (is_pressable && text_of(node).contains(label)).then(|| path.to_string())
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
    let mut session = Session {
        rt: Runtime::new(state, view, window_size(), Env::new(dark, scale)),
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
                report.entry("settledMs").or_insert(json!(settled));
            }
            Step::Wait(ms) => {
                let until = Instant::now() + Duration::from_millis(ms);
                while Instant::now() < until {
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
                let keys = session.type_text(&text);
                interactions.push(json!({ "type": text, "perKey": summary(&keys) }));
            }
            Step::Key(name) => {
                let key = match name.as_str() {
                    "Enter" => Key::Enter,
                    "Backspace" => Key::Backspace,
                    _ => Key::Text(name.clone()),
                };
                session.rt.key(KeyEvent {
                    key,
                    mods: Mods::default(),
                });
                let rtt = session.round_trip();
                interactions.push(json!({ "key": name, "roundTripMs": rtt }));
            }
            Step::Snap(path) => session.snap(&path),
            Step::WaitText(needle) => {
                let deadline = Instant::now() + Duration::from_secs(30);
                while Instant::now() < deadline {
                    session.tick();
                    let found = session
                        .rt
                        .state
                        .root
                        .as_ref()
                        .is_some_and(|root| text_of(root).contains(&needle));
                    if found {
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
