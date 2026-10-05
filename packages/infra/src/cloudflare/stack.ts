import type * as Cloudflare from "alchemy/Cloudflare"
import { Stage } from "alchemy/Stage"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import { type HazelDomains, type HazelStage, parseHazelStage, resolveWorkerName } from "./stage.ts"

/** Inter-app public origins as plan-time strings (custom domains in prd/pr, env in dev). */
export interface HazelUrls {
	readonly web: string
	readonly api: string
	readonly electric: string
	readonly rivet: string
	readonly linkPreview: string
}

export interface HazelStackContext {
	readonly stage: HazelStage
	readonly domains: HazelDomains
	readonly urls: HazelUrls
	/** True under `alchemy dev` (not merely a dev stage: a dev stage can still be deployed). */
	readonly isDevServer: boolean
}

/** The deploy context Worker props read. Plan-time only: read behind `__ALCHEMY_RUNTIME__`. */
export class HazelStack extends Context.Service<HazelStack, HazelStackContext>()("@hazel/infra/HazelStack") {}

/**
 * The deployed api Worker, for sibling Workers that bind it. Not a `Worker.ref`: that reads
 * stored state and cannot see a sibling created by the same deploy.
 */
export class ApiWorker extends Context.Service<ApiWorker, Cloudflare.Worker>()("@hazel/infra/ApiWorker") {}

/**
 * Props for a module-scope resource with a stage-derived name. Reads alchemy's `Stage` (not
 * `HazelStack`) so it can be yielded from a Worker init too; returns `{}` under `__ALCHEMY_RUNTIME__`.
 */
export const stageProps = <Props extends object>(
	base: string,
	make: (name: string, stage: HazelStage) => Props,
): Effect.Effect<Partial<Props>, never, Stage> =>
	Effect.gen(function* () {
		if (globalThis.__ALCHEMY_RUNTIME__) return {}
		const stage = parseHazelStage(yield* Stage)
		return make(resolveWorkerName(base, stage), stage)
	})

/** {@link stageProps} for the common case: a resource whose only stage-derived prop is `name`. */
export const stageNamed = (base: string) => stageProps(base, (name) => ({ name }))

/** Workers runtime compatibility date for every Hazel Worker. */
export const WORKER_COMPATIBILITY_DATE = "2026-10-01"

/** The props every Hazel Worker shares. `app` is also the name base. */
export const hazelWorkerProps = (app: string, { stage }: HazelStackContext) => ({
	name: resolveWorkerName(app, stage),
	compatibility: { date: WORKER_COMPATIBILITY_DATE, flags: ["nodejs_compat"] },
})
