import Foundation
import JavaScriptCore
import SQLite3

/// The local cache's SQLite (`packages/client-data/src/platform/jsc/local-cache.ts`): files in
/// Application Support/HazelCache, one connection per `open`, each on its own serial queue. Rows
/// go back as JSON (column name to value; BLOBs as base64), parameters come in as JS values.
final class NativeSQLite: @unchecked Sendable {
    private final class Connection: @unchecked Sendable {
        let name: String
        let queue: DispatchQueue
        var db: OpaquePointer?

        init(name: String, db: OpaquePointer?) {
            self.name = name
            self.db = db
            queue = DispatchQueue(label: "sh.hazel.sqlite.\(name)")
        }
    }

    private let pump: JSCallbackPump
    private let lock = NSLock()
    private var connections: [Int: Connection] = [:]
    private var nextId = 1
    /// Opens and removals, in order: a removal waits for the opens before it.
    private let files = DispatchQueue(label: "sh.hazel.sqlite.files")

    init(pump: JSCallbackPump) { self.pump = pump }

    static let directory: URL = {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("HazelCache", isDirectory: true)
    }()

    func object(in context: JSContext) -> JSValue {
        let open: @convention(block) (String, JSValue) -> Void = { [weak self] name, done in
            guard let self else { return }
            self.open(name, JSCallback(done, pump: self.pump))
        }
        let execute: @convention(block) (Int, String, JSValue, JSValue) -> Void = { [weak self] handle, sql, params, done in
            guard let self else { return }
            self.execute(handle, sql, Self.values(params), JSCallback(done, pump: self.pump))
        }
        let close: @convention(block) (Int, JSValue) -> Void = { [weak self] handle, done in
            guard let self else { return }
            self.close(handle, JSCallback(done, pump: self.pump))
        }
        let remove: @convention(block) (String, JSValue) -> Void = { [weak self] name, done in
            guard let self else { return }
            self.remove(name, JSCallback(done, pump: self.pump))
        }
        let object = JSValue(newObjectIn: context)!
        object.setObject(open, forKeyedSubscript: "open" as NSString)
        object.setObject(execute, forKeyedSubscript: "execute" as NSString)
        object.setObject(close, forKeyedSubscript: "close" as NSString)
        object.setObject(remove, forKeyedSubscript: "remove" as NSString)
        return object
    }

    /// A parameter, read on the JS thread.
    private enum Value: @unchecked Sendable {
        case null, integer(Int64), real(Double), text(String), blob(Data)
    }

    private static func values(_ params: JSValue) -> [Value] {
        let count = Int(params.forProperty("length")?.toInt32() ?? 0)
        return (0 ..< count).map { index in
            let value = params.atIndex(index)!
            if value.isNull || value.isUndefined { return .null }
            if value.isBoolean { return .integer(value.toBool() ? 1 : 0) }
            if value.isNumber {
                let number = value.toDouble()
                return number.rounded() == number && abs(number) < 9_007_199_254_740_992 ? .integer(Int64(number)) : .real(number)
            }
            if value.isString { return .text(value.toString()) }
            if let bytes = JSBytes.data(value) { return .blob(bytes) }
            return .text(value.toString())
        }
    }

    /// A safe file name: no directories, no parent references.
    private static func path(of name: String) -> URL? {
        guard !name.isEmpty, !name.contains("/"), !name.contains(".."), !name.hasPrefix(".") else { return nil }
        return directory.appendingPathComponent(name)
    }

