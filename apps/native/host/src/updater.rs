//! Updates for the bundled app, from the feed the Tauri app reads: the latest release's
//! `latest.json`, whose `darwin-aarch64` and `darwin-x86_64` entries are this app's
//! `Hazel_<version>_<arch>.app.tar.gz`, signed with the Tauri updater's minisign key. The Tauri
//! app installs the same archive over itself, which is how a Mac moves from it to this one.
//!
//! The runtime drives it as the web app drives Tauri's updater (`platform/updates.ts`): `check`,
//! `download` (verified before it counts as downloaded), `install` (the bundle swapped in place),
//! then `relaunch`. Like images, the network goes through `curl`.
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

use base64::Engine;
use serde::Deserialize;
use serde_json::{Value, json};

/// The latest release's update manifest, redirected to its asset.
const FEED: &str = "https://github.com/HazelChat/hazel/releases/latest/download/latest.json";

/// This build's version and the key its updates are signed with (base64 of the minisign public
/// key file, as `tauri.conf.json` has it), compiled in by `scripts/bundle.ts`. A build without
/// them, as one from source is, never offers an update.
const VERSION: Option<&str> = option_env!("HAZEL_VERSION");
const PUBKEY: Option<&str> = option_env!("HAZEL_UPDATER_PUBKEY");

/// One platform's entry in the manifest.
#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct Asset {
    pub url: String,
    pub signature: String,
}

/// The manifest (Tauri's `latest.json`): the fields this app reads.
#[derive(Debug, Deserialize)]
pub struct Manifest {
    pub version: String,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub platforms: HashMap<String, Asset>,
}

/// A release newer than this build, for this Mac.
#[derive(Clone, Debug, PartialEq)]
pub struct Release {
    pub version: String,
    pub notes: Option<String>,
    pub asset: Asset,
}

/// What the last `check` found, and the archive `download` verified for it.
static FOUND: Mutex<Option<Release>> = Mutex::new(None);
static DOWNLOADED: Mutex<Option<PathBuf>> = Mutex::new(None);

/// The manifest key for this build's architecture.
pub fn target() -> &'static str {
    if cfg!(target_arch = "aarch64") {
        "darwin-aarch64"
    } else {
        "darwin-x86_64"
    }
}

/// This build's version, when it is a release build.
pub fn version() -> Option<&'static str> {
    VERSION
}

/// Whether this app can update itself: a release build, run from its bundle.
pub fn enabled() -> bool {
    VERSION.is_some() && PUBKEY.is_some() && bundle_path().is_some()
}

/// The `.app` this host runs from (`Hazel.app/Contents/MacOS/hazel-native`).
pub fn bundle_path() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?.canonicalize().ok()?;
    bundle_of(&exe)
}

fn bundle_of(exe: &Path) -> Option<PathBuf> {
    let macos = exe.parent()?;
    let contents = macos.parent()?;
    let app = contents.parent()?;
    let is_bundle = macos.file_name()? == "MacOS"
        && contents.file_name()? == "Contents"
        && app.extension()? == "app";
    is_bundle.then(|| app.to_path_buf())
}

/// `major.minor.patch`, numerically; a pre-release suffix (`-beta.1`) and build metadata are
/// dropped, so a pre-release counts as its release.
fn parse_version(version: &str) -> Option<(u64, u64, u64)> {
    let core = version.trim().trim_start_matches('v');
    let core = core.split(['-', '+']).next()?;
    let mut parts = core.split('.').map(|part| part.parse::<u64>().ok());
    let version = (
        parts.next()??,
        parts.next().unwrap_or(Some(0))?,
        parts.next().unwrap_or(Some(0))?,
    );
    parts.next().is_none().then_some(version)
}

/// The manifest's release when it is newer than `current` and has an archive for `target`.
pub fn newer(manifest: &Manifest, current: &str, target: &str) -> Option<Release> {
    let (latest, current) = (parse_version(&manifest.version)?, parse_version(current)?);
    if latest <= current {
        return None;
    }
    let asset = manifest.platforms.get(target)?.clone();
    Some(Release {
        version: manifest.version.trim_start_matches('v').to_string(),
        notes: manifest.notes.clone().filter(|notes| !notes.is_empty()),
        asset,
    })
}

