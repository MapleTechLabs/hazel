/**
 * Which deployment stage the backend runs on, for the routes that must never run on prd (the dev
 * sign-in, the import). The api Worker gets `HAZEL_STAGE` (`prd`, `pr` or `dev`, `worker/env.ts`);
 * where it is unset (bun dev, tests) `IS_DEV=true` marks a dev process. Anything else counts as
 * prd: a missing stage fails closed.
 */
import { Config, Option } from "effect"

export interface StageEnv {
	readonly HAZEL_STAGE?: unknown
	readonly IS_DEV?: unknown
}

/** Stages that may run the dev-only routes; any other `HAZEL_STAGE` value counts as prd. */
const NON_PRODUCTION_STAGES: ReadonlySet<unknown> = new Set(["dev", "pr"])

/** True on a dev or PR-preview stage (or a local dev process). */
export const isNonProductionStage = (env: StageEnv): boolean =>
	typeof env.HAZEL_STAGE === "string" && env.HAZEL_STAGE !== ""
		? NON_PRODUCTION_STAGES.has(env.HAZEL_STAGE)
		: env.IS_DEV === "true" || env.IS_DEV === true

/** `isNonProductionStage` over `Config`. */
export const NonProductionStage: Config.Config<boolean> = Config.all({
	stage: Config.option(Config.String("HAZEL_STAGE")),
	isDev: Config.String("IS_DEV").pipe(Config.withDefault("false")),
}).pipe(
	Config.map(({ stage, isDev }) =>
		isNonProductionStage({ HAZEL_STAGE: Option.getOrUndefined(stage), IS_DEV: isDev }),
	),
)
