/**
 * The `electric` Worker: hosts the container-backed Durable Object that runs self-hosted
 * ElectricSQL. A plain async bundle entry (not an alchemy-generated one) so the third-party
 * `Container` subclass is exported from the script. Only `electric-proxy` reaches it, through a
 * cross-script Durable Object binding addressed by the fixed name `"electric"`.
 */
import { Container, type StopParams } from "@cloudflare/containers"

/** Electric's HTTP port (`ELECTRIC_PORT`'s default). */
const ELECTRIC_PORT = 3000

export interface ElectricHostEnv {
	/** Direct Postgres URL with REPLICATION; never Hyperdrive, which cannot do logical replication. */
	readonly ELECTRIC_DATABASE_URL: string
	/** Shared with electric-proxy, which sends it as the `secret` query param. */
	readonly ELECTRIC_SECRET: string
}

/**
 * One instance (`maxInstances: 1`, one object name): Electric owns a single replication slot, and
 * a second instance would fight over it. It never sleeps, since a cold start re-snapshots every
 * shape and an idle container stops consuming the slot while Postgres keeps WAL for it.
 */
export class ElectricContainer extends Container<ElectricHostEnv> {
	override defaultPort = ELECTRIC_PORT
	// Effectively disabled; `onActivityExpired` below also refuses to stop.
	override sleepAfter = "8760h"
	// Electric dials Postgres over the public internet.
	override enableInternet = true

	constructor(ctx: ConstructorParameters<typeof Container>[0], env: ElectricHostEnv) {
		super(ctx, env)
		this.envVars = {
			DATABASE_URL: env.ELECTRIC_DATABASE_URL,
			ELECTRIC_SECRET: env.ELECTRIC_SECRET,
			// Matches docker-compose: the proxy's where-clauses use subqueries.
			ELECTRIC_FEATURE_FLAGS: "allow_subqueries,tagged_subqueries",
			// Container-local disk: losing it costs only a re-snapshot (clients get `must-refetch`).
			ELECTRIC_STORAGE_DIR: "/app/persistent",
			ELECTRIC_PORT: String(ELECTRIC_PORT),
		}
	}

	/** Never sleep: keep the replication slot consumed between bursts of shape requests. */
	override async onActivityExpired(): Promise<void> {}

	override onStop(params: StopParams): void {
		// The next shape request restarts it (`containerFetch` starts a stopped container).
		console.warn("Electric container stopped", params)
	}

	override onError(error: unknown): unknown {
		console.error("Electric container error", error)
		throw error
	}
}

export default {
	fetch: (): Response => new Response("Not Found", { status: 404 }),
}