/// Whether `signature` (base64 of a minisign signature file) signs `data` under `pubkey` (base64
/// of a minisign public key file): Tauri's own check, so one key signs both apps' updates.
pub fn verify(data: &[u8], signature: &str, pubkey: &str) -> Result<(), String> {
    let text = |encoded: &str| {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(encoded.trim())
            .map_err(|e| format!("not base64: {e}"))?;
        String::from_utf8(bytes).map_err(|e| format!("not text: {e}"))
    };
    let key = minisign_verify::PublicKey::decode(&text(pubkey)?).map_err(|e| e.to_string())?;
    let signature =
        minisign_verify::Signature::decode(&text(signature)?).map_err(|e| e.to_string())?;
    key.verify(data, &signature, true)
        .map_err(|e| e.to_string())
}

fn curl() -> Command {
    let mut command = Command::new("curl");
    // Fail on an HTTP error, follow GitHub's redirect to the asset, give up on a dead network.
    command.args(["-fsSL", "--connect-timeout", "15"]);
    command
}

/// Fetches the manifest and keeps what it offers this build.
pub fn check() -> Result<Option<Release>, String> {
    let current = VERSION.ok_or("this build does not update")?;
    let feed = std::env::var("HAZEL_UPDATE_FEED").unwrap_or_else(|_| FEED.to_string());
    let output = curl()
        .args(["--max-time", "30", &feed])
        .output()
        .map_err(|e| format!("curl: {e}"))?;
    if !output.status.success() {
        return Err(format!("fetching {feed} failed ({})", output.status));
    }
    let manifest: Manifest =
        serde_json::from_slice(&output.stdout).map_err(|e| format!("bad manifest: {e}"))?;
    let found = newer(&manifest, current, target());
    *FOUND.lock().unwrap() = found.clone();
    *DOWNLOADED.lock().unwrap() = None;
    Ok(found)
}

/// Downloads the release `check` found, reporting `(downloaded, total)` bytes as it goes, and
/// verifies its signature: a download that does not verify is deleted and fails.
pub fn download(progress: impl Fn(u64, Option<u64>)) -> Result<(), String> {
    let release = FOUND.lock().unwrap().clone().ok_or("no update was found")?;
    let pubkey = PUBKEY.ok_or("this build does not update")?;
    let file = std::env::temp_dir().join(format!("hazel-update-{}.app.tar.gz", release.version));
    let _ = std::fs::remove_file(&file);

    let total = content_length(&release.asset.url);
    progress(0, total);
    let mut child = curl()
        .arg("-o")
        .arg(&file)
        .arg(&release.asset.url)
        .stdout(Stdio::null())
        .spawn()
        .map_err(|e| format!("curl: {e}"))?;
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            break status;
        }
        let size = std::fs::metadata(&file).map_or(0, |m| m.len());
        progress(size, total);
        std::thread::sleep(Duration::from_millis(150));
    };
    if !status.success() {
        let _ = std::fs::remove_file(&file);
        return Err(format!(
            "downloading {} failed ({status})",
            release.asset.url
        ));
    }
    let bytes = std::fs::read(&file).map_err(|e| e.to_string())?;
    progress(bytes.len() as u64, total.or(Some(bytes.len() as u64)));
    if let Err(error) = verify(&bytes, &release.asset.signature, pubkey) {
        let _ = std::fs::remove_file(&file);
        return Err(format!("the update's signature does not verify: {error}"));
    }
    *DOWNLOADED.lock().unwrap() = Some(file);
    Ok(())
}

/// The archive's size from its headers (after redirects), when the server says.
fn content_length(url: &str) -> Option<u64> {
    let output = curl().args(["-I", "--max-time", "15", url]).output().ok()?;
    // The last response's: GitHub answers with a redirect first.
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .rev()
        .find_map(|line| {
            let (name, value) = line.split_once(':')?;
            name.trim()
                .eq_ignore_ascii_case("content-length")
                .then(|| value.trim().parse().ok())?
        })
}

/// Swaps the downloaded app in for the running bundle. The old bundle moves aside first and
/// comes back if the new one cannot take its place. The running host keeps its open files, so
/// it carries on until `relaunch`.
pub fn install() -> Result<(), String> {
    let archive = DOWNLOADED
        .lock()
        .unwrap()
        .clone()
        .ok_or("no verified update was downloaded")?;
    let bundle = bundle_path().ok_or("not running from an app bundle")?;
    install_into(&archive, &bundle)?;
    let _ = std::fs::remove_file(&archive);
    *DOWNLOADED.lock().unwrap() = None;
    Ok(())
}

