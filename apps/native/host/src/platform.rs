//! What the host does for the runtime outside drawing: the sign-in vault in the macOS keychain,
//! links the system opens with the app (`com.hazel.native://auth/callback?...`), and which
//! runtime to start (the bundled executable, or Bun on the sources).
use std::path::{Path, PathBuf};
use std::process::Command;

use serde_json::{Value, json};

/// The keychain item holding the vault's one JSON record (`@hazel/auth/desktop`'s `RecordStore`).
pub const VAULT_SERVICE: &str = "com.hazel.native";
pub const VAULT_ACCOUNT: &str = "auth";

/// A vault request from the runtime: read the record, or replace it.
#[derive(Debug, PartialEq, Eq)]
pub enum VaultOp {
    Read,
    Write(String),
}

/// The record (`None` when there is none yet), or why the keychain refused.
pub fn run_vault(service: &str, op: &VaultOp) -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(service, VAULT_ACCOUNT).map_err(|e| e.to_string())?;
    match op {
        VaultOp::Read => match entry.get_password() {
            Ok(record) => Ok(Some(record)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        },
        VaultOp::Write(record) => entry
            .set_password(record)
            .map(|()| None)
            .map_err(|e| e.to_string()),
    }
}

/// The runtime's answer to vault request `id`.
pub fn vault_reply(id: u64, result: Result<Option<String>, String>) -> Value {
    match result {
        Ok(record) => json!({ "t": "vault", "id": id, "record": record }),
        Err(error) => json!({ "t": "vault", "id": id, "error": error }),
    }
}

/// A link the system opened with the app, passed through as given: the runtime validates it.
pub fn open_url_message(url: &str) -> Value {
    json!({ "t": "openUrl", "url": url })
}

/// The runtime a bundle ships beside the host (`Contents/MacOS/hazel-runtime`).
pub const BUNDLED_RUNTIME: &str = "hazel-runtime";

/// The bundled runtime when there is one beside the host, with the precompiled styles from
/// `Contents/Resources`; otherwise Bun on `HAZEL_NATIVE_ENTRY` (default `src/entry.ts`).
pub fn runtime_command(host_dir: Option<&Path>, entry: Option<String>) -> Command {
    let bundled = host_dir
        .map(|dir| dir.join(BUNDLED_RUNTIME))
        .filter(|path| path.is_file());
    match (bundled, entry) {
        (Some(runtime), None) => {
            let mut command = Command::new(&runtime);
            if let Some(styles) = resources_of(&runtime).map(|dir| dir.join("styles.json")) {
                command.env("HAZEL_NATIVE_STYLES", styles);
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
    public.is_dir().then_some(public)
}

/// `Contents/Resources` for a binary in `Contents/MacOS`.
fn resources_of(binary: &Path) -> Option<PathBuf> {
    let contents = binary.parent()?.parent()?;
    Some(contents.join("Resources"))
}

/// Bun on `PATH`, or where its installer puts it: an app opened from Finder has a bare `PATH`.
fn bun() -> PathBuf {
    let on_path = std::env::var_os("PATH")
        .into_iter()
        .flat_map(|paths| std::env::split_paths(&paths).collect::<Vec<_>>())
        .map(|dir| dir.join("bun"))
        .find(|path| path.is_file());
    let installed = std::env::var_os("HOME").map(|home| Path::new(&home).join(".bun/bin/bun"));
    on_path.or(installed).unwrap_or_else(|| "bun".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::wire::{RuntimeMsg, vault_op};

    #[cfg(target_os = "macos")]
    #[test]
    fn the_vault_round_trips_a_record_through_the_keychain() {
        let service = format!("com.hazel.native.test-{}", std::process::id());
        assert_eq!(run_vault(&service, &VaultOp::Read), Ok(None));
        let record = r#"{"credentials":{}}"#.to_string();
        assert_eq!(
            run_vault(&service, &VaultOp::Write(record.clone())),
            Ok(None)
        );
        let read = run_vault(&service, &VaultOp::Read);
        let _ = keyring::Entry::new(&service, VAULT_ACCOUNT).and_then(|e| e.delete_credential());
        assert_eq!(read, Ok(Some(record)));
    }

    #[test]
    fn vault_requests_and_answers_cross_the_wire() {
        let read: RuntimeMsg = serde_json::from_str(r#"{"t":"vault","id":1,"op":"read"}"#).unwrap();
        let RuntimeMsg::Vault { id, op, record } = read else {
            panic!("not a vault request")
        };
        assert_eq!((id, vault_op(&op, record)), (1, Some(VaultOp::Read)));
        assert_eq!(
            vault_op("write", Some("{}".into())),
            Some(VaultOp::Write("{}".into()))
        );
        assert_eq!(vault_op("write", None), None);
        assert_eq!(vault_op("delete", None), None);
        assert_eq!(
            vault_reply(2, Ok(None)),
            json!({ "t": "vault", "id": 2, "record": null })
        );
        assert_eq!(
            vault_reply(3, Err("denied".into())),
            json!({ "t": "vault", "id": 3, "error": "denied" })
        );
    }

    #[test]
    fn an_opened_link_goes_to_the_runtime_as_given() {
        let url = "com.hazel.native://auth/callback?state=a&code=b";
        assert_eq!(open_url_message(url), json!({ "t": "openUrl", "url": url }));
        let reload: RuntimeMsg =
            serde_json::from_str(r#"{"t":"reload","path":"/hazel/chat"}"#).unwrap();
        assert!(matches!(reload, RuntimeMsg::Reload { path } if path == "/hazel/chat"));
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
        assert!(source.get_program().to_string_lossy().ends_with("bun"));
        assert_eq!(source.get_args().collect::<Vec<_>>(), ["dist/entry.js"]);
        let _ = std::fs::remove_dir_all(&root);
        assert!(
            runtime_command(Some(&macos), None)
                .get_program()
                .to_string_lossy()
                .ends_with("bun")
        );
    }
}
