//! The Bun runtime the window draws: a child process on stdin and stdout. A full page load in
//! the app replaces it with a fresh one, and one that ends on its own starts again (a few times a
//! minute at most), at the page it last loaded, as a browser reloads a crashed tab.
use std::io::{BufRead, BufReader};
use std::process::{Child, ChildStdout, ExitStatus, Stdio};
use std::sync::mpsc::{Receiver, channel};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use hazel_native::outbox::{self, write_line};
use hazel_native::shell::{self, Restarts, Routed, ShellRequest};
use hazel_native::wire::RuntimeMsg;

use crate::{platform, updater};
use hazel_native::notify;

/// What the window hears from the runtime.
// One message at a time, as `RuntimeMsg` itself; boxing the tree would only add an allocation.
#[allow(clippy::large_enum_variant)]
pub enum FromRuntime {
    /// A message for the window (`shell::apply`).
    Message(RuntimeMsg),
    /// A fresh runtime took the last one's place: the window forgets what it kept for it.
    Replaced,
}

/// The runtime process running now; a reload or a restart replaces it.
#[derive(Clone)]
pub struct RuntimeChild(Arc<Mutex<Option<Child>>>);

impl RuntimeChild {
    pub fn id(&self) -> u32 {
        self.0.lock().unwrap().as_ref().map_or(0, Child::id)
    }

    pub fn kill(&mut self) {
        if let Some(mut child) = self.0.lock().unwrap().take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    /// Asks the runtime to exit (SIGTERM), so it finishes what it writes on exit (its saved
    /// storage, a CPU profile), and kills it if it has not gone within 3 s.
    pub fn stop(&mut self) {
        if let Some(mut child) = self.0.lock().unwrap().take() {
            // Windows has no SIGTERM to ask with: it ends at once, as `kill` does (what it
            // stored was saved within the last 200 ms).
            #[cfg(not(unix))]
            {
                let _ = child.kill();
                let _ = child.wait();
                return;
            }
            #[cfg(unix)]
            let _ = std::process::Command::new("/bin/kill")
                .args(["-TERM", &child.id().to_string()])
                .status();
            let deadline = Instant::now() + Duration::from_secs(3);
            while Instant::now() < deadline {
                if matches!(child.try_wait(), Ok(Some(_))) {
                    return;
                }
                std::thread::sleep(Duration::from_millis(20));
            }
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    /// The runtime ended on its own: how. `None` when the host stopped it (the app is quitting).
    fn reap(&self) -> Option<std::io::Result<ExitStatus>> {
        self.0.lock().unwrap().take().map(|mut child| child.wait())
    }
}

/// Starts a runtime at `path` (`NATIVE_PATH`), writing to it from now on; returns its stdout.
fn start_runtime(current: &RuntimeChild, path: Option<&str>) -> Result<ChildStdout, String> {
    let host = std::env::current_exe().ok();
    let host_dir = host.as_deref().and_then(std::path::Path::parent);
    let mut command = platform::runtime_command(host_dir, std::env::var("HAZEL_NATIVE_ENTRY").ok());
    if let Some(path) = path {
        command.env("NATIVE_PATH", path);
    }
    // The runtime offers the app's update checks only where the host can install them.
    if updater::enabled() {
        command.env("HAZEL_UPDATES", "1");
    }
    // System notifications, for a bundle the system knows.
    if notify::available() {
        command.env("HAZEL_NOTIFICATIONS", "1");
    }
    // The version Settings > Desktop shows, for a build that knows it.
    if let Some(version) = updater::version() {
        command.env("HAZEL_APP_VERSION", version);
    }
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|error| {
            format!(
                "cannot start the runtime ({:?}): {error}",
                command.get_program()
            )
        })?;
    let (Some(stdin), Some(stdout)) = (child.stdin.take(), child.stdout.take()) else {
        let _ = child.kill();
        return Err("the runtime has no stdin or stdout".into());
    };
    outbox::set_writer(Box::new(stdin));
    *current.0.lock().unwrap() = Some(child);
    Ok(stdout)
}

/// Spawns the runtime (the bundled one, else Bun); its messages for the window arrive on the
/// returned channel. The keychain vault, updates, page loads and restarts are handled here.
pub fn spawn_runtime() -> Result<(RuntimeChild, Receiver<FromRuntime>), String> {
    let current = RuntimeChild(Arc::new(Mutex::new(None)));
    let mut stdout = start_runtime(&current, None)?;
    let (send, receive) = channel();
    let mut supervised = current.clone();
    std::thread::spawn(move || {
        let mut restarts = Restarts::default();
        // Where the last full page load went; a restart goes back there.
        let mut last_path: Option<String> = None;
        loop {
            let mut reload = None;
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                let message = match serde_json::from_str::<RuntimeMsg>(&line) {
                    Ok(message) => message,
                    Err(error) => {
                        eprintln!("[host] bad message: {error}");
                        continue;
                    }
                };
                match shell::route(message) {
                    Routed::Done => {}
                    Routed::Window(message) => {
                        if send.send(FromRuntime::Message(message)).is_err() {
                            return;
                        }
                    }
                    Routed::Shell(ShellRequest::Update { id, op }) => updater::answer(id, op),
                    Routed::Shell(ShellRequest::NotifyPermission { id, request }) => {
                        notify::permission(id, request, |_| {})
                    }
                    Routed::Shell(ShellRequest::Notify { title, body, group }) => {
                        notify::show(&title, &body, group.as_deref())
                    }
                    Routed::Shell(ShellRequest::Relaunch { id }) => {
                        match updater::relaunch_after_exit() {
                            Ok(()) => {
                                supervised.stop();
                                std::process::exit(0);
                            }
                            Err(error) => {
                                eprintln!("[host] {error}");
                                write_line(updater::reply(id, Err(error)));
                            }
                        }
                    }
                    Routed::Shell(ShellRequest::Reload { path }) => {
                        reload = Some(path);
                        break;
                    }
                }
            }
            match reload {
                Some(path) => {
                    supervised.kill();
                    last_path = Some(path);
                }
                None => {
                    let Some(status) = supervised.reap() else {
                        return;
                    };
                    eprintln!("[host] the runtime ended ({status:?})");
                    if !restarts.allow(Instant::now()) {
                        eprintln!("[host] the runtime keeps ending; not starting it again");
                        return;
                    }
                }
            }
            stdout = match start_runtime(&supervised, last_path.as_deref()) {
                Ok(stdout) => stdout,
                Err(error) => {
                    eprintln!("[host] {error}");
                    return;
                }
            };
            shell::runtime_replaced(None);
            if send.send(FromRuntime::Replaced).is_err() {
                return;
            }
        }
    });
    Ok((current, receive))
}