/// Extracts `archive` (one `<Name>.app` at its top, as Tauri's are) beside `bundle`, on the same
/// volume so the swap is two renames, and puts it in `bundle`'s place.
pub fn install_into(archive: &Path, bundle: &Path) -> Result<(), String> {
    let parent = bundle.parent().ok_or("the bundle has no folder")?;
    let name = bundle
        .file_name()
        .ok_or("the bundle has no name")?
        .to_string_lossy();
    let staging = parent.join(format!(".{name}.update"));
    let backup = parent.join(format!(".{name}.previous"));
    let _ = std::fs::remove_dir_all(&staging);
    let _ = std::fs::remove_dir_all(&backup);
    std::fs::create_dir_all(&staging)
        .map_err(|e| format!("cannot write next to {}: {e}", bundle.display()))?;

    let cleanup = |error: String| {
        let _ = std::fs::remove_dir_all(&staging);
        error
    };
    let status = Command::new("/usr/bin/tar")
        .arg("-xzf")
        .arg(archive)
        .arg("-C")
        .arg(&staging)
        .status()
        .map_err(|e| cleanup(format!("tar: {e}")))?;
    if !status.success() {
        return Err(cleanup(format!("extracting the update failed ({status})")));
    }
    let app = std::fs::read_dir(&staging)
        .map_err(|e| cleanup(e.to_string()))?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .find(|path| path.extension().is_some_and(|ext| ext == "app") && path.is_dir())
        .ok_or_else(|| cleanup("the update has no app in it".into()))?;

    std::fs::rename(bundle, &backup)
        .map_err(|e| cleanup(format!("cannot move the app aside: {e}")))?;
    if let Err(error) = std::fs::rename(&app, bundle) {
        let _ = std::fs::rename(&backup, bundle);
        return Err(cleanup(format!(
            "cannot move the update into place: {error}"
        )));
    }
    let _ = std::fs::remove_dir_all(&backup);
    let _ = std::fs::remove_dir_all(&staging);
    // Launch Services and the Dock pick up the new bundle's Info.plist and icon.
    let _ = Command::new("touch").arg(bundle).status();
    Ok(())
}

/// Opens the bundle again once this process has exited, through Launch Services, so the new
/// one starts as a fresh app (its own environment and session), then exits.
pub fn relaunch_after_exit() -> Result<(), String> {
    let bundle = bundle_path().ok_or("not running from an app bundle")?;
    Command::new("/bin/sh")
        .args([
            "-c",
            r#"while kill -0 "$1" 2>/dev/null; do sleep 0.1; done; exec /usr/bin/open -n "$2""#,
            "relaunch",
        ])
        .arg(std::process::id().to_string())
        .arg(&bundle)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("cannot relaunch: {e}"))
}

/// The answer to update request `id`: what it found (`version` absent when nothing is newer),
/// or why it failed.
pub fn reply(id: u64, result: Result<Option<Release>, String>) -> Value {
    match result {
        Ok(Some(release)) => json!({
            "t": "update", "id": id, "version": release.version, "notes": release.notes,
        }),
        Ok(None) => json!({ "t": "update", "id": id }),
        Err(error) => json!({ "t": "update", "id": id, "error": error }),
    }
}

