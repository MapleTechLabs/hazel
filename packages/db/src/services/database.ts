import type { ExtractTablesWithRelations } from "drizzle-orm"
import type { PgTransaction } from "drizzle-orm/pg-core"
import { drizzle, type PostgresJsDatabase, type PostgresJsQueryResultHKT } from "drizzle-orm/postgres-js"
import { Schema, Context } from "effect"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import * as Schedule from "effect/Schedule"
import postgres from "postgres"
import * as schema from "../schema"

export type TransactionClient = PgTransaction<
	PostgresJsQueryResultHKT,
	typeof schema,
	ExtractTablesWithRelations<typeof schema>
>

export type Client = PostgresJsDatabase<typeof schema> & {
	$client: postgres.Sql
}

export type TxFn = <T>(
	fn: (client: TransactionClient) => Promise<T>,
) => Effect.Effect<T, DatabaseError, never>

export interface TransactionService {
	readonly execute: TxFn
}

export class TransactionContext extends Context.Service<TransactionContext, TransactionService>()(
	"TransactionContext",
) {}

const DatabaseErrorType = Schema.Literals([
	"unique_violation",
	"foreign_key_violation",
	"connection_error",
	"query_error",
])

export class DatabaseError extends Schema.TaggedError<DatabaseError>()("DatabaseError", {
	type: DatabaseErrorType,
	cause: Schema.Unknown,
}) {
	public override toString() {
		return `DatabaseError: ${(this.cause as postgres.PostgresError).message}`
	}

	public override get message() {
		return (this.cause as postgres.PostgresError).message
	}
}

const matchPgError = (error: unknown) => {
	if (error instanceof postgres.PostgresError) {
		switch (error.code) {
			case "23505":
				return new DatabaseError({ type: "unique_violation", cause: error })
			case "23503":
				return new DatabaseError({ type: "foreign_key_violation", cause: error })
			case "08000":
				return new DatabaseError({ type: "connection_error", cause: error })
			default:
				return new DatabaseError({ type: "query_error", cause: error })
		}
	}
	return null
}

export class DatabaseConnectionLostError extends Schema.TaggedError<DatabaseConnectionLostError>()(
	"DatabaseConnectionLostError",
	{
		cause: Schema.Unknown,
		message: Schema.String,
	},
) {}

/** Sentinel error used to trigger Drizzle transaction rollback when an Effect fails */
class EffectTransactionRollback extends Error {
	constructor() {
		super("Effect transaction rollback")
		this.name = "EffectTransactionRollback"
	}
}

export type Config = {
	url: Redacted.Redacted
	ssl: boolean
}

/**
 * A drizzle client scoped to the current request. On Cloudflare Workers a TCP socket belongs to
 * the request that opened it, so an isolate-wide pool cannot be shared across requests; the
 * Worker provides one of these per request (see {@link makeRequestConnection}) and
 * {@link layerRequestScoped} reads it on every query.
 */
export class DatabaseConnection extends Context.Service<DatabaseConnection, { readonly db: Client }>()(
	"DatabaseConnection",
) {}

/**
 * A lazily-connecting client for one request. postgres.js opens no socket until the first
 * query, so requests that never touch the database cost nothing. Through Hyperdrive the pool
 * lives at the edge, so `max` stays small and type fetching is skipped.
 */
export const makeRequestConnection = (
	url: string,
): { readonly db: Client; readonly end: () => Promise<void> } => {
	const sql = postgres(url, {
		max: 5,
		fetch_types: false,
		idle_timeout: 5,
		connect_timeout: 10,
	})
	return { db: drizzle(sql, { schema }), end: () => sql.end({ timeout: 5 }) }
}

const makePooledClient = (config: Config) =>
	Effect.gen(function* () {
		const sql = yield* Effect.acquireRelease(
			Effect.sync(() =>
				postgres(Redacted.value(config.url), {
					ssl: config.ssl,
					idle_timeout: 0,
					connect_timeout: 10,
				}),
			),
			(pool) => Effect.promise(() => pool.end()),
		)

		yield* Effect.tryPromise(() => sql`SELECT 1`).pipe(
			Effect.retry(
				Schedule.jittered(Schedule.spaced("1.25 seconds")).pipe(
					(schedule) => Schedule.max([schedule, Schedule.recurs(10)]),
					Schedule.tap(({ attempt }) =>
						Effect.logWarning(
							`[Database client]: Connection to the database failed. Retrying (attempt ${attempt}).`,
						),
					),
				),
			),
			Effect.tap(() => Effect.logInfo("[Database client]: Connection to the database established.")),
			Effect.orDie,
		)

		const db = drizzle(sql, { schema })
		return Effect.succeed(db)
	})

/** The request's client; a defect when the Worker forgot to provide one. */
const requestClient: Effect.Effect<Client> = Effect.serviceOption(DatabaseConnection).pipe(
	Effect.flatMap((connection) =>
		Option.isSome(connection)
			? Effect.succeed(connection.value.db)
			: Effect.die(new Error("DatabaseConnection is not provided for this request")),
	),
)

