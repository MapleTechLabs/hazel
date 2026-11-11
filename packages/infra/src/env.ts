import * as Config from "effect/Config"
import * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import { optionalString } from "./config-helpers.ts"
import { type HazelStage, resolveDeploymentEnvironment } from "./cloudflare/stage.ts"

/**
 * Deploy-time Worker env, as effect `Config`s: never read `process.env`, which misses alchemy's
 * `.env` / `--env-file` provider. Values are trimmed (blank = absent), absent optional keys are
 * omitted (never `""`), and secrets are `Redacted` (alchemy uploads those as Worker secrets).
 *
 * Read these only from the stack or a Worker's `props`, never from a Worker init: at plan time
 * alchemy auto-binds every `Config` read inside an init as a secret.
 */

export type PlainEnv = Record<string, string>
export type SecretEnv = Record<string, Redacted.Redacted<string>>
/** A union-valued record, not `PlainEnv & SecretEnv` (that intersection is uninhabited). */
export type WorkerEnv = Record<string, string | Redacted.Redacted<string>>

const trimmedOption = (key: string): Config.Config<Option.Option<string>> =>
	optionalString(key).pipe(
		Config.map((value: Option.Option<string>) => Option.map(value, (raw) => raw.trim())),
	)

/** Merge several partial-record configs into one. */
export const merge = (...parts: ReadonlyArray<Config.Config<Partial<WorkerEnv>>>): Config.Config<WorkerEnv> =>
	Config.all(parts).pipe(
		Config.map(
			(records: ReadonlyArray<Partial<WorkerEnv>>) => Object.assign({}, ...records) as WorkerEnv,
		),
	)

/** Required plain value, trimmed; blank fails with a `ConfigError`. */
export const requiredPlain = (key: string): Config.Config<string> =>
	Config.schema(Schema.Trim.check(Schema.isNonEmpty()), key)

/** Required secret, wrapped in `Redacted`. */
export const requiredSecret = (key: string): Config.Config<Redacted.Redacted<string>> =>
	requiredPlain(key).pipe(Config.map(Redacted.make))

export const requirePlainEntry = (key: string): Config.Config<PlainEnv> =>
	requiredPlain(key).pipe(Config.map((value) => ({ [key]: value })))

export const requireSecretEntry = (key: string): Config.Config<SecretEnv> =>
	requiredSecret(key).pipe(Config.map((value) => ({ [key]: value })))

/** Optional plain value, omitted when unset. `fallback` applies only if the key is absent. */
export const optionalPlain = (key: string, fallback?: string): Config.Config<PlainEnv> =>
	trimmedOption(key).pipe(
		Config.map((value) => {
			const resolved = Option.getOrUndefined(value) ?? fallback?.trim()
			return resolved ? { [key]: resolved } : {}
		}),
	)

/** Optional secret, omitted when unset. */
export const optionalSecret = (key: string): Config.Config<SecretEnv> =>
	trimmedOption(key).pipe(
		Config.map((value) =>
			Option.match(value, { onNone: () => ({}), onSome: (v) => ({ [key]: Redacted.make(v) }) }),
		),
	)

/** The first present-and-non-blank of `keys`, else `fallback`. For build vars with a `VITE_` twin. */
export const plainFrom = (keys: ReadonlyArray<string>, fallback: string): Config.Config<string> =>
	Config.all(keys.map(trimmedOption)).pipe(
		Config.map((values: ReadonlyArray<Option.Option<string>>) =>
			Option.getOrElse(Option.firstSomeOf(values), () => fallback),
		),
	)

/** Optional value whose default also applies to a BLANK var (unlike `Config.withDefault`). */
export const plainWithDefault = (key: string, fallback: string): Config.Config<PlainEnv> =>
	trimmedOption(key).pipe(Config.map((value) => ({ [key]: Option.getOrElse(value, () => fallback) })))

/** A value the stack chooses; the environment cannot override it. */
export const derived = (key: string, value: string): Config.Config<PlainEnv> =>
	Config.succeed({ [key]: value })

/** Environment and revision stamping shared by every Effect Worker. */
export const telemetryEnv = (stage: HazelStage): Config.Config<WorkerEnv> =>
	merge(
		derived("OTEL_ENVIRONMENT", resolveDeploymentEnvironment(stage)),
		// Read by the Maple SDK (`@hazel/infra/maple`), which binds the ingest key itself.
		derived("MAPLE_ENVIRONMENT", resolveDeploymentEnvironment(stage)),
		derived("NODE_ENV", stage.kind === "dev" ? "development" : "production"),
		merge(optionalPlain("COMMIT_SHA"), optionalPlain("GITHUB_SHA")).pipe(
			Config.map((record): PlainEnv => {
				const sha = record.COMMIT_SHA ?? record.GITHUB_SHA
				return typeof sha === "string" && sha ? { COMMIT_SHA: sha } : {}
			}),
		),
	)
