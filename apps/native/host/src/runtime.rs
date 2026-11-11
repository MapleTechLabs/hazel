//! The Bun runtime the window draws: a child process on stdin and stdout, replaced on a full page
//! load, with the keychain and updater requests it makes answered here.
use std::io::{BufRead, BufReader};
use std::process::Stdio;
use std::sync::{Arc, Mutex};

use hazel_native::outbox::{self, write_line};
use hazel_native::wire::RuntimeMsg;
use serde_json::json;

use crate::{platform, updater};

/// The runtime process running now; a reload replaces it.
#[derive(Clone)]
pub struct RuntimeChild(Arc<Mutex<Option<std::process::Child>>>);

impl RuntimeChild {
    pub fn id(&self) -> u32 {
        self.0
            .lock()
            .unwrap()
            .as_ref()
            .map_or(0, std::process::Child::id)
    }

    pub fn kill(&mut self) {
        if let Some(mut child) = self.0.lock().unwrap().take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    /// Asks the runtime to exit (SIGTERM), so it finishes what it writes on exit (a CPU
    /// profile), and kills it if it has not gone within 3 s.
    pub fn stop(&mut self) {
        if let Some(mut child) = self.0.lock().unwrap().take() {
            let _ = std::process::Command::new("kill")
                .args(["-TERM", &child.id().to_string()])
                .status();
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
            while std::time::Instant::now() < deadline {
                if matches!(child.try_wait(), Ok(Some(_))) {
                    return;
                }
                std::thread::sleep(std::time::Duration::from_millis(20));
            }
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

/// Starts a runtime at `path` (`NATIVE_PATH`), writing to it from now on; returns its stdout.
fn start_runtime(current: &RuntimeChild, path: Option<&str>) -> std::process::ChildStdout {
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
    // The version Settings > Desktop shows, for a build that knows it.
    if let Some(version) = updater::version() {
        command.env("HAZEL_APP_VERSION", version);
    }
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .expect("spawn the runtime");
    outbox::set_writer(Box::new(child.stdin.take().unwrap()));
    let stdout = child.stdout.take().unwrap();
    *current.0.lock().unwrap() = Some(child);
    stdout
}

/// Spawns the runtime (the bundled one, else Bun); its messages arrive on the returned channel.
/// A `reload` (a full page load in the app) replaces it with a fresh one at the new path.
pub fn spawn_runtime() -> (RuntimeChild, std::sync::mpsc::Receiver<RuntimeMsg>) {
    let current = RuntimeChild(Arc::new(Mutex::new(None)));
    let mut stdout = start_runtime(&current, None);
    let (send, receive) = std::sync::mpsc::channel();
    let mut supervised = current.clone();
    std::thread::spawn(move || {
        loop {
            let mut reload = None;
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                match serde_json::from_str::<RuntimeMsg>(&line) {
                    Ok(RuntimeMsg::Vault { id, op, record }) => {
                        hazel_native::sign_in::answer_vault(id, &op, record)
                    }
                    Ok(RuntimeMsg::Update { id, op }) => answer_update(id, op),
                    Ok(RuntimeMsg::Relaunch { id }) => match updater::relaunch_after_exit() {
                        Ok(()) => {
                            supervised.kill();
                            std::process::exit(0);
                        }
                        Err(error) => {
                            eprintln!("[host] {error}");
                            write_line(updater::reply(id, Err(error)));
                        }
                    },
                    Ok(RuntimeMsg::Reload { path }) => {
                        reload = Some(path);
                        break;
                    }
                    Ok(msg) => {
                        if send.send(msg).is_err() {
                            return;
                        }
                    }
                    Err(error) => eprintln!("[host] bad message: {error}"),
                }
            }
            let Some(path) = reload else { return };
            supervised.kill();
            stdout = start_runtime(&supervised, Some(&path));
            // The new runtime starts at the default size: tell it the window's.
            if let Some((width, height, dark)) = hazel_native::last_env() {
                write_line(json!({ "t": "env", "width": width, "height": height, "dark": dark }));
            }
        }
    });
    (current, receive)
}

/// Updater steps fetch, verify and move files: each runs off the reader and UI threads.
fn answer_update(id: u64, op: String) {
    std::thread::spawn(move || {
        let result = match op.as_str() {
            "check" => updater::check(),
            "download" => updater::download(|downloaded, total| {
                write_line(updater::progress_message(id, downloaded, total))
            })
            .map(|()| None),
            "install" => updater::install().map(|()| None),
            _ => Err(format!("unknown update request {op}")),
        };
        if let Err(error) = &result {
            eprintln!("[host] update {op}: {error}");
        }
        write_line(updater::reply(id, result));
    });
}
