//! What the app keeps on the device between launches, in its container's
//! `Library/Application Support`: the web app's `localStorage` here (`local-storage.json`, as the
//! macOS app keeps it), and the local cache's databases beside it (`local_cache.rs`).
use std::path::{Path, PathBuf};

use serde_json::Value;

const FILE: &str = "local-storage.json";

/// The folder for the app's own data.
#[cfg(target_os = "ios")]
pub fn data_dir() -> Option<PathBuf> {
    use objc2_foundation::{
        NSSearchPathDirectory, NSSearchPathDomainMask, NSSearchPathForDirectoriesInDomains,
    };
    let found = NSSearchPathForDirectoriesInDomains(
        NSSearchPathDirectory::ApplicationSupportDirectory,
        NSSearchPathDomainMask::UserDomainMask,
        true,
    );
    Some(PathBuf::from(found.firstObject()?.to_string()))
}

/// Whether `text` is `localStorage`'s entries as the runtime saves them: one JSON object of strings.
fn is_entries(text: &str) -> bool {
    serde_json::from_str::<Value>(text)
        .ok()
        .and_then(|value| Some(value.as_object()?.values().all(Value::is_string)))
        .unwrap_or(false)
}

/// The entries saved in `dir`. No file yet, or one that is not entries: none, and the app starts
/// with empty storage, as a browser with cleared storage does.
pub fn load(dir: &Path) -> Option<String> {
    let text = std::fs::read_to_string(dir.join(FILE)).ok()?;
    is_entries(&text).then_some(text)
}

/// Saves `text` as the entries in `dir`, replacing what was saved.
pub fn save(dir: &Path, text: &str) -> Result<(), String> {
    if !is_entries(text) {
        return Err("not localStorage's entries".into());
    }
    let write = || {
        std::fs::create_dir_all(dir)?;
        // Written beside it and renamed over it, so a crash mid-write never leaves half a file.
        let next = dir.join(format!("{FILE}.next"));
        std::fs::write(&next, text)?;
        std::fs::rename(next, dir.join(FILE))
    };
    write().map_err(|error: std::io::Error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(test: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("hazel-storage-{test}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn entries_are_saved_and_loaded_whole() {
        // The folder does not exist before the first save.
        let dir = temp_dir("saved").join("Application Support");
        assert_eq!(load(&dir), None);
        let entries = r#"{"hazel:theme":"{\"mode\":\"dark\"}","empty":""}"#;
        save(&dir, entries).unwrap();
        assert_eq!(load(&dir).as_deref(), Some(entries));
        save(&dir, "{}").unwrap();
        assert_eq!(load(&dir).as_deref(), Some("{}"));
        // Nothing is left beside the file.
        let names: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert_eq!(names, [FILE]);
        std::fs::remove_dir_all(dir.parent().unwrap()).unwrap();
    }

    #[test]
    fn what_is_not_entries_is_neither_saved_nor_loaded() {
        let dir = temp_dir("refused");
        save(&dir, r#"{"kept":"yes"}"#).unwrap();
        for text in ["", "null", "[]", r#"{"a":1}"#, r#"{"a":"b""#, r#""text""#] {
            assert!(save(&dir, text).is_err(), "{text}");
        }
        assert_eq!(load(&dir).as_deref(), Some(r#"{"kept":"yes"}"#));
        // A file cut short, or another's, reads as no entries.
        for text in [r#"{"a":"b""#, r#"{"a":1}"#, "\u{0}\u{1}"] {
            std::fs::write(dir.join(FILE), text).unwrap();
            assert_eq!(load(&dir), None, "{text}");
        }
        std::fs::remove_dir_all(dir).unwrap();
    }
}
