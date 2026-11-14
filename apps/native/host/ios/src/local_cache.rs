//! The local cache's databases: the web app's synced rows, kept in SQLite between launches. The
//! runtime's worker has no SQLite of its own, so each statement crosses the bridge as one request
//! and one reply, both JSON text (`src/local-cache-ios.ts` is the other side). The engine is plain
//! data in, data out, so it is tested on the host (`cargo test -p hazel-ios`).
//!
//! It answers as wa-sqlite's OPFS worker does for the web app: every statement of the text runs,
//! parameters bind to the first, and rows come back keyed by column name.
use std::path::{Path, PathBuf};

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as BASE64;
use rusqlite::fallible_iterator::FallibleIterator;
use rusqlite::types::{Value as SqlValue, ValueRef};
use rusqlite::{Batch, Connection, ErrorCode};
use serde_json::Value;

/// A file's side files: the write-ahead log and its index, and a rollback journal.
const SIDE_FILES: [&str; 4] = ["", "-wal", "-shm", "-journal"];
/// The largest integer a JavaScript number holds exactly.
const MAX_SAFE_INTEGER: u64 = (1 << 53) - 1;

struct Open {
    handle: u64,
    name: String,
    connection: Connection,
}

/// The open databases, one connection per name, in `dir` (or in memory, as a request asks).
pub struct Engine {
    dir: Option<PathBuf>,
    open: Vec<Open>,
    next: u64,
}

impl Engine {
    /// Databases go in `dir`; without one, only in memory.
    pub fn new(dir: Option<PathBuf>) -> Self {
        Self {
            dir,
            open: Vec::new(),
            next: 0,
        }
    }

    /// Closes every database: the runtime that opened them is gone, and with it whatever
    /// transaction it had not finished.
    pub fn reset(&mut self) {
        self.open.clear();
    }

