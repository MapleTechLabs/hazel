//! What every shell (the macOS app, the iOS app) does with the runtime the same way: which of
//! its messages the window takes and which only the shell can answer, how often a runtime that
//! keeps ending may start again, and what a fresh runtime needs when it replaces the last one.
use std::time::{Duration, Instant};

use rune::AppHandle;

use crate::State;
use crate::wire::RuntimeMsg;

/// A runtime message only the shell can act on: it owns the runtime and the app's bundle.
#[derive(Debug, PartialEq)]
pub enum ShellRequest {
    /// A full page load in the app: a fresh runtime at `path`.
    Reload { path: String },
    /// A step of the app's update (`check`, `download`, `install`), answered as `update` with `id`.
    Update { id: u64, op: String },
    /// Quit and open the app again (after an update); answered only when that fails.
    Relaunch { id: u64 },
    /// May the app show notifications (asking first with `request`)? Answered by
    /// `permission_reply`.
    NotifyPermission { id: u64, request: bool },
    /// A system notification.
    Notify {
        title: String,
        body: String,
        group: Option<String>,
    },
}

/// The answer to notification permission request `id`.
pub fn permission_reply(id: u64, granted: bool) -> serde_json::Value {
    serde_json::json!({ "t": "notifyPermission", "id": id, "granted": granted })
}

/// The window became the key window or stopped being it: the runtime's `document.hasFocus()`,
/// which notifications wait on.
pub fn window_focus_message(focused: bool) -> serde_json::Value {
    serde_json::json!({ "t": "windowFocus", "focused": focused })
}

/// Where a runtime message goes.
// One message at a time, as `RuntimeMsg` itself; boxing the tree would only add an allocation.
#[allow(clippy::large_enum_variant)]
pub enum Routed {
    /// To the window: a tree, a scroll, a request against the next commit.
    Window(RuntimeMsg),
    /// To the shell.
    Shell(ShellRequest),
    /// Answered already (the keychain vault, on its own thread).
    Done,
}

/// Sorts one runtime message. The vault is answered here, off the window's thread, so sign-in
/// reads it before the window has drawn anything.
pub fn route(message: RuntimeMsg) -> Routed {
    match message {
        RuntimeMsg::Vault { id, op, record } => {
            crate::sign_in::answer_vault(id, &op, record);
            Routed::Done
        }
        RuntimeMsg::Reload { path } => Routed::Shell(ShellRequest::Reload { path }),
        RuntimeMsg::Update { id, op } => Routed::Shell(ShellRequest::Update { id, op }),
        RuntimeMsg::Relaunch { id } => Routed::Shell(ShellRequest::Relaunch { id }),
        RuntimeMsg::NotifyPermission { id, request } => {
            Routed::Shell(ShellRequest::NotifyPermission { id, request })
        }
        RuntimeMsg::Notify { title, body, group } => {
            Routed::Shell(ShellRequest::Notify { title, body, group })
        }
        message => Routed::Window(message),
    }
}

/// Applies a message `route` gave the window.
pub fn apply(message: RuntimeMsg, handle: &AppHandle<State>) {
    match message {
        RuntimeMsg::Tree(tree) => handle.update_if(move |s: &mut State, _| s.apply(tree)),
        RuntimeMsg::Scroll { path, top, seq } => {
            crate::note_scroll(&path, seq);
            handle.update(move |_: &mut State, tx| tx.scroll_to_instant(path, 0.0, top));
        }
        request => {
            if let Some(run) = request.request() {
                handle.update(move |_: &mut State, tx| run(tx));
            }
        }
    }
}

/// A fresh runtime replaced the last one (a page load, a restart): lines still on their way to
/// the old one are dropped, it hears the window's size and theme (it starts at the default),
/// and the window forgets what it kept for the old one's trees.
pub fn runtime_replaced(handle: Option<&AppHandle<State>>) {
    crate::outbox::new_runtime();
    if let Some(env) = crate::last_env() {
        crate::outbox::write_line(env.line());
    }
    if let Some(handle) = handle {
        handle.update(|s: &mut State, _| s.runtime_replaced());
    }
}

/// How often a runtime that ended may start again: one that ends on every start would otherwise
/// restart for as long as the app is open.
const RESTARTS: usize = 3;
const RESTART_WINDOW: Duration = Duration::from_secs(60);

/// The restarts after the runtime ended, recent ones only.
#[derive(Default)]
pub struct Restarts(Vec<Instant>);

impl Restarts {
    /// Whether the runtime may restart now, counting this one if so.
    pub fn allow(&mut self, now: Instant) -> bool {
        self.0.retain(|at| now.duration_since(*at) < RESTART_WINDOW);
        let allowed = self.0.len() < RESTARTS;
        if allowed {
            self.0.push(now);
        }
        allowed
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_runtime_restarts_three_times_a_minute_at_most() {
        let mut restarts = Restarts::default();
        let start = Instant::now();
        assert!((0..3).all(|i| restarts.allow(start + Duration::from_secs(i))));
        assert!(!restarts.allow(start + Duration::from_secs(10)));
        // Once the first has aged out, one more may.
        assert!(restarts.allow(start + Duration::from_secs(61)));
    }

    #[test]
    fn the_shell_answers_page_loads_and_updates_and_the_window_the_rest() {
        let parse = |line: &str| serde_json::from_str::<RuntimeMsg>(line).expect("message");
        assert!(matches!(
            route(parse(r#"{"t":"reload","path":"/hazel"}"#)),
            Routed::Shell(ShellRequest::Reload { path }) if path == "/hazel"
        ));
        assert!(matches!(
            route(parse(r#"{"t":"update","id":4,"op":"check"}"#)),
            Routed::Shell(ShellRequest::Update { id: 4, .. })
        ));
        assert!(matches!(
            route(parse(r#"{"t":"relaunch","id":5}"#)),
            Routed::Shell(ShellRequest::Relaunch { id: 5 })
        ));
        assert!(matches!(
            route(parse(r#"{"t":"focus","key":"r/1"}"#)),
            Routed::Window(RuntimeMsg::Focus { .. })
        ));
    }
}
