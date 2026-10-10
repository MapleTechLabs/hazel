import { PgClient } from "@effect/sql-pg"
import { Context, Effect, Layer, Option, Redacted, Scope } from "effect"
import { Reactivity } from "effect/reactivity"
import { SqlClient } from "effect/sql"
import type { SqlError } from "effect/sql/SqlError"

/**
 * The Postgres client auth storage runs on, chosen per request.
 *
 * The auth services are built once, but on Cloudflare Workers a socket belongs to the
 * request that opened it, so they cannot hold a pool. Auth storage therefore uses a
 * `SqlClient` that resolves this service on every statement: the Worker provides a
 * lazily-connecting client per request, Bun provides one pool for the process.
 */
export class AuthSqlConnection extends Context.Service<
	AuthSqlConnection,
	{ readonly client: Effect.Effect<SqlClient.SqlClient, SqlError> }
>()("@hazel/auth/AuthSqlConnection") {}

/**
 * Opens a dedicated connection for a statement that runs without an
 * {@link AuthSqlConnection} in scope, closed when the statement's lease ends.
 *
 * The storage layers check the physical schema (columns, keys, join types) once, under
 * the context they were built in rather than the request's. Where connections are per
 * request (Workers), those few statements use this instead.
 */
export class AuthSqlDirect extends Context.Service<
	AuthSqlDirect,
	{ readonly open: Effect.Effect<SqlClient.SqlClient, SqlError, Scope.Scope> }
>()("@hazel/auth/AuthSqlDirect") {}

/** `SqlClient` for auth storage, routed to the current {@link AuthSqlConnection}. */
export const layerRouted: Layer.Layer<SqlClient.SqlClient> = Layer.effect(
	SqlClient.SqlClient,
	Effect.gen(function* () {
		const direct = yield* Effect.serviceOption(AuthSqlDirect)

		const acquirer = Effect.serviceOption(AuthSqlConnection).pipe(
			Effect.flatMap(
				Option.match({
					onSome: (connection) => connection.client,
					onNone: () =>
						Option.match(direct, {
							onSome: (direct) => direct.open,
							onNone: () =>
								Effect.die(new Error("AuthSqlConnection is not provided for this request")),
						}),
				}),
			),
			// Each statement (and each transaction) leases a connection from that client.
			Effect.flatMap((client) => client.reserve),
		)

		return yield* SqlClient.make({
			acquirer,
			compiler: PgClient.makeCompiler(),
			spanAttributes: [["db.system.name", "postgresql"]],
			prepareTransactionControls: true,
		})
	}),
).pipe(Layer.provide(Reactivity.layer))

/** One pooled client for a long-running process (Bun). */
export const layerPool = (url: Redacted.Redacted) =>
	Layer.effect(
		AuthSqlConnection,
		PgClient.make({ url, maxConnections: 5 }).pipe(
			Effect.map((client) => ({ client: Effect.succeed<SqlClient.SqlClient>(client) })),
		),
	).pipe(Layer.provide(Reactivity.layer))

const connect = (url: Redacted.Redacted) =>
	PgClient.makeClient({ url }).pipe(
		Effect.provide(Reactivity.layer),
		Effect.map((client): SqlClient.SqlClient => client),
	)

/** Direct connections for hosts that connect per request (Workers). */
export const layerDirect = (url: Redacted.Redacted) => Layer.succeed(AuthSqlDirect, { open: connect(url) })

/**
 * A client for one request that connects on its first statement, closed with `scope`.
 * Requests that never touch auth storage open no connection.
 */
export const makeRequestConnection = (url: Redacted.Redacted, scope: Scope.Scope) =>
	Effect.cached(connect(url).pipe(Scope.provide(scope))).pipe(
		Effect.map((client) => AuthSqlConnection.of({ client })),
	)