    /// Answers one request with its id and its reply's text; `None` for text that names no id.
    pub fn answer(&mut self, request: &str) -> Option<(u64, String)> {
        let request: Value = serde_json::from_str(request).ok()?;
        let id = request["id"].as_u64()?;
        let reply = self.run(&request).unwrap_or_else(|error| {
            let mut reply = String::from(r#"{"error":"#);
            push_text(&mut reply, &error);
            reply.push('}');
            reply
        });
        Some((id, reply))
    }

    fn run(&mut self, request: &Value) -> Result<String, String> {
        let memory = request["memory"].as_bool().unwrap_or(false);
        if let Some(name) = request["open"].as_str() {
            let name = file_name(name)?;
            // One connection per file: an earlier one's unfinished transaction ends here.
            self.open.retain(|open| open.name != name);
            let connection = match (memory, &self.dir) {
                (true, _) => Connection::open_in_memory().map_err(describe)?,
                (false, Some(dir)) => open_file(dir, name)?,
                (false, None) => return Err("the app has no folder for its data".into()),
            };
            self.next += 1;
            self.open.push(Open {
                handle: self.next,
                name: name.to_string(),
                connection,
            });
            Ok(format!(r#"{{"db":{}}}"#, self.next))
        } else if let Some(name) = request["remove"].as_str() {
            let name = file_name(name)?;
            self.open.retain(|open| open.name != name);
            if let (false, Some(dir)) = (memory, &self.dir) {
                remove_files(dir, name)?;
            }
            Ok("{}".into())
        } else if let Some(handle) = request["close"].as_u64() {
            self.open.retain(|open| open.handle != handle);
            Ok("{}".into())
        } else if let (Some(handle), Some(sql)) = (request["db"].as_u64(), request["sql"].as_str())
        {
            let open = self.open.iter().find(|open| open.handle == handle);
            let open = open.ok_or("the database is closed")?;
            let params = request["params"].as_array().map_or(&[][..], Vec::as_slice);
            execute(&open.connection, sql, params)
        } else {
            Err("not a local cache request".into())
        }
    }
}

/// `name` as a file's name in the cache's folder: letters, digits, `.`, `_` and `-`, ending
/// `.sqlite`. The name comes from the web app, so it must not reach another folder or another of
/// the app's files (`databaseFileName` in `src/local-cache.ts` is the same rule).
fn file_name(name: &str) -> Result<&str, String> {
    let stem = name.strip_suffix(".sqlite").unwrap_or("");
    let plain = |c: char| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-');
    let valid = stem.starts_with(|c: char| c.is_ascii_alphanumeric())
        && stem.len() <= 121
        && stem.chars().all(plain);
    if valid {
        Ok(name)
    } else {
        Err(format!("{name:?} is no local cache database name"))
    }
}

fn describe(error: rusqlite::Error) -> String {
    error.to_string()
}

fn remove_files(dir: &Path, name: &str) -> Result<(), String> {
    for suffix in SIDE_FILES {
        match std::fs::remove_file(dir.join(format!("{name}{suffix}"))) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("{name}{suffix} was not removed: {error}")),
        }
    }
    Ok(())
}

/// Opens `name` in `dir`, creating both. A file that is no database, or a damaged one, starts
/// over: a cache's rows are all on the server.
fn open_file(dir: &Path, name: &str) -> Result<Connection, String> {
    std::fs::create_dir_all(dir).map_err(|error| format!("no folder for the cache: {error}"))?;
    let path = dir.join(name);
    let open = || {
        let connection = Connection::open(&path)?;
        // A write-ahead log: a crash mid-write leaves the last commit, never half a page.
        // Reading the schema is what finds a file that is no database.
        connection.execute_batch(
            "PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; SELECT count(*) FROM sqlite_schema",
        )?;
        Ok(connection)
    };
    match open() {
        Err(rusqlite::Error::SqliteFailure(failure, _))
            if matches!(
                failure.code,
                ErrorCode::NotADatabase | ErrorCode::DatabaseCorrupt
            ) =>
        {
            remove_files(dir, name)?;
            open().map_err(describe)
        }
        result => result.map_err(describe),
    }
}

/// Runs every statement of `sql`, `params` bound to the first, and answers
/// `{"sets":[{"c":[column…],"r":[[value…]…]}…]}`: one set per statement that gave rows.
fn execute(connection: &Connection, sql: &str, params: &[Value]) -> Result<String, String> {
    let mut reply = String::from(r#"{"sets":["#);
    let mut batch = Batch::new(connection, sql);
    let mut statements = 0;
    let mut sets = 0;
    while let Some(mut statement) = batch.next().map_err(describe)? {
        statements += 1;
        if !params.is_empty() {
            if statements > 1 {
                return Err("Parameters bind to a single SQL statement only".into());
            }
            for (index, param) in params.iter().enumerate() {
                statement
                    .raw_bind_parameter(index + 1, bindable(param)?)
                    .map_err(describe)?;
            }
        }
        let columns: Vec<String> = statement.column_names().map(str::to_string).collect();
        let mut rows = statement.raw_query();
        let mut count = 0;
        while let Some(row) = rows.next().map_err(describe)? {
            if count == 0 {
                if sets > 0 {
                    reply.push(',');
                }
                sets += 1;
                reply.push_str(r#"{"c":["#);
                for (index, column) in columns.iter().enumerate() {
                    if index > 0 {
                        reply.push(',');
                    }
                    push_text(&mut reply, column);
                }
                reply.push_str(r#"],"r":["#);
            } else {
                reply.push(',');
            }
            count += 1;
            reply.push('[');
            for index in 0..columns.len() {
                if index > 0 {
                    reply.push(',');
                }
                push_value(&mut reply, row.get_ref(index).map_err(describe)?);
            }
            reply.push(']');
        }
        if count > 0 {
            reply.push_str("]}");
        }
    }
    reply.push_str("]}");
    Ok(reply)
}

/// A parameter off the wire: JSON's own values, `{"i":"…"}` for an integer past 2^53 and
/// `{"b":"…"}` for a blob in base64.
fn bindable(param: &Value) -> Result<SqlValue, String> {
    Ok(match param {
        Value::Null => SqlValue::Null,
        Value::Bool(flag) => SqlValue::Integer(i64::from(*flag)),
        Value::String(text) => SqlValue::Text(text.clone()),
        Value::Number(number) => match number.as_i64() {
            Some(integer) => SqlValue::Integer(integer),
            None => SqlValue::Real(number.as_f64().ok_or("a number SQLite cannot hold")?),
        },
        Value::Object(tagged) => {
            if let Some(integer) = tagged.get("i").and_then(Value::as_str) {
                SqlValue::Integer(integer.parse().map_err(|_| "not a 64-bit integer")?)
            } else if let Some(blob) = tagged.get("b").and_then(Value::as_str) {
                SqlValue::Blob(BASE64.decode(blob).map_err(|_| "not base64")?)
            } else {
                return Err("Unsupported parameter type for a SQLite binding".into());
            }
        }
        Value::Array(_) => return Err("Unsupported parameter type for a SQLite binding".into()),
    })
}

/// A result's value on the wire: JSON's own where JavaScript reads it back exactly, else an
/// object (`i`: an integer past 2^53, `b`: a blob in base64, `f`: an infinity).
fn push_value(out: &mut String, value: ValueRef<'_>) {
    match value {
        ValueRef::Null => out.push_str("null"),
        ValueRef::Integer(integer) if integer.unsigned_abs() <= MAX_SAFE_INTEGER => {
            out.push_str(&integer.to_string());
        }
        ValueRef::Integer(integer) => out.push_str(&format!(r#"{{"i":"{integer}"}}"#)),
        ValueRef::Real(real) if real.is_finite() => {
            out.push_str(
                &serde_json::Number::from_f64(real).map_or("null".into(), |n| n.to_string()),
            );
        }
        ValueRef::Real(real) if real.is_nan() => out.push_str("null"),
        ValueRef::Real(real) => {
            let sign = if real > 0.0 { "" } else { "-" };
            out.push_str(&format!(r#"{{"f":"{sign}Infinity"}}"#));
        }
        ValueRef::Text(text) => push_text(out, &String::from_utf8_lossy(text)),
        ValueRef::Blob(blob) => {
            out.push_str(r#"{"b":""#);
            BASE64.encode_string(blob, out);
            out.push_str(r#""}"#);
        }
    }
}

/// Appends `text` as a JSON string.
fn push_text(out: &mut String, text: &str) {
    // SAFETY: serde_json writes a string as valid UTF-8.
    let bytes = unsafe { out.as_mut_vec() };
    serde_json::to_writer(bytes, text).expect("a string serializes");
}

#[cfg(target_os = "ios")]
pub use device::{reset, send};

/// The engine on a thread of its own, so a statement never holds up a frame.
#[cfg(target_os = "ios")]
mod device {
    use std::sync::OnceLock;
    use std::sync::mpsc::{Sender, channel};

    use dispatch2::DispatchQueue;

    use super::Engine;
    use crate::bridge;

    enum Job {
        /// A request's text, and the page whose worker asked.
        Request(String, u64),
        Reset,
    }

    fn jobs() -> &'static Sender<Job> {
        static JOBS: OnceLock<Sender<Job>> = OnceLock::new();
        JOBS.get_or_init(|| {
            let (sender, receiver) = channel::<Job>();
            std::thread::spawn(move || {
                let mut engine = Engine::new(crate::storage::data_dir());
                for job in receiver {
                    match job {
                        Job::Reset => engine.reset(),
                        Job::Request(text, page) => {
                            if let Some((id, reply)) = engine.answer(&text) {
                                DispatchQueue::main()
                                    .exec_async(move || bridge::reply_cache(page, id, &reply));
                            }
                        }
                    }
                }
            });
            sender
        })
    }

    /// Runs request `text` (`CacheRequest` in `src/local-cache-ios.ts`, with its `id`) from
    /// `page`'s worker; the reply goes back to that page.
    pub fn send(text: String, page: u64) {
        let _ = jobs().send(Job::Request(text, page));
    }

    /// The page, and the runtime in it, was replaced: its databases close.
    pub fn reset() {
        let _ = jobs().send(Job::Reset);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// A folder of this test's own, removed when it ends.
    struct TempDir(PathBuf);

    impl TempDir {
        fn new(test: &str) -> Self {
            let dir =
                std::env::temp_dir().join(format!("hazel-cache-{test}-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&dir);
            Self(dir)
        }

        fn files(&self) -> Vec<String> {
            let mut names: Vec<String> = std::fs::read_dir(&self.0)
                .map(|entries| {
                    entries
                        .filter_map(|entry| entry.ok()?.file_name().into_string().ok())
                        .collect()
                })
                .unwrap_or_default();
            names.sort();
            names
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    const NAME: &str = "hazel-cache-usr_1.sqlite";

    fn ask(engine: &mut Engine, request: Value) -> Value {
        let (id, reply) = engine.answer(&request.to_string()).expect("an answer");
        assert_eq!(Some(id), request["id"].as_u64());
        serde_json::from_str(&reply).expect("a JSON reply")
    }

    fn open(engine: &mut Engine, memory: bool) -> u64 {
        let reply = ask(engine, json!({ "id": 1, "open": NAME, "memory": memory }));
        reply["db"].as_u64().unwrap_or_else(|| panic!("{reply}"))
    }

    fn sql(engine: &mut Engine, db: u64, sql: &str, params: Value) -> Value {
        ask(
            engine,
            json!({ "id": 2, "db": db, "sql": sql, "params": params }),
        )
    }

    /// The shared wire fixture: each step's request gets exactly its reply, here and in
    /// `src/local-cache-ios.test.ts`, which holds the JavaScript side of the same steps.
    #[test]
    fn the_wire_fixture_holds() {
        let fixture: Value =
            serde_json::from_str(include_str!("../../../src/local-cache-wire.fixture.json"))
                .unwrap();
        let mut engine = Engine::new(None);
        for step in fixture.as_array().expect("steps") {
            let (_, reply) = engine
                .answer(&step["request"].to_string())
                .expect("an answer");
            let reply: Value = serde_json::from_str(&reply).expect("a JSON reply");
            assert_eq!(reply, step["reply"], "{}", step["request"]);
        }
    }

    #[test]
    fn a_script_runs_every_statement_and_a_trigger_as_one() {
        let mut engine = Engine::new(None);
        let db = open(&mut engine, true);
        let script = "
            CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT); -- with a ; in a comment
            CREATE TABLE log (line TEXT);
            CREATE TRIGGER notes_log AFTER INSERT ON notes
            BEGIN
                INSERT INTO log (line) VALUES ('added; ' || NEW.body);
            END;
            INSERT INTO notes (body) VALUES ('a;b');
        ";
        assert_eq!(
            sql(&mut engine, db, script, json!([])),
            json!({ "sets": [] })
        );
        assert_eq!(
            sql(&mut engine, db, "SELECT line FROM log", json!([])),
            json!({ "sets": [{ "c": ["line"], "r": [["added; a;b"]] }] })
        );
        // Rows of every statement come back, each set under its own columns.
        assert_eq!(
            sql(&mut engine, db, "SELECT 1 AS a; SELECT 2 AS b", json!([])),
            json!({ "sets": [{ "c": ["a"], "r": [[1]] }, { "c": ["b"], "r": [[2]] }] })
        );
        let reply = sql(&mut engine, db, "SELECT ? AS a; SELECT ? AS b", json!([1]));
        assert_eq!(
            reply["error"],
            "Parameters bind to a single SQL statement only"
        );
        let reply = sql(&mut engine, db, "SELECT * FROM missing", json!([]));
        assert!(
            reply["error"].as_str().unwrap().contains("no such table"),
            "{reply}"
        );
    }

    #[test]
    fn a_transaction_and_a_savepoint_roll_back() {
        let mut engine = Engine::new(None);
        let db = open(&mut engine, true);
        let mut run = |text: &str| {
            let reply = sql(&mut engine, db, text, json!([]));
            assert!(reply.get("error").is_none(), "{text}: {reply}");
            reply
        };
        run("CREATE TABLE items (id INTEGER PRIMARY KEY)");
        run("BEGIN IMMEDIATE");
        run("INSERT INTO items (id) VALUES (1)");
        run("ROLLBACK");
        assert_eq!(run("SELECT id FROM items"), json!({ "sets": [] }));
        run("BEGIN IMMEDIATE");
        run("INSERT INTO items (id) VALUES (2)");
        run("SAVEPOINT tsdb_sp_1");
        run("INSERT INTO items (id) VALUES (3)");
        run("ROLLBACK TO SAVEPOINT tsdb_sp_1");
        run("RELEASE SAVEPOINT tsdb_sp_1");
        run("COMMIT");
        assert_eq!(
            run("SELECT id FROM items"),
            json!({ "sets": [{ "c": ["id"], "r": [[2]] }] })
        );
    }

    #[test]
    fn a_database_is_kept_between_opens_and_removed_with_its_side_files() {
        let dir = TempDir::new("kept");
        let mut engine = Engine::new(Some(dir.0.clone()));
        let first = open(&mut engine, false);
        sql(
            &mut engine,
            first,
            "CREATE TABLE items (id INTEGER PRIMARY KEY)",
            json!([]),
        );
        sql(
            &mut engine,
            first,
            "BEGIN IMMEDIATE; INSERT INTO items (id) VALUES (1)",
            json!([]),
        );
        assert_eq!(
            dir.files(),
            [
                NAME.to_string(),
                format!("{NAME}-shm"),
                format!("{NAME}-wal")
            ]
        );

        // A second open of the name takes the file over: the first connection closes, and the
        // transaction it left open is gone.
        let second = open(&mut engine, false);
        assert_ne!(first, second);
        assert_eq!(
            sql(&mut engine, first, "SELECT 1", json!([]))["error"],
            "the database is closed"
        );
        assert_eq!(
            sql(&mut engine, second, "SELECT id FROM items", json!([])),
            json!({ "sets": [] })
        );
        sql(
            &mut engine,
            second,
            "INSERT INTO items (id) VALUES (2)",
            json!([]),
        );

        // A runtime that was replaced leaves nothing open; what it committed is on disk.
        engine.reset();
        assert_eq!(
            sql(&mut engine, second, "SELECT 1", json!([]))["error"],
            "the database is closed"
        );
        let third = open(&mut engine, false);
        assert_eq!(
            sql(&mut engine, third, "SELECT id FROM items", json!([])),
            json!({ "sets": [{ "c": ["id"], "r": [[2]] }] })
        );

        assert_eq!(
            ask(&mut engine, json!({ "id": 3, "remove": NAME })),
            json!({})
        );
        assert_eq!(dir.files(), Vec::<String>::new());
        let fourth = open(&mut engine, false);
        assert_eq!(
            sql(
                &mut engine,
                fourth,
                "SELECT name FROM sqlite_schema",
                json!([])
            ),
            json!({ "sets": [] })
        );
        assert_eq!(
            ask(&mut engine, json!({ "id": 4, "close": fourth })),
            json!({})
        );
    }

    #[test]
    fn a_file_that_is_no_database_starts_over() {
        let dir = TempDir::new("unreadable");
        std::fs::create_dir_all(&dir.0).unwrap();
        std::fs::write(dir.0.join(NAME), "not a database ".repeat(100)).unwrap();
        let mut engine = Engine::new(Some(dir.0.clone()));
        let db = open(&mut engine, false);
        assert_eq!(
            sql(&mut engine, db, "SELECT name FROM sqlite_schema", json!([])),
            json!({ "sets": [] })
        );
    }

    #[test]
    fn a_memory_database_touches_no_file() {
        let dir = TempDir::new("memory");
        let mut engine = Engine::new(Some(dir.0.clone()));
        let db = open(&mut engine, true);
        sql(
            &mut engine,
            db,
            "CREATE TABLE items (id INTEGER PRIMARY KEY)",
            json!([]),
        );
        assert_eq!(dir.files(), Vec::<String>::new());
        // Opened again, it is a new one.
        let again = open(&mut engine, true);
        assert_eq!(
            sql(
                &mut engine,
                again,
                "SELECT name FROM sqlite_schema",
                json!([])
            ),
            json!({ "sets": [] })
        );
        assert_eq!(
            ask(
                &mut engine,
                json!({ "id": 3, "remove": NAME, "memory": true })
            ),
            json!({})
        );
    }

    #[test]
    fn only_names_that_stay_in_the_folder_open() {
        let dir = TempDir::new("names");
        let mut engine = Engine::new(Some(dir.0.clone()));
        let long = format!("{}.sqlite", "a".repeat(200));
        for name in [
            "../escape.sqlite",
            "a/b.sqlite",
            "a\\b.sqlite",
            "local-storage.json",
            ".sqlite",
            "",
            "x.sqlite-wal",
            "a b.sqlite",
            long.as_str(),
        ] {
            for verb in ["open", "remove"] {
                let reply = ask(&mut engine, json!({ "id": 1, verb: name }));
                let error = reply["error"]
                    .as_str()
                    .unwrap_or_else(|| panic!("{name}: {reply}"));
                assert!(
                    error.ends_with("is no local cache database name"),
                    "{error}"
                );
            }
        }
        assert_eq!(dir.files(), Vec::<String>::new());
        assert!(file_name("hazel-cache-0b9f4a1e-77aa-4c1d-9a51-2f6f1c0e9d11.sqlite").is_ok());
    }

    #[test]
    fn a_request_without_an_id_gets_no_answer() {
        let mut engine = Engine::new(None);
        assert_eq!(engine.answer("not json"), None);
        assert_eq!(engine.answer(r#"{"open":"a.sqlite"}"#), None);
        let reply = ask(&mut engine, json!({ "id": 9, "what": true }));
        assert_eq!(reply["error"], "not a local cache request");
        // Without a folder, a database opens in memory only.
        let reply = ask(&mut engine, json!({ "id": 9, "open": NAME }));
        assert_eq!(reply["error"], "the app has no folder for its data");
    }
}
