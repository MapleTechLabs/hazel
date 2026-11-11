/**
 * The database every Hazel service codes against: effect-orm over SQLite (a Durable Object's
 * storage, D1, or node SQLite in tests).
 *
 * Statements are Effects over the typed tables in `@hazel/db/tables`:
 *
 *     const db = yield* Database.Database
 *     const rows = yield* db.run(SQLite.from(schema.channelsTable).select().where(($) => [$.id.eq(id)]))
 *
 * `db.transaction(effect)` runs every statement in `effect` in one transaction through fiber
 * context, so repositories and helpers need no transaction handle. D1 has no transactions: there
 * `transaction` fails with a `query_error` before running its body.
 */
import * as D1Client from "@effect/sql-d1/D1Client"
import * as Orm from "@maple-dev/effect-orm/database"
import { sql } from "@maple-dev/effect-orm/database"
import {
	CompiledQueryDecodeError,
	d1Dialect,
	QueryBuilderError,
	sqliteDialect,
	type SqliteSchemaTable,
} from "@maple-dev/effect-orm/sqlite"
import { Cause, Context, Effect, Layer, Option, Schema } from "effect"
import * as SqlClient from "effect/sql/SqlClient"
import { SqlError } from "effect/sql/SqlError"
import { extraIndexes } from "../tables/extra-indexes"
import * as schema from "../tables"

const DatabaseErrorType = Schema.Literals([
	"unique_violation",
	"foreign_key_violation",
	"connection_error",
	"query_error",
])

/**
 * A statement or transaction failed. `type` classifies it for callers that branch on it;
 * `constraint` names the violated constraint or unique index, when there is one.
 */
export class DatabaseError extends Schema.TaggedError<DatabaseError>()("DatabaseError", {
	type: DatabaseErrorType,
	message: Schema.String,
	/** SQLite's extended result code name, e.g. `SQLITE_CONSTRAINT_UNIQUE`, when known. */
	sqlState: Schema.optional(Schema.String),
	/**
	 * The violated unique index (`organizations_slug_unique`) when its columns name one, else the
	 * columns SQLite reported (`organizations.slug`).
	 */
	constraint: Schema.optional(Schema.String),
	/** The columns SQLite reported, e.g. `organizations.slug`. */
	detail: Schema.optional(Schema.String),
	cause: Schema.Defect(),
}) {
	public override toString() {
		return `DatabaseError: ${this.message}`
	}
}

/** The next error in a chain: a `SqlError`'s reason, else the `cause`. */
const innerOf = (record: Record<string, unknown>): unknown =>
	typeof record.reason === "object" && record.reason !== null ? record.reason : record.cause

/** Every message in a driver error chain (`SqlError` → reason → the driver's error), outermost first. */
const messagesOf = (cause: unknown): ReadonlyArray<string> => {
	const messages: Array<string> = []
	let current: unknown = cause
	for (let depth = 0; depth < 8 && typeof current === "object" && current !== null; depth++) {
		const record = current as Record<string, unknown>
		if (typeof record.message === "string") messages.push(record.message)
		const next = innerOf(record)
		if (next === undefined || next === current) break
		current = next
	}
	return messages
}

/** SQLite's numeric extended result code, when the driver kept one (`errcode` on node:sqlite). */
const errcodeOf = (cause: unknown): number | undefined => {
	let current: unknown = cause
	for (let depth = 0; depth < 8 && typeof current === "object" && current !== null; depth++) {
		const record = current as Record<string, unknown>
		for (const field of ["errcode", "errno"]) {
			if (typeof record[field] === "number") return record[field] as number
		}
		const next = innerOf(record)
		if (next === undefined || next === current) break
		current = next
	}
	return undefined
}

const SQLITE_CONSTRAINT_FOREIGNKEY = 787
const SQLITE_CONSTRAINT_PRIMARYKEY = 1555
const SQLITE_CONSTRAINT_UNIQUE = 2067

/** `UNIQUE constraint failed: users.email, users.org` → `["users.email", "users.org"]`. */
const UNIQUE_FAILED = /UNIQUE constraint failed: ([^\n:]+?(?:\.[^\n:,]+)?(?:, [^\n:,]+)*)(?::|$|\n)/

type Classified = {
	readonly type: typeof DatabaseErrorType.Type
	readonly sqlState?: string
	readonly columns?: ReadonlyArray<string>
}

