//! What the host sends the runtime: one JSON message per line, through the writer the shell
//! installs (the Bun child's stdin on the desktop), and the counters events carry.
use std::io::Write;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};

static OUT: OnceLock<Mutex<Box<dyn Write + Send>>> = OnceLock::new();
static SEQ: AtomicU64 = AtomicU64::new(0);
/// The generation of the tree on screen: an event runs the handler of the tree it was pressed on.
static GEN: AtomicU64 = AtomicU64::new(0);
/// Which runtime the lines are for: a fresh one (`new_runtime`) never hears what the window
/// queued for the one it replaced, an event or a request id meaning nothing to it.
static RUNTIME: AtomicU64 = AtomicU64::new(0);

/// Lines on their way to the runtime, in order. One thread writes them, so the UI thread never
/// waits on the pipe (the runtime may be mid-render), and what a frame reports (every observed
/// row's rect, while a list scrolls) goes out in one write.
static LINES: OnceLock<std::sync::mpsc::Sender<(u64, String)>> = OnceLock::new();

/// Lines from now on are for a fresh runtime; any still queued for the last one are dropped.
pub fn new_runtime() {
    RUNTIME.fetch_add(1, Ordering::SeqCst);
}

/// Sends everything from now on to `out`, a fresh runtime; a reloaded runtime replaces the
/// first one's, and nothing queued for that one reaches it.
pub fn set_writer(out: Box<dyn Write + Send>) {
    new_runtime();
    *OUT.get_or_init(|| Mutex::new(Box::new(std::io::sink())))
        .lock()
        .unwrap() = out;
}

pub fn write_line(message: serde_json::Value) {
    let line = format!("{message}\n");
    // Tests read what was sent right after the frame that sent it.
    if cfg!(test) {
        write_now(&line);
        return;
    }
    let lines = LINES.get_or_init(|| {
        let (send, receive) = std::sync::mpsc::channel::<(u64, String)>();
        std::thread::spawn(move || {
            let mut batch = String::new();
            for first in receive.iter() {
                batch.clear();
                let current = RUNTIME.load(Ordering::SeqCst);
                for (runtime, line) in std::iter::once(first).chain(receive.try_iter()) {
                    if runtime == current {
                        batch.push_str(&line);
                    }
                }
                if !batch.is_empty() {
                    write_now(&batch);
                }
            }
        });
        send
    });
    let _ = lines.send((RUNTIME.load(Ordering::SeqCst), line));
}

fn write_now(text: &str) {
    if let Some(out) = OUT.get() {
        let mut out = out.lock().unwrap();
        let _ = out.write_all(text.as_bytes());
        let _ = out.flush();
    }
}

/// The next event's sequence number; a tree's `ack` says which events it has seen.
pub(crate) fn next_seq() -> u64 {
    SEQ.fetch_add(1, Ordering::SeqCst) + 1
}

/// The sequence number of the last event sent.
pub fn last_seq() -> u64 {
    SEQ.load(Ordering::SeqCst)
}

pub(crate) fn generation() -> u64 {
    GEN.load(Ordering::SeqCst)
}

pub(crate) fn set_generation(generation: u64) {
    GEN.store(generation, Ordering::SeqCst);
}
