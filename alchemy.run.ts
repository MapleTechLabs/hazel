// The Hazel stack. Each app declares its resources in `apps/<app>/alchemy.run.ts`; this file
// builds the deploy context (`HazelStack`) and yields them in dependency order.
// Overview: infra/README.md; data and sync: infra/durable-object-sync-plan.md.
import { appendFileSync } from "node:fs"
import * as Maple from "@maple-dev/alchemy"
import * as Alchemy from "alchemy"
import * as Cloudflare from "@alchemy.run/cloudflare"
import { ConfigError } from "effect/Config"
import { SourceError } from "effect/ConfigProvider"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import {
	declareDirectoryDb,
	isBotDeployed,
	formatHazelStage,
	HazelStack,
	type HazelStackContext,
	parseHazelStageEffect,
	resolveHazelDomains,
} from "@hazel/infra/cloudflare"
import { plainWithDefault } from "@hazel/infra/env"
import { isMapleDeploy } from "@hazel/infra/maple"
import { HazelMonitoring } from "@hazel/infra/maple-monitoring"
import ApiLive, { Api } from "./apps/backend/src/worker.ts"
import BotGateway from "./apps/bot-gateway/alchemy.run.ts"
import Docs from "./apps/docs/alchemy.run.ts"
import Landing from "./apps/landing/alchemy.run.ts"
import LinkPreview from "./apps/link-preview-worker/alchemy.run.ts"
import Web from "./apps/web-foldkit/alchemy.run.ts"
import HazelBot from "./bots/hazel-bot/alchemy.run.ts"
import { HAZEL_BOT_TOKEN_KEY } from "./bots/hazel-bot/src/worker.ts"
import LinearBot from "./bots/linear-bot/alchemy.run.ts"
import { LINEAR_BOT_TOKEN_KEY } from "./bots/linear-bot/src/worker.ts"
import T3CodeBot from "./bots/t3code-bot/alchemy.run.ts"
import { T3CODE_BOT_TOKEN_KEY } from "./bots/t3code-bot/src/worker.ts"

// Some secret stores define CLOUDFLARE_DEFAULT_ACCOUNT_ID; alchemy reads CLOUDFLARE_ACCOUNT_ID.
if (!process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_DEFAULT_ACCOUNT_ID) {
	process.env.CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_DEFAULT_ACCOUNT_ID
}

/** `alchemy dev` sets ALCHEMY_DEV on its exec child. Not stage-derived: a dev stage can be deployed. */
const isDevServer = process.env.ALCHEMY_DEV === "true"

// Inter-app URLs must be plain strings at plan time (`worker.url` is a lazy Output), so
// deployed stages use custom domains and dev stages fall back to env-supplied URLs.
const resolveUrl = (domain: string | undefined, envKey: string, fallback: string) =>
	domain
		? Effect.succeed(`https://${domain}`)
		: Effect.map(plainWithDefault(envKey, fallback), (record) => record[envKey] ?? fallback)

const asConfigError = (error: { readonly message: string }) =>
	Effect.fail(new ConfigError(new SourceError({ message: error.message, cause: error })))

/** Append `key=value` lines to the GitHub Actions step-output file, if any. */
const appendStepOutputs = (lines: string[]): void => {
	const file = process.env.GITHUB_OUTPUT
	if (file) appendFileSync(file, `${lines.join("\n")}\n`)
}

const HazelStackLive = Layer.effect(
	HazelStack,
	Effect.gen(function* () {
		const stage = yield* parseHazelStageEffect(yield* Alchemy.Stage)
		const domains = resolveHazelDomains(stage)
		const context: HazelStackContext = {
			stage,
			domains,
			isDevServer,
			directoryDb: yield* declareDirectoryDb(stage),
			urls: {
				web: yield* resolveUrl(domains.web, "HAZEL_WEB_URL", "http://localhost:3100"),
				api: yield* resolveUrl(domains.api, "HAZEL_API_URL", "http://localhost:3003"),
				linkPreview: yield* resolveUrl(
					domains.linkPreview,
					"HAZEL_LINK_PREVIEW_URL",
					"http://localhost:5471",
				),
			},
		}
		return context
	}),
)

export default Alchemy.Stack(
	"hazel",
	{
		// Maple (Worker telemetry's ingest key) only with `MAPLE_API_KEY`: see `@hazel/infra/maple`.
		providers: Layer.mergeAll(Cloudflare.providers(), isMapleDeploy() ? Maple.providers() : Layer.empty),
		// ALCHEMY_LOCAL_STATE=1 uses .alchemy/ file state instead of the account-wide store.
		state: process.env.ALCHEMY_LOCAL_STATE ? Alchemy.localState() : Cloudflare.state(),
	},
	Effect.gen(function* () {
		const stack = yield* HazelStack
		const { stage, domains, urls } = stack

		// Before api, which binds its BotGateway Durable Objects cross-script.
		const botGateway = yield* BotGateway
		// The Live layer registers the api Worker's Durable Object classes in its bundle.
		const api = yield* Effect.provide(Api, ApiLive)
		const linkPreview = yield* LinkPreview
		const web = yield* Web
		// Shared marketing and docs sites: prd only (previews and dev run their own dev servers).
		const landing = stage.kind === "prd" ? yield* Landing : undefined
		const docs = stage.kind === "prd" ? yield* Docs : undefined
		// First-party bots: prd and `alchemy dev`, with their token set (`isBotDeployed`).
		const hazelBot = (yield* isBotDeployed(HAZEL_BOT_TOKEN_KEY, stack)) ? yield* HazelBot : undefined
		const linearBot = (yield* isBotDeployed(LINEAR_BOT_TOKEN_KEY, stack)) ? yield* LinearBot : undefined
		const t3codeBot = (yield* isBotDeployed(T3CODE_BOT_TOKEN_KEY, stack)) ? yield* T3CodeBot : undefined
		// Maple alerts and dashboard watch production only: see `@hazel/infra/maple-monitoring`.
		const monitoring = stage.kind === "prd" && isMapleDeploy() ? yield* HazelMonitoring : undefined

		const summary = {
			stage: formatHazelStage(stage),
			webUrl: domains.web ? `https://${domains.web}` : "",
			apiUrl: urls.api,
		}
		yield* Effect.sync(() =>
			appendStepOutputs([`web_url=${summary.webUrl}`, `api_url=${summary.apiUrl}`]),
		)

		return {
			...summary,
			apiWorker: api.workerName,
			botGatewayWorker: botGateway.workerName,
			webWorker: web.workerName,
			linkPreviewWorker: linkPreview.workerName,
			landingWorker: landing?.workerName,
			docsWorker: docs?.workerName,
			hazelBotWorker: hazelBot?.workerName,
			linearBotWorker: linearBot?.workerName,
			t3codeBotWorker: t3codeBot?.workerName,
			mapleDashboard: monitoring?.dashboardId,
			mapleAlertRules: monitoring?.alertRules,
		}
	}).pipe(
		// The stack IS the entry point: the one place `HazelStack` is provided.
		Effect.provide(HazelStackLive),
		// `Alchemy.Stack` admits only `ConfigError`.
		Effect.catchTags({ "@hazel/infra/HazelStageError": asConfigError }),
	),
)
