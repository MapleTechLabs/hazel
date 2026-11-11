//! What sign-in needs from a shell: the vault's record in the keychain (macOS and iOS alike) and
//! the callback link the system opens the app with (`com.hazel.native://auth/callback?...`).
use serde_json::{Value, json};

use crate::outbox::write_line;

/// The keychain item holding the vault's one JSON record (`@hazel/auth/desktop`'s `RecordStore`).
pub const VAULT_SERVICE: &str = "com.hazel.native";
pub const VAULT_ACCOUNT: &str = "auth";

/// A vault request from the runtime: read the record, or replace it.
#[derive(Debug, PartialEq, Eq)]
pub enum VaultOp {
    Read,
    Write(String),
}

/// A `vault` request's operation; `None` for an unknown one or a write without a record.
pub fn vault_op(op: &str, record: Option<String>) -> Option<VaultOp> {
    match (op, record) {
        ("read", _) => Some(VaultOp::Read),
        ("write", Some(record)) => Some(VaultOp::Write(record)),
        _ => None,
    }
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

/// Answers vault request `id`. Keychain calls can wait on a permission prompt, so each runs off
/// the calling (reader or UI) thread.
pub fn answer_vault(id: u64, op: &str, record: Option<String>) {
    let Some(op) = vault_op(op, record) else {
        write_line(vault_reply(id, Err(format!("unknown vault request {op}"))));
        return;
    };
    std::thread::spawn(move || write_line(vault_reply(id, run_vault(VAULT_SERVICE, &op))));
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::wire::RuntimeMsg;

    #[cfg(target_vendor = "apple")]
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
}
