/**
 * The api Worker's env on Node, for building its route graph (`buildApp`) in tests and benches:
 * the config a deployed stage has with sign-in enabled, the directory D1 over node SQLite, and KV
 * and R2 bindings that only record. Every call a binding gets lands in `calls`.
 */
import { DatabaseSync, type SQLInputValue } from "node:sqlite"
import { storeMigrations } from "@hazel/db"
import { CACHE_BINDING, DIRECTORY_DB_BINDING, HTML_RENDERS_BINDING } from "./platform"

/** A binding whose every member is a function that records its call and never answers. */
const recordingBinding = (name: string, calls: Array<string>) =>
	new Proxy(
		{},
		{
			get: (_target, member) =>
				typeof member === "symbol"
					? undefined
					: (..._args: ReadonlyArray<unknown>) => {
							calls.push(`${name}.${member}`)
							return new Promise(() => {})
						},
		},
	)

/** The directory D1 over node SQLite, migrated; every call is recorded and takes `latencyMs`. */
const fakeDirectoryDb = (calls: Array<string>, latencyMs: number) => {
	const db = new DatabaseSync(":memory:")
	for (const migration of storeMigrations.directory) {
		for (const statement of migration.statements) db.exec(statement)
	}
	const answer = <A>(value: () => A) =>
		new Promise<A>((resolve, reject) =>
			setTimeout(() => {
				try {
					resolve(value())
				} catch (error) {
					reject(error)
				}
			}, latencyMs),
		)
	const statement = (sql: string, params: ReadonlyArray<SQLInputValue> = []) => {
		const rows = () => db.prepare(sql).all(...params) as Array<Record<string, unknown>>
		const label = sql.replace(/\s+/g, " ").trim().slice(0, 70)
		return {
			rows,
			bind: (...bound: ReadonlyArray<SQLInputValue>) => statement(sql, bound),
			all: () => {
				calls.push(`d1 ${label}`)
				return answer(() => ({ results: rows() }))
			},
			raw: () => {
				calls.push(`d1 ${label}`)
				return answer(() => rows().map((row) => Object.values(row)))
			},
		}
	}
	return {
		prepare: (sql: string) => statement(sql),
		batch: (statements: ReadonlyArray<ReturnType<typeof statement>>) => {
			calls.push(`d1 batch of ${statements.length}`)
			return answer(() => statements.map((each) => ({ results: each.rows() })))
		},
	}
}

export interface FakeApiEnvOptions {
	/** The stage's web app (`FRONTEND_URL`). */
	readonly frontendUrl?: string
	/** How long each D1 call takes. */
	readonly d1LatencyMs?: number
}

export const makeFakeApiEnv = async (options: FakeApiEnvOptions = {}) => {
	const calls: Array<string> = []
	const signing = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"])
	const privateJwk = await crypto.subtle.exportKey("jwk", signing.privateKey)
	const key = Buffer.alloc(32, 7).toString("base64url")
	const env = {
		S3_BUCKET: "test",
		S3_ENDPOINT: "http://localhost:9000",
		S3_ACCESS_KEY_ID: "test",
		S3_SECRET_ACCESS_KEY: "test",
		INTEGRATION_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"),
		API_BASE_URL: "https://api.hazel.test",
		FRONTEND_URL: options.frontendUrl ?? "https://app.hazel.test",
		IS_DEV: "false",
		HAZEL_STAGE: "prd",
		GITHUB_APP_PRIVATE_KEY: "test",
		GITHUB_APP_SLUG: "test",
		GITHUB_APP_ID: "test",
		AUTH_GITHUB_CLIENT_ID: "test",
		AUTH_GITHUB_CLIENT_SECRET: "test",
		AUTH_BINDING_KEY: key,
		AUTH_TRANSACTION_KEY: key,
		AUTH_ACCESS_TOKEN_PRIVATE_JWK: JSON.stringify(privateJwk),
		[DIRECTORY_DB_BINDING]: fakeDirectoryDb(calls, options.d1LatencyMs ?? 0),
		[CACHE_BINDING]: recordingBinding("kv", calls),
		[HTML_RENDERS_BINDING]: recordingBinding("r2", calls),
	}
	return { env, calls }
}
