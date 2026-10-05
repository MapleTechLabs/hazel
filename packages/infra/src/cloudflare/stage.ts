import * as Effect from "effect/Effect"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"

/** An alchemy stage string that names no deployable Hazel stage. */
export class HazelStageError extends Schema.TaggedError<HazelStageError>()("@hazel/infra/HazelStageError", {
	message: Schema.String,
	rawStage: Schema.String,
}) {}

export type HazelStage = { kind: "prd" } | { kind: "pr"; prNumber: number } | { kind: "dev"; name: string }

const PR_STAGE_RE = /^pr-(\d+)$/
// Underscores allowed so alchemy's default `dev_${USER}` stage parses as a dev stage.
const DEV_STAGE_RE = /^[a-z0-9][a-z0-9_-]*$/

/** Public hostnames per deployment. Dev stages have none (workers.dev / localhost). */
export interface HazelDomains {
	readonly web?: string
	readonly landing?: string
	readonly docs?: string
	readonly api?: string
	readonly electric?: string
	readonly linkPreview?: string
	readonly rivet?: string
}

export const ZONE = "hazel.sh"

const PRD_DOMAINS: HazelDomains = {
	web: "app.hazel.sh",
	landing: "hazel.sh",
	docs: "docs.hazel.sh",
	api: "api.hazel.sh",
	electric: "electric.hazel.sh",
	linkPreview: "link-preview.hazel.sh",
	rivet: "rivet.hazel.sh",
}

const hazelStageResult = (stage: string): Result.Result<HazelStage, HazelStageError> => {
	const normalized = stage.trim().toLowerCase()
	if (normalized === "prd") return Result.succeed({ kind: "prd" })

	const prMatch = normalized.match(PR_STAGE_RE)
	if (prMatch) {
		const prNumber = Number(prMatch[1])
		if (Number.isSafeInteger(prNumber) && prNumber > 0) return Result.succeed({ kind: "pr", prNumber })
	}

	if (DEV_STAGE_RE.test(normalized)) {
		// Cloudflare names allow only [a-z0-9-].
		return Result.succeed({ kind: "dev", name: normalized.replaceAll("_", "-") })
	}

	return Result.fail(
		new HazelStageError({
			message: `Unsupported deployment stage "${stage}". Expected prd, pr-<number>, or a dev stage name matching [a-z0-9][a-z0-9_-]*.`,
			rawStage: stage,
		}),
	)
}

/** Parse an alchemy stage string, failing with {@link HazelStageError}. */
export const parseHazelStageEffect = (raw: string): Effect.Effect<HazelStage, HazelStageError> =>
	Effect.fromResult(hazelStageResult(raw))

/** Synchronous {@link parseHazelStageEffect}: throws the `HazelStageError`. For non-Effect callers only. */
export function parseHazelStage(raw: string): HazelStage {
	return Result.getOrThrow(hazelStageResult(raw))
}

export function formatHazelStage(stage: HazelStage): string {
	switch (stage.kind) {
		case "prd":
			return "prd"
		case "pr":
			return `pr-${stage.prNumber}`
		case "dev":
			return stage.name
	}
}

/** `OTEL_ENVIRONMENT` / `NODE_ENV`-style environment name for a stage. */
export function resolveDeploymentEnvironment(stage: HazelStage): string {
	switch (stage.kind) {
		case "prd":
			return "production"
		case "pr":
			return `pr-${stage.prNumber}`
		case "dev":
			return "development"
	}
}

export function resolveHazelDomains(stage: HazelStage): HazelDomains {
	switch (stage.kind) {
		case "prd":
			return PRD_DOMAINS
		case "pr":
			// Custom domains, not workers.dev: inter-app URLs must be plan-time strings.
			return {
				web: `app-pr-${stage.prNumber}.${ZONE}`,
				api: `api-pr-${stage.prNumber}.${ZONE}`,
				electric: `electric-pr-${stage.prNumber}.${ZONE}`,
			}
		case "dev":
			return {}
	}
}

/**
 * Physical Worker/bucket/Hyperdrive name. prd keeps the pre-alchemy wrangler names (see
 * {@link LEGACY_PRD_NAMES}) so `--adopt` takes over the existing Workers instead of replacing them.
 */
export function resolveWorkerName(base: string, stage: HazelStage): string {
	switch (stage.kind) {
		case "prd":
			return LEGACY_PRD_NAMES[base] ?? `hazel-${base}`
		case "pr":
			return `hazel-${base}-pr-${stage.prNumber}`
		case "dev":
			return `hazel-${base}-dev-${stage.name}`
	}
}

/** Names the wrangler-deployed prd Workers already have. */
const LEGACY_PRD_NAMES: Record<string, string> = {
	web: "hazel-app",
	landing: "hazel-landing",
	"link-preview": "link-preview-worker",
	actors: "hazel-actors",
}