const classify = (cause: unknown, reason: string): Classified => {
	const text = messagesOf(cause).join("\n")
	const errcode = errcodeOf(cause)
	const unique = UNIQUE_FAILED.exec(text)
	if (
		reason === "UniqueViolation" ||
		errcode === SQLITE_CONSTRAINT_UNIQUE ||
		errcode === SQLITE_CONSTRAINT_PRIMARYKEY ||
		unique !== null
	) {
		return {
			type: "unique_violation",
			sqlState:
				errcode === SQLITE_CONSTRAINT_PRIMARYKEY || /PRIMARY KEY/.test(text)
					? "SQLITE_CONSTRAINT_PRIMARYKEY"
					: "SQLITE_CONSTRAINT_UNIQUE",
			...(unique === null ? undefined : { columns: unique[1]!.split(",").map((c) => c.trim()) }),
		}
	}
	if (errcode === SQLITE_CONSTRAINT_FOREIGNKEY || /FOREIGN KEY constraint failed/.test(text)) {
		return { type: "foreign_key_violation", sqlState: "SQLITE_CONSTRAINT_FOREIGNKEY" }
	}
	if (reason === "ConnectionError") return { type: "connection_error" }
	return { type: "query_error" }
}

/** Unique indexes by `table(col,col)`, to name the one SQLite reports only by its columns. */
const uniqueIndexNames: ReadonlyMap<string, string> = (() => {
	const names = new Map<string, string>()
	const key = (table: string, columns: ReadonlyArray<string>) =>
		`${table}(${columns
			.map((c) => c.replace(/^"|"$/g, ""))
			.sort()
			.join(",")})`
	for (const table of Object.values(schema)) {
		const ddl = (table as Partial<SqliteSchemaTable<string, any>>).ddl
		if (ddl === undefined) continue
		for (const index of [...ddl.indexes.filter((i) => i.unique), ...ddl.uniques]) {
			names.set(key(index.table, index.columns), index.name)
		}
	}
	for (const index of extraIndexes) if (index.unique) names.set(key(index.table, index.on), index.name)
	return names
})()

const constraintOf = (columns: ReadonlyArray<string>): string => {
	const table = columns[0]?.split(".")[0] ?? ""
	const names = columns.map((column) => column.slice(column.indexOf(".") + 1)).sort()
	return uniqueIndexNames.get(`${table}(${names.join(",")})`) ?? columns.join(", ")
}

/** What a statement can fail with below this module. */
type OrmFailure =
	| SqlError
	| Orm.DatabaseError
	| Orm.TransactionCommitFailed
	| Orm.TransactionRollbackFailed
	| Orm.TransactionOptionsRejected
	| Orm.TransactionUnsupported
	| Orm.TransactionClosed
	| QueryBuilderError
	| CompiledQueryDecodeError

const isOrmFailure = (value: unknown): value is OrmFailure =>
	value instanceof SqlError ||
	value instanceof Orm.DatabaseError ||
	value instanceof Orm.TransactionCommitFailed ||
	value instanceof Orm.TransactionRollbackFailed ||
	value instanceof Orm.TransactionOptionsRejected ||
	value instanceof Orm.TransactionUnsupported ||
	value instanceof Orm.TransactionClosed ||
	value instanceof QueryBuilderError ||
	value instanceof CompiledQueryDecodeError

export const toDatabaseError = (cause: OrmFailure): DatabaseError => {
	const reason =
		cause instanceof Orm.DatabaseError || cause instanceof Orm.TransactionCommitFailed
			? cause.reason
			: cause instanceof SqlError
				? cause.reason._tag
				: "Unknown"
	const classified = classify(cause, reason)
	return new DatabaseError({
		type: classified.type,
		message: cause.message,
		...(classified.sqlState === undefined ? undefined : { sqlState: classified.sqlState }),
		...(classified.columns === undefined
			? undefined
			: { constraint: constraintOf(classified.columns), detail: classified.columns.join(", ") }),
		cause,
	})
}

/**
 * Absorbs effect-orm's and the driver's failures into `DatabaseError`; anything else the effect
 * failed with passes through. A failed COMMIT or ROLLBACK that `@effect/sql` turned into a defect
 * comes back as a `DatabaseError` too.
 */
const absorb = <A, E, R>(
	self: Effect.Effect<A, E, R>,
): Effect.Effect<A, Exclude<E, OrmFailure> | DatabaseError, R> =>
	self.pipe(
		Effect.catchIf(
			(error): error is Extract<E, OrmFailure> => isOrmFailure(error),
			(error) => Effect.fail(toDatabaseError(error)),
		),
		Effect.catchCauseIf(
			(cause) => !Cause.hasInterrupts(cause) && Option.isSome(driverDefect(cause)),
			(cause) => Effect.fail(toDatabaseError(Option.getOrThrow(driverDefect(cause)))),
		),
	) as Effect.Effect<A, Exclude<E, OrmFailure> | DatabaseError, R>