    private func open(_ name: String, _ done: JSCallback) {
        files.async { [self] in
            guard let path = Self.path(of: name) else { return done.call([NSNull(), "Bad file name \(name)"]) }
            do {
                try FileManager.default.createDirectory(
                    at: Self.directory, withIntermediateDirectories: true,
                    attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]
                )
            } catch {
                return done.call([NSNull(), "Could not create the cache directory: \(error.localizedDescription)"])
            }
            var db: OpaquePointer?
            let flags = SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE | SQLITE_OPEN_NOMUTEX
            guard sqlite3_open_v2(path.path, &db, flags, nil) == SQLITE_OK else {
                let message = db.map { String(cString: sqlite3_errmsg($0)) } ?? "open failed"
                sqlite3_close_v2(db)
                return done.call([NSNull(), message])
            }
            sqlite3_busy_timeout(db, 5000)
            sqlite3_exec(db, "PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL", nil, nil, nil)
            let connection = Connection(name: name, db: db)
            lock.lock()
            let handle = nextId
            nextId += 1
            connections[handle] = connection
            lock.unlock()
            done.call([handle, NSNull()])
        }
    }

    private func connection(_ handle: Int) -> Connection? {
        lock.lock()
        defer { lock.unlock() }
        return connections[handle]
    }

    private func execute(_ handle: Int, _ sql: String, _ params: [Value], _ done: JSCallback) {
        guard let connection = connection(handle) else { return done.call([NSNull(), "The database is closed"]) }
        connection.queue.async {
            guard let db = connection.db else { return done.call([NSNull(), "The database is closed"]) }
            do {
                let rows = try Self.run(db, sql, params)
                let json = try JSONSerialization.data(withJSONObject: rows)
                done.call([String(decoding: json, as: UTF8.self), NSNull()])
            } catch {
                done.call([NSNull(), "\(error)"])
            }
        }
    }

    private struct SQLiteError: Error, CustomStringConvertible {
        let description: String
    }

    private static let transient = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

    /// Every statement in `sql` in turn, parameters bound in order; the rows of all of them.
    private static func run(_ db: OpaquePointer, _ sql: String, _ params: [Value]) throws -> [[String: Any]] {
        var rows: [[String: Any]] = []
        var nextParam = 0
        try sql.withCString { start in
            var tail: UnsafePointer<CChar>? = start
            while let current = tail, current.pointee != 0 {
                var statement: OpaquePointer?
                guard sqlite3_prepare_v2(db, current, -1, &statement, &tail) == SQLITE_OK else {
                    throw SQLiteError(description: String(cString: sqlite3_errmsg(db)))
                }
                // Whitespace or a comment at the end.
                guard let statement else { continue }
                defer { sqlite3_finalize(statement) }
                let count = Int(sqlite3_bind_parameter_count(statement))
                for index in 0 ..< count {
                    let value = nextParam < params.count ? params[nextParam] : .null
                    nextParam += 1
                    bind(statement, Int32(index + 1), value)
                }
                while true {
                    let step = sqlite3_step(statement)
                    if step == SQLITE_DONE { break }
                    guard step == SQLITE_ROW else { throw SQLiteError(description: String(cString: sqlite3_errmsg(db))) }
                    rows.append(row(statement))
                }
            }
        }
        return rows
    }

    private static func bind(_ statement: OpaquePointer, _ index: Int32, _ value: Value) {
        switch value {
        case .null: sqlite3_bind_null(statement, index)
        case let .integer(number): sqlite3_bind_int64(statement, index, number)
        case let .real(number): sqlite3_bind_double(statement, index, number)
        case let .text(text): sqlite3_bind_text(statement, index, text, -1, transient)
        case let .blob(data):
            data.withUnsafeBytes { bytes in
                _ = sqlite3_bind_blob(statement, index, bytes.baseAddress, Int32(data.count), transient)
            }
        }
    }

    private static func row(_ statement: OpaquePointer) -> [String: Any] {
        var row: [String: Any] = [:]
        for column in 0 ..< sqlite3_column_count(statement) {
            let name = String(cString: sqlite3_column_name(statement, column))
            switch sqlite3_column_type(statement, column) {
            case SQLITE_INTEGER: row[name] = sqlite3_column_int64(statement, column)
            case SQLITE_FLOAT: row[name] = sqlite3_column_double(statement, column)
            case SQLITE_TEXT: row[name] = String(cString: sqlite3_column_text(statement, column))
            case SQLITE_BLOB:
                let count = Int(sqlite3_column_bytes(statement, column))
                let data = count == 0 ? Data() : Data(bytes: sqlite3_column_blob(statement, column), count: count)
                row[name] = data.base64EncodedString()
            default: row[name] = NSNull()
            }
        }
        return row
    }

    private func close(_ handle: Int, _ done: JSCallback) {
        lock.lock()
        let connection = connections.removeValue(forKey: handle)
        lock.unlock()
        guard let connection else { return done.call([]) }
        connection.queue.async {
            sqlite3_close_v2(connection.db)
            connection.db = nil
            done.call([])
        }
    }

    /// Closes any connection still open on `name`, then deletes the file and its side files.
    private func remove(_ name: String, _ done: JSCallback) {
        lock.lock()
        let open = connections.filter { $0.value.name == name }
        for handle in open.keys { connections[handle] = nil }
        lock.unlock()
        files.async {
            for connection in open.values {
                connection.queue.sync {
                    sqlite3_close_v2(connection.db)
                    connection.db = nil
                }
            }
            guard let path = Self.path(of: name) else { return done.call(["Bad file name \(name)"]) }
            for suffix in ["", "-wal", "-shm", "-journal"] {
                try? FileManager.default.removeItem(at: URL(fileURLWithPath: path.path + suffix))
            }
            done.call([NSNull()])
        }
    }
}