const makeService = (getDb: Effect.Effect<Client>) =>
	Effect.gen(function* () {
		const execute = Effect.fn(<T>(fn: (client: Client) => Promise<T>) =>
			Effect.flatMap(getDb, (db) =>
				Effect.tryPromise({
					try: () => fn(db),
					catch: (cause) => {
						const error = matchPgError(cause)
						if (error !== null) {
							return error
						}
						throw cause
					},
				}),
			),
		)

		const transaction = Effect.fn("Database.transaction")(<T, E, R>(effect: Effect.Effect<T, E, R>) =>
			Effect.all([getDb, Effect.context<R>()]).pipe(
				Effect.map(([db, services]) => [db, Effect.runPromiseExitWith(services)] as const),
				Effect.flatMap(([db, runPromiseExit]) =>
					Effect.callback<T, DatabaseError | E, R>((resume) => {
						db.transaction(async (tx: TransactionClient) => {
							const txWrapper: TxFn = (fn: (client: TransactionClient) => Promise<any>) =>
								Effect.tryPromise({
									try: () => fn(tx),
									catch: (cause) => {
										const error = matchPgError(cause)
										if (error !== null) {
											return error
										}
										throw cause
									},
								})

							const withContext = effect.pipe(
								Effect.provideService(TransactionContext, { execute: txWrapper }),
							)

							const result = await runPromiseExit(withContext)
							if (Exit.isFailure(result)) {
								resume(Effect.failCause(result.cause))
								throw new EffectTransactionRollback()
							}
							resume(Effect.succeed(result.value))
						}).catch((cause) => {
							// Ignore our sentinel error - already handled via resume() in onFailure
							if (cause instanceof EffectTransactionRollback) return
							const error = matchPgError(cause)
							resume(error !== null ? Effect.fail(error) : Effect.die(cause))
						})
					}),
				),
			),
		)

		const makeQueryWithSchema = <InputSchema extends Schema.Top, A, E, R>(
			inputSchema: InputSchema,
			queryFn: (
				execute: <T>(
					fn: (client: Client | TransactionClient) => Promise<T>,
				) => Effect.Effect<T, DatabaseError, never>,
				validatedInput: InputSchema["Type"],
				options?: { spanPrefix?: string },
			) => Effect.Effect<A, E, never>,
		) => {
			return (
				rawData: unknown,
				tx?: <T>(
					fn: (client: TransactionClient) => Promise<T>,
				) => Effect.Effect<T, DatabaseError, never>,
			): Effect.Effect<A, E | DatabaseError | Schema.SchemaError, R> => {
				return Effect.gen(function* () {
					const validatedInput = yield* Schema.decodeUnknownEffect(inputSchema)(rawData)

					if (tx) {
						return yield* queryFn(tx, validatedInput)
					}

					const maybeCtx = yield* Effect.serviceOption(TransactionContext)
					if (Option.isSome(maybeCtx)) {
						return yield* queryFn(maybeCtx.value.execute, validatedInput)
					}

					return yield* queryFn(execute, validatedInput)
				}).pipe(
					Effect.withSpan("queryWithSchema", {
						attributes: { "input.schema": inputSchema.ast.toString() },
					}),
				) as Effect.Effect<A, E | DatabaseError | Schema.SchemaError, R>
			}
		}

		const makeQuery = <Input, A, E, R>(
			queryFn: (
				executor: <T>(
					fn: (client: Client | TransactionClient) => Promise<T>,
				) => Effect.Effect<T, DatabaseError>,
				input: Input,
			) => Effect.Effect<A, E, R>,
		) => {
			return (
				input: Input,
				tx?: <U>(fn: (client: TransactionClient) => Promise<U>) => Effect.Effect<U, DatabaseError>,
			): Effect.Effect<A, E | DatabaseError, R> => {
				return Effect.gen(function* () {
					if (tx) {
						return yield* queryFn(
							tx as <T>(
								fn: (client: Client | TransactionClient) => Promise<T>,
							) => Effect.Effect<T, DatabaseError>,
							input,
						)
					}

					const maybeCtx = yield* Effect.serviceOption(TransactionContext)
					if (Option.isSome(maybeCtx)) {
						return yield* queryFn(
							maybeCtx.value.execute as <T>(
								fn: (client: Client | TransactionClient) => Promise<T>,
							) => Effect.Effect<T, DatabaseError>,
							input,
						)
					}

					return yield* queryFn(execute, input)
				})
			}
		}

		return {
			execute,
			transaction,
			makeQuery,
			makeQueryWithSchema,
		} as const
	})

type Shape = Effect.Success<ReturnType<typeof makeService>>

export class Database extends Context.Service<Database, Shape>()("Database") {}

/** A long-lived pool, for long-running processes (Bun servers, the cluster). */
export const layer = (config: Config) =>
	Layer.effect(Database, Effect.flatMap(makePooledClient(config), makeService))

/** Reads the per-request {@link DatabaseConnection}; for Cloudflare Workers and Durable Objects. */
export const layerRequestScoped = Layer.effect(Database, makeService(requestClient))
