import * as Effect from "effect/Effect"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"

/** An alchemy stage string that names no deployable Hazel stage. */
export class HazelStageError extends Schema.TaggedError<HazelStageError, { readonly brand: unique symbol }>()(
	"@hazel/infra/HazelStageError",
	{
		message: Schema.String,
		rawStage: Schema.String,
	},
) {}

/**
 * - `prd`: Hazel's own production (`*.hazel.sh`).
 * - `pr`: a preview of a pull request (`*-pr-<n>.hazel.sh`).
 * - `customer`: a production install in a customer's own Cloudflare account (stage
 *   `customer-<name>`), on the zone named by `HAZEL_ZONE` (`docs/self-hosting.md`). Treated as
 *   production everywhere: custom domains, no dev-only routes.
 * - `dev`: a developer's stage (`alchemy dev`, or a deployed scratch stage) on workers.dev.
 */
export type HazelStage =
	| { kind: "prd" }
	| { kind: "pr"; prNumber: number }
	| { kind: "customer"; name: string }
	| { kind: "dev"; name: string }

/** Stages that serve real users: custom domains, production env, no dev-only routes. */
export const isProductionStage = (stage: HazelStage): boolean =>
	stage.kind === "prd" || stage.kind === "customer"

const PR_STAGE_RE = /^pr-(\d+)$/
const CUSTOMER_STAGE_RE = /^customer-([a-z0-9][a-z0-9-]*)$/
// Underscores allowed so alchemy's default `dev_${USER}` stage parses as a dev stage.
const DEV_STAGE_RE = /^[a-z0-9][a-z0-9_-]*$/

/** Public hostnames per deployment. Dev stages have none (workers.dev / localhost). */
export interface HazelDomains {
	readonly web?: string
	readonly landing?: string
	readonly docs?: string
	readonly api?: string
	readonly linkPreview?: string
	readonly botGateway?: string
	/** Public uploads (the R2 bucket's custom domain). */
	readonly cdn?: string
	/** Sender domain of invitation and support emails (onboarded to Cloudflare Email Sending). */
	readonly mail?: string
	/** Domain support mailboxes receive at (Cloudflare Email Routing → the api Worker). */
	readonly inboundMail?: string
}

export const ZONE = "hazel.sh"

const PRD_DOMAINS: HazelDomains = {
	web: "app.hazel.sh",
	landing: "hazel.sh",
	docs: "docs.hazel.sh",
	api: "api.hazel.sh",
	linkPreview: "link-preview.hazel.sh",
	botGateway: "bot-gateway.hazel.sh",
	cdn: "cdn.hazel.sh",
	mail: "mail.hazel.sh",
	inboundMail: "inbound.hazel.sh",
}

/** A customer install's hostnames, all under its zone (`HAZEL_ZONE`). */
export const customerDomains = (zone: string): HazelDomains => ({
	web: `app.${zone}`,
	api: `api.${zone}`,
	linkPreview: `link-preview.${zone}`,
	botGateway: `bot-gateway.${zone}`,
	cdn: `cdn.${zone}`,
	mail: `mail.${zone}`,
	inboundMail: `inbound.${zone}`,
})

const hazelStageResult = (stage: string): Result.Result<HazelStage, HazelStageError> => {
	const normalized = stage.trim().toLowerCase()
	if (normalized === "prd") return Result.succeed({ kind: "prd" })

	const prMatch = normalized.match(PR_STAGE_RE)
	if (prMatch) {
		const prNumber = Number(prMatch[1])
		if (Number.isSafeInteger(prNumber) && prNumber > 0) return Result.succeed({ kind: "pr", prNumber })
	}

	const customerName = normalized.match(CUSTOMER_STAGE_RE)?.[1]
	if (customerName !== undefined) return Result.succeed({ kind: "customer", name: customerName })

	if (DEV_STAGE_RE.test(normalized)) {
		// Cloudflare names allow only [a-z0-9-].
		return Result.succeed({ kind: "dev", name: normalized.replaceAll("_", "-") })
	}

	return Result.fail(
		new HazelStageError({
			message: `Unsupported deployment stage "${stage}". Expected prd, pr-<number>, customer-<name>, or a dev stage name matching [a-z0-9][a-z0-9_-]*.`,
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
		case "customer":
			return `customer-${stage.name}`
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
		case "customer":
			return `customer-${stage.name}`
		case "dev":
			return "development"
	}
}

/** `zone` is the customer's `HAZEL_ZONE`: required for a `customer` stage, ignored otherwise. */
export function resolveHazelDomains(stage: HazelStage, zone?: string): HazelDomains {
	switch (stage.kind) {
		case "prd":
			return PRD_DOMAINS
		case "pr":
			// Custom domains, not workers.dev: inter-app URLs must be plan-time strings.
			return {
				web: `app-pr-${stage.prNumber}.${ZONE}`,
				api: `api-pr-${stage.prNumber}.${ZONE}`,
			}
		case "customer":
			return zone ? customerDomains(zone) : {}
		case "dev":
			return {}
	}
}

/**
 * Physical Worker/bucket/database name. prd keeps the pre-alchemy wrangler names (see
 * {@link LEGACY_PRD_NAMES}) so `--adopt` takes over the existing Workers instead of replacing them.
 */
export function resolveWorkerName(base: string, stage: HazelStage): string {
	switch (stage.kind) {
		case "prd":
			return LEGACY_PRD_NAMES[base] ?? `hazel-${base}`
		case "pr":
			return `hazel-${base}-pr-${stage.prNumber}`
		case "customer":
			return `hazel-${base}-${stage.name}`
		case "dev":
			return `hazel-${base}-dev-${stage.name}`
	}
}

/** Names the wrangler-deployed prd Workers already have. */
const LEGACY_PRD_NAMES: Record<string, string> = {
	web: "hazel-app",
	landing: "hazel-landing",
	"link-preview": "link-preview-worker",
}
