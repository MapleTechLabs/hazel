/**
 * The `HAZEL_DB` Hyperdrive config: Workers reach Postgres through it. Its origin comes from
 * `HAZEL_PG_URL` (read at plan time); under `alchemy dev` it points at the docker-compose Postgres.
 *
 * The root stack yields `HazelDb` before any Worker that binds it, so the `HAZEL_PG_URL` read
 * happens outside a Worker init (where alchemy would bind it as a secret). A Worker binds it from
 * its init with `yield* Cloudflare.Hyperdrive.Connect(HazelDb)` and reads the per-invocation
 * connection string off the client.
 */
import * as Cloudflare from "alchemy/Cloudflare"
import { Stage } from "alchemy/Stage"
import * as Effect from "effect/Effect"
import * as Redacted from "effect/Redacted"
import { requiredPlain } from "../env.ts"
import { parseHazelStageEffect, resolveWorkerName } from "./stage.ts"

/** The binding's name, which is also the Connection's logical id. */
export const HAZEL_DB_BINDING = "HAZEL_DB"

export const HazelDb = Cloudflare.Hyperdrive.Connection(
	HAZEL_DB_BINDING,
	Effect.gen(function* () {
		// The root stack parses the same stage first and fails typed there.
		const stage = yield* Effect.orDie(parseHazelStageEffect(yield* Stage))
		// A stage without its database URL cannot be planned: a defect, not a branch.
		const rawPgUrl = yield* Effect.orDie(requiredPlain("HAZEL_PG_URL"))
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
			// Read-after-write: bot tokens are checked right after they are (re)generated.
			caching: { disabled: true },
			// docker-compose.yaml's Postgres.
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
