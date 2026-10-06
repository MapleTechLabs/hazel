/**
 * RivetKit actors: an async Worker whose `ActorHandler` Durable Object class comes from
 * `@rivetkit/cloudflare-workers`. On the adopting deploy the binding must keep the existing
 * `ACTOR_DO` -> `ActorHandler` mapping (alchemy matches the live class by binding name).
 */
import { HazelStack, hazelWorkerProps, stageProps } from "@hazel/infra/cloudflare"
import * as Cloudflare from "alchemy/Cloudflare"
import { Effect } from "effect"

export const ActorKv = Cloudflare.KV.Namespace(
	"actor-kv",
	stageProps("actor-kv", (name, stage) => ({ title: stage.kind === "prd" ? "hazel-actor-kv" : name })),
)

export default Effect.gen(function* () {
	const stack = yield* HazelStack
	const actorKv = yield* ActorKv
	return yield* Cloudflare.Worker("actors", {
		...hazelWorkerProps("actors", stack),
		main: new URL("./src/index.ts", import.meta.url).pathname,
		workersDev: stack.stage.kind !== "prd",
		domain: stack.domains.rivet,
		env: {
			ACTOR_DO: Cloudflare.DurableObject("ACTOR_DO", { className: "ActorHandler" }),
			ACTOR_KV: actorKv,
			NODE_ENV: stack.stage.kind === "dev" ? "development" : "production",
			RIVET_PUBLIC_ENDPOINT: stack.urls.rivet,
		},
		observability: {
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
		},
	})
})
