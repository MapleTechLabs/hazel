/**
 * `HAZEL_DB`: the Hyperdrive config every Worker reaches Postgres through. The origin comes from
 * `HAZEL_PG_URL`, read at plan time (from the stack or a Worker's props, never a Worker init,
 * where alchemy would bind the read as a secret). PlanetScale is not declared here: the origin is
 * whatever URL the deploy is given. Under `alchemy dev` the binding points at docker Postgres.
 */
import * as Cloudflare from "alchemy/Cloudflare"
import { Stage } from "alchemy/Stage"
import * as Effect from "effect/Effect"
import type * as Option from "effect/Option"
import * as Redacted from "effect/Redacted"
import * as Schema from "effect/Schema"
import { plainWithDefault, requiredPlain } from "../env.ts"
import { parseHazelStageEffect, resolveWorkerName } from "./stage.ts"

/** The binding's name on every Worker that talks to Postgres. */
export const HAZEL_DB_BINDING = "HAZEL_DB"

/** `docker-compose.yaml`'s Postgres: the dev origin and a dev stage's default `HAZEL_PG_URL`. */
export const LOCAL_PG_URL = "postgresql://user:password@localhost:5432/app"

/**
 * The Hyperdrive config. Yield it from a Worker's props and put it on `env` as `HAZEL_DB`; the
 * root stack may also yield it to share one config across Workers (same logical id).
 */
export const HazelDb = Cloudflare.Hyperdrive.Connection(
	"hazel-db",
	Effect.gen(function* () {
		// The root stack already failed typed on a bad stage; here it is a defect.
		const stage = yield* Effect.orDie(parseHazelStageEffect(yield* Stage))
		// Deployed stages must name their database; a dev stage defaults to docker Postgres.
		const rawPgUrl = yield* Effect.orDie(
			Effect.gen(function* () {
				if (stage.kind !== "dev") return yield* requiredPlain("HAZEL_PG_URL")
				const record = yield* plainWithDefault("HAZEL_PG_URL", LOCAL_PG_URL)
				return record.HAZEL_PG_URL ?? LOCAL_PG_URL
			}),
		)
		const pgUrl = yield* Effect.try(() => new URL(rawPgUrl)).pipe(Effect.orDie)
		const props: Cloudflare.Hyperdrive.Props = {
			name: resolveWorkerName("db", stage),
			origin: {
				scheme: "postgres",
				host: pgUrl.hostname,
				port: Number(pgUrl.port || "5432"),
				database: pgUrl.pathname.replace(/^\//, "") || "postgres",
				user: decodeURIComponent(pgUrl.username),
				password: Redacted.make(decodeURIComponent(pgUrl.password)),
			},
			// Access checks must see the latest membership rows, so no query caching.
			caching: { disabled: true },
			dev: {
				scheme: "postgres",
				host: "localhost",
				port: 5432,
				database: "app",
				user: "user",
				password: Redacted.make("password"),
				// Docker Postgres has no TLS; alchemy's default `prefer` stalls until timeout.
				sslmode: "disable",
			},
		}
		return props
	}),
)

/** What a Worker reads off the `HAZEL_DB` binding: the runtime `Hyperdrive` object's connection string. */
const HazelDbBinding = Schema.Struct({
	connectionString: Schema.String.check(Schema.isNonEmpty()),
})
export type HazelDbBinding = typeof HazelDbBinding.Type

/** The `HAZEL_DB` binding off a Worker env, or `None` when absent or not a Hyperdrive object. */
export const readHazelDbBinding = (env: Record<string, unknown>): Option.Option<HazelDbBinding> =>
	Schema.decodeUnknownOption(HazelDbBinding)(env[HAZEL_DB_BINDING])