const driverDefect = (cause: Cause.Cause<unknown>): Option.Option<OrmFailure> => {
	for (const reason of cause.reasons) {
		if (
			Cause.isDieReason(reason) &&
			isOrmFailure(reason.defect) &&
			!(reason.defect instanceof Orm.TransactionClosed)
		) {
			return Option.some(reason.defect)
		}
	}
	return Option.none()
}

export interface DatabaseShape {
	/** Compiles a built query or write, runs it, and decodes its rows (a write's RETURNING rows). */
	readonly run: <Q extends Orm.Runnable, const Given extends object = {}>(
		query: Q,
		params?: Given,
	) => Effect.Effect<ReadonlyArray<Orm.RowOf<Q>>, DatabaseError>
	/** `run`, keeping the first row. */
	readonly first: <Q extends Orm.Runnable, const Given extends object = {}>(
		query: Q,
		params?: Given,
	) => Effect.Effect<Option.Option<Orm.RowOf<Q>>, DatabaseError>
	/** Runs a `sql\`...\`` statement and returns its rows, decoded through `schema` when given. */
	readonly query: {
		(statement: Orm.StatementInput): Effect.Effect<ReadonlyArray<Record<string, unknown>>, DatabaseError>
		<A>(
			statement: Orm.StatementInput,
			schema: Orm.RowSchema<A>,
		): Effect.Effect<ReadonlyArray<A>, DatabaseError>
	}
	/** Runs a statement whose rows are not wanted. */
	readonly execute: (statement: Orm.StatementInput) => Effect.Effect<void, DatabaseError>
	/**
	 * Runs `body` in a transaction; a nested call is a savepoint. Any failure, defect or
	 * interruption rolls back, and the body's own errors come out unchanged.
	 */
	readonly transaction: <A, E, R>(
		body: Effect.Effect<A, E, R>,
		options?: Orm.TransactionOptions,
	) => Effect.Effect<A, E | DatabaseError, Exclude<R, Orm.Transaction>>
}

const makeShape = (getOrm: Effect.Effect<Orm.DatabaseApi>): DatabaseShape => {
	const run = (query: Orm.Runnable, params?: object) =>
		Effect.flatMap(getOrm, (orm) => absorb(orm.run(query as never, params as never)))
	return {
		run: run as DatabaseShape["run"],
		first: ((query: Orm.Runnable, params?: object) =>
			Effect.map(run(query, params), (rows) =>
				Option.fromNullishOr(rows[0]),
			)) as DatabaseShape["first"],
		query: ((statement: Orm.StatementInput, schema?: Orm.RowSchema<unknown>) =>
			Effect.flatMap(getOrm, (orm) =>
				absorb(schema === undefined ? orm.query(statement) : orm.query(statement, schema)),
			)) as DatabaseShape["query"],
		execute: (statement) => Effect.flatMap(getOrm, (orm) => absorb(orm.execute(statement))),
		transaction: (body, options) =>
			Effect.flatMap(getOrm, (orm) => absorb(orm.transaction(body, options))).pipe(
				Effect.withSpan("Database.transaction"),
			) as never,
	}
}

export class Database extends Context.Service<Database, DatabaseShape>()("Database") {}

/** effect-orm's database over a SQLite client. */
export const fromSqlClient = (sql: SqlClient.SqlClient): Orm.DatabaseApi =>
	Orm.fromSqlClient(sql, { dialect: sqliteDialect })

/** A database over the provided SQLite `SqlClient` (`@effect/sql-sqlite-do`, `@effect/sql-sqlite-node`). */
export const layerSqlite: Layer.Layer<Database, never, SqlClient.SqlClient> = Layer.effect(
	Database,
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		return makeShape(Effect.succeed(fromSqlClient(sql)))
	}),
)

/**
 * A database over a Worker's D1 binding. D1 limits a statement to 100 bound parameters and has no
 * transactions: `transaction` fails with a `query_error` without running its body, so each write
 * must be one idempotent statement. Provides the D1 `SqlClient` too, for code that writes SQL itself.
 */
export const layerD1 = (
	db: D1Client.D1ClientConfig["db"],
): Layer.Layer<Database | D1Client.D1Client | SqlClient.SqlClient> =>
	Layer.effect(
		Database,
		Effect.gen(function* () {
			const sql = yield* SqlClient.SqlClient
			return makeShape(Effect.succeed(Orm.fromSqlClient(sql, { dialect: d1Dialect })))
		}),
	).pipe(Layer.provideMerge(D1Client.layer({ db })), Layer.orDie)

/** Marks an effect as correct only inside a transaction (see effect-orm's `requireTransaction`). */
export const requireTransaction = Orm.requireTransaction

/** The open transaction; `transaction` provides it, `requireTransaction` requires it. */
export const Transaction = Orm.Transaction

export { sql }
