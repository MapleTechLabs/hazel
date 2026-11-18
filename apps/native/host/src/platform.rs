//! Which runtime the macOS host starts (the bundled executable, or Bun on the sources), and with
//! what environment. Sign-in's vault and callback links are `hazel_native::sign_in`.
use std::path::{Path, PathBuf};
use std::process::Command;

use serde_json::Value;

/// The runtime a bundle ships beside the host (`Contents/MacOS/hazel-runtime`).
pub const BUNDLED_RUNTIME: &str = "hazel-runtime";

/// The environment a bundle runs with (`Contents/Resources/environment.json`, written by
/// `scripts/bundle.ts`: live data against production). It applies however the app starts —
/// Finder, `open`, or the Tauri updater's relaunch, which runs the executable directly and so
/// skips Info.plist's `LSEnvironment` — and a variable the host was started with wins.
pub const BUNDLED_ENVIRONMENT: &str = "environment.json";

/// The bundle's environment, minus what the host's own environment already sets.
pub fn bundled_environment(resources: &Path) -> Vec<(String, String)> {
    let Ok(text) = std::fs::read_to_string(resources.join(BUNDLED_ENVIRONMENT)) else {
        return Vec::new();
    };
    let Ok(Value::Object(entries)) = serde_json::from_str::<Value>(&text) else {
        eprintln!("[host] {BUNDLED_ENVIRONMENT} is not a JSON object");
        return Vec::new();
    };
    entries
        .into_iter()
        .filter_map(|(key, value)| Some((key, value.as_str()?.to_string())))
        .filter(|(key, _)| std::env::var_os(key).is_none())
        .collect()
}

/// The bundled runtime when there is one beside the host, with the precompiled styles and the
/// environment from `Contents/Resources`; otherwise Bun on `HAZEL_NATIVE_ENTRY` (default
/// `src/entry.ts`).
pub fn runtime_command(host_dir: Option<&Path>, entry: Option<String>) -> Command {
    let bundled = host_dir
        .map(|dir| dir.join(BUNDLED_RUNTIME))
        .filter(|path| path.is_file());
    match (bundled, entry) {
        (Some(runtime), None) => {
            let mut command = Command::new(&runtime);
            if let Some(resources) = resources_of(&runtime) {
                command.env("HAZEL_NATIVE_STYLES", resources.join("styles.json"));
                command.envs(bundled_environment(&resources));
            }
            command
        }
        (_, entry) => {
            let mut command = Command::new(bun());
            command.arg(entry.unwrap_or_else(|| "src/entry.ts".into()));
            command
        }
    }
}

/// The web app's public assets a bundle ships (`Contents/Resources/public`), if this is one.
pub fn bundled_assets() -> Option<PathBuf> {
    let host = std::env::current_exe().ok()?;
    let public = resources_of(&host)?.join("public");
    if public.is_dir() {
        return Some(public);
    }
    // Run from source (`host/target/release/hazel-native`): the web app's own public folder.
    let source = host
        .parent()?
        .parent()?
        .parent()?
        .parent()?
        .join("../web-foldkit/public");
    source.is_dir().then_some(source)
}

/// `Contents/Resources` for a binary in `Contents/MacOS`.
fn resources_of(binary: &Path) -> Option<PathBuf> {
    let contents = binary.parent()?.parent()?;
    Some(contents.join("Resources"))
}

const BUN: &str = if cfg!(windows) { "bun.exe" } else { "bun" };

/// Bun on `PATH`, or where its installer puts it: an app opened from Finder has a bare `PATH`.
fn bun() -> PathBuf {
    let on_path = std::env::var_os("PATH")
        .into_iter()
        .flat_map(|paths| std::env::split_paths(&paths).collect::<Vec<_>>())
        .map(|dir| dir.join(BUN))
        .find(|path| path.is_file());
    let home = std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE"));
    let installed = home.map(|home| Path::new(&home).join(".bun/bin").join(BUN));
    on_path.or(installed).unwrap_or_else(|| BUN.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_bundle_runs_with_its_environment_unless_the_host_sets_it() {
        let root = std::env::temp_dir().join(format!("hazel-native-env-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(
            root.join(BUNDLED_ENVIRONMENT),
            r#"{"HAZEL_TEST_BUNDLE_ONLY":"live","PATH":"/nowhere","HAZEL_TEST_NUMBER":1}"#,
        )
        .unwrap();
        let env = bundled_environment(&root);
        let _ = std::fs::remove_dir_all(&root);
        // PATH is the host's own; a value that is not a string is skipped.
        assert_eq!(
            env,
            [("HAZEL_TEST_BUNDLE_ONLY".to_string(), "live".to_string())]
        );
        assert!(bundled_environment(Path::new("/nonexistent")).is_empty());
    }

    #[test]
    fn a_bundle_runs_its_own_runtime_with_its_styles() {
        let root = std::env::temp_dir().join(format!("hazel-native-test-{}", std::process::id()));
        let macos = root.join("Contents/MacOS");
        std::fs::create_dir_all(&macos).unwrap();
        std::fs::write(macos.join(BUNDLED_RUNTIME), "").unwrap();

        let bundled = runtime_command(Some(&macos), None);
        let styles = bundled
            .get_envs()
            .find(|(key, _)| *key == "HAZEL_NATIVE_STYLES")
            .and_then(|(_, value)| value.map(PathBuf::from));
        assert_eq!(bundled.get_program(), macos.join(BUNDLED_RUNTIME));
        assert_eq!(styles, Some(root.join("Contents/Resources/styles.json")));

        // An entry asked for by name runs from source, bundle or not.
        let source = runtime_command(Some(&macos), Some("dist/entry.js".into()));
        assert!(source.get_program().to_string_lossy().ends_with(BUN));
        assert_eq!(source.get_args().collect::<Vec<_>>(), ["dist/entry.js"]);
        let _ = std::fs::remove_dir_all(&root);
        assert!(
            runtime_command(Some(&macos), None)
                .get_program()
                .to_string_lossy()
                .ends_with(BUN)
        );
    }
}