pub fn progress_message(id: u64, downloaded: u64, total: Option<u64>) -> Value {
    json!({ "t": "updateProgress", "id": id, "downloaded": downloaded, "total": total })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest(json: &str) -> Manifest {
        serde_json::from_str(json).unwrap()
    }

    const FEED_JSON: &str = r#"{
        "version": "1.1.0",
        "notes": "Hazel on Rune",
        "pub_date": "2026-11-10T00:00:00Z",
        "platforms": {
            "darwin-aarch64": { "signature": "c2ln", "url": "https://example.test/Hazel_1.1.0_aarch64.app.tar.gz" },
            "windows-x86_64": { "signature": "c2ln", "url": "https://example.test/Hazel_1.1.0_x64-setup.exe" }
        }
    }"#;

    #[test]
    fn a_newer_release_for_this_mac_is_offered() {
        let found = newer(&manifest(FEED_JSON), "1.0.4", "darwin-aarch64").unwrap();
        assert_eq!(found.version, "1.1.0");
        assert_eq!(found.notes.as_deref(), Some("Hazel on Rune"));
        assert!(found.asset.url.ends_with("aarch64.app.tar.gz"));
    }

    #[test]
    fn the_same_an_older_or_a_missing_platform_offers_nothing() {
        let feed = manifest(FEED_JSON);
        assert_eq!(newer(&feed, "1.1.0", "darwin-aarch64"), None);
        assert_eq!(newer(&feed, "1.2.0", "darwin-aarch64"), None);
        assert_eq!(newer(&feed, "1.0.4", "darwin-x86_64"), None);
    }

    #[test]
    fn versions_compare_numerically() {
        assert_eq!(parse_version("v1.10.0"), Some((1, 10, 0)));
        assert_eq!(parse_version("1.2"), Some((1, 2, 0)));
        assert_eq!(parse_version("1.1.0-beta.2"), Some((1, 1, 0)));
        assert_eq!(parse_version("1.x"), None);
        assert!(parse_version("1.10.0") > parse_version("1.9.9"));
    }

    #[test]
    fn a_host_in_a_bundle_finds_it() {
        let exe = Path::new("/Applications/Hazel.app/Contents/MacOS/hazel-native");
        assert_eq!(
            bundle_of(exe),
            Some(PathBuf::from("/Applications/Hazel.app"))
        );
        assert_eq!(
            bundle_of(Path::new("/repo/host/target/release/hazel-native")),
            None
        );
    }

    // A throwaway key from `tauri signer generate`, and its signature over `PAYLOAD` from
    // `tauri signer sign`: what CI makes for each release with the real key.
    const TEST_PUBKEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEE5NDg3RTA3N0ZENDQxRjcKUldUM1FkUi9CMzVJcWVIVVpEYVRvMURuU2d5bUNFU25UTXV5ZUt6MzRoVkF5bUxNaXR2R1hxdDcK";
    const TEST_SIGNATURE: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVUM1FkUi9CMzVJcVgzaVRvbnBRMytYTklIL25oNTA4UWNvdUpXd2gySWcyeXBDeVhZdlQ3UFk1OFBrNUxmMkNJY2I0TXFYcHd1Mm5pZmcvTVRMVW9XVVJNWVN2VEE5Z3dJPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzk0MzE0MDY4CWZpbGU6cGF5bG9hZC5iaW4KdWRiTzBjdXBtLzFlanNJNVowKzZiSE12d0VsaGdmQ2tHRWhsMXFKdHFYc1BPUlJNSldabFlhMk9WM1VJT0NNTGtTYWdGY0hGb3NpREJtd0Q4ZkhFQnc9PQo=";
    const PAYLOAD: &[u8] = b"hazel update payload";

    #[test]
    fn a_tauri_signature_verifies_and_tampering_fails() {
        assert_eq!(verify(PAYLOAD, TEST_SIGNATURE, TEST_PUBKEY), Ok(()));
        assert!(verify(b"hazel update payloaD", TEST_SIGNATURE, TEST_PUBKEY).is_err());
        assert!(verify(PAYLOAD, "bm90IGEgc2lnbmF0dXJl", TEST_PUBKEY).is_err());
        assert!(verify(PAYLOAD, "!!", TEST_PUBKEY).is_err());
    }

    #[test]
    fn an_update_takes_the_bundles_place() {
        let root = std::env::temp_dir().join(format!("hazel-update-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let bundle = root.join("Applications/Hazel.app");
        std::fs::create_dir_all(bundle.join("Contents/MacOS")).unwrap();
        std::fs::write(bundle.join("Contents/MacOS/app"), "old").unwrap();

        let source = root.join("build/Hazel.app/Contents/MacOS");
        std::fs::create_dir_all(&source).unwrap();
        std::fs::write(source.join("hazel-native"), "new").unwrap();
        let archive = root.join("Hazel.app.tar.gz");
        let status = Command::new("/usr/bin/tar")
            .arg("-czf")
            .arg(&archive)
            .arg("-C")
            .arg(root.join("build"))
            .arg("Hazel.app")
            .status()
            .unwrap();
        assert!(status.success());

        install_into(&archive, &bundle).unwrap();
        let installed =
            std::fs::read_to_string(bundle.join("Contents/MacOS/hazel-native")).unwrap();
        let leftovers: Vec<_> = std::fs::read_dir(root.join("Applications"))
            .unwrap()
            .map(|e| e.unwrap().file_name())
            .collect();
        let _ = std::fs::remove_dir_all(&root);
        assert_eq!(installed, "new");
        assert!(!bundle.join("Contents/MacOS/app").exists());
        assert_eq!(leftovers, ["Hazel.app"]);
    }
}
