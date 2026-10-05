/**
 * electric-proxy's resources, plan-side: its KV cache and self-hosted ElectricSQL on Cloudflare
 * Containers. The `electric` Worker hosts the container-backed Durable Object
 * (`src/electric-container.ts`); electric-proxy binds that namespace cross-script as `ELECTRIC`.
 * Imported only from `src/worker.ts`'s props, whose branch is tree-shaken from the bundle.
 */
import {
	type HazelStackContext,
	HazelStack,
	hazelWorkerProps,
	resolveWorkerName,
	stageProps,
} from "@hazel/infra/cloudflare"
import { merge, optionalPlain, optionalSecret, requireSecretEntry } from "@hazel/infra/env"
import * as Cloudflare from "alchemy/Cloudflare"
import { Effect } from "effect"
import type { ElectricContainer } from "./src/electric-container.ts"

/**
 * Pinned, never `latest`: the storage format changes across minors. `electric-temp` because
 * Docker Hub's `electricsql/electric` denies pulls (see docker-compose.yaml); switch back once it
 * is restored. Alchemy re-pushes the image to the account registry, so a bump is a deploy step.
 */
export const ELECTRIC_IMAGE = "docker.io/electricsql/electric-temp:1.8.1"

/** Backs the bot access-context and Clerk user-lookup caches (Redis on the Bun entry). */
export const ProxyCache = Cloudflare.KV.Namespace(
	"electric-proxy-cache",
	stageProps("electric-proxy-cache", (title) => ({ title })),
)

/** The exported Durable Object class in `src/electric-container.ts`. */
const ELECTRIC_CLASS_NAME = "ElectricContainer"

/** Workers observability → Maple, as for actors (no OTel SDK in these Workers). */
export const mapleObservability = {
	enabled: true,
	headSamplingRate: 1,
	logs: {
		enabled: true,
		headSamplingRate: 1,
		persist: true,
		invocationLogs: true,
		destinations: ["maple-logs"],
	},
	traces: { enabled: true, persist: true, headSamplingRate: 1, destinations: ["maple-traces"] },
}

/**
 * The `electric` Worker and its container. Reached only over the cross-script DO binding: no
 * route, no workers.dev. `ELECTRIC_DATABASE_URL` is a direct (non-Hyperdrive) Postgres URL whose
 * role has REPLICATION.
 */
export const ElectricHost = Effect.gen(function* () {
	const stack = yield* HazelStack
	return yield* Cloudflare.Worker("electric", {
		...hazelWorkerProps("electric", stack),
		main: new URL("./src/electric-container.ts", import.meta.url).pathname,
		workersDev: false,
		observability: mapleObservability,
		env: {
			[ELECTRIC_CLASS_NAME]: Cloudflare.Container<ElectricContainer>(ELECTRIC_CLASS_NAME, {
				name: resolveWorkerName("electric", stack.stage),
				image: ELECTRIC_IMAGE,
				// 1 vCPU / 6 GiB / 12 GB disk: room for the shape log of every synced table.
				instanceType: "standard-2",
				// Exactly one: two instances cannot share the replication slot.
				maxInstances: 1,
				observability: { logs: { enabled: true } },
			}),
			...(yield* merge(
				requireSecretEntry("ELECTRIC_DATABASE_URL"),
				requireSecretEntry("ELECTRIC_SECRET"),
			)),
		},
	})
})

/**
 * Whether this deploy runs its own Electric container: not under `alchemy dev` (docker-compose
 * Electric via `ELECTRIC_URL`), and not for PR previews (no Electric; shape requests answer 503).
 */
export const usesElectricContainer = ({ stage, isDevServer }: HazelStackContext): boolean =>
	!isDevServer && stage.kind !== "pr"

/** electric-proxy's Electric env: the container's namespace, or the `ELECTRIC_URL` fallback. */
export const electricProxyEnv = (stack: HazelStackContext) =>
	Effect.gen(function* () {
		if (usesElectricContainer(stack)) {
			const host = yield* ElectricHost
			return {
				ELECTRIC: Cloudflare.DurableObject("ELECTRIC", {
					className: ELECTRIC_CLASS_NAME,
					scriptName: host.workerName,
				}),
				...(yield* requireSecretEntry("ELECTRIC_SECRET")),
			}
		}
		return yield* merge(
			// docker-compose maps Electric to 3333.
			optionalPlain("ELECTRIC_URL", stack.isDevServer ? "http://localhost:3333" : undefined),
			optionalSecret("ELECTRIC_SECRET"),
		)
	})
