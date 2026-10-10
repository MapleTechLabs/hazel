// The Hazel stack. Each app declares its resources in `apps/<app>/alchemy.run.ts`; this file
// builds the deploy context (`HazelStack`) and yields them in dependency order.
// Plan: infra/cloudflare-migration-plan.md
import { appendFileSync } from "node:fs"
import * as Maple from "@maple-dev/alchemy"
import * as Alchemy from "alchemy"
import * as Cloudflare from "alchemy/Cloudflare"
import * as Planetscale from "alchemy/Planetscale"
import { ConfigError } from "effect/Config"
import { SourceError } from "effect/ConfigProvider"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import {
	declareHazelDb,
	formatHazelStage,
	HazelStack,
	type HazelStackContext,
	parseHazelStageEffect,
	resolveHazelDomains,
} from "@hazel/infra/cloudflare"
import { plainWithDefault } from "@hazel/infra/env"
import { isMapleDeploy } from "@hazel/infra/maple"
import Actors from "./apps/actors/alchemy.run.ts"
import ApiLive, { Api } from "./apps/backend/src/worker.ts"
import BotGateway from "./apps/bot-gateway/alchemy.run.ts"
import ElectricProxy from "./apps/electric-proxy/alchemy.run.ts"
import Landing from "./apps/landing/alchemy.run.ts"
import LinkPreview from "./apps/link-preview-worker/alchemy.run.ts"
import Web from "./apps/web/alchemy.run.ts"

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
			db: yield* declareHazelDb(stage),
			urls: {
				web: yield* resolveUrl(domains.web, "HAZEL_WEB_URL", "http://localhost:3000"),
				api: yield* resolveUrl(domains.api, "HAZEL_API_URL", "http://localhost:3003"),
				electric: yield* resolveUrl(domains.electric, "HAZEL_ELECTRIC_URL", "http://localhost:8184"),
				rivet: yield* resolveUrl(domains.rivet, "HAZEL_RIVET_URL", "http://localhost:6420"),
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
		// PlanetScale's credential lookup runs when the layer is built; `alchemy dev` never needs it.
		// Maple (Worker telemetry's ingest key) only with `MAPLE_API_KEY`: see `@hazel/infra/maple`.
		providers: Layer.mergeAll(
			isDevServer
				? Cloudflare.providers()
				: Cloudflare.providers().pipe(Layer.provideMerge(Planetscale.providers())),
			isMapleDeploy() ? Maple.providers() : Layer.empty,
		),
		// ALCHEMY_LOCAL_STATE=1 uses .alchemy/ file state instead of the account-wide store.
		state: process.env.ALCHEMY_LOCAL_STATE ? Alchemy.localState() : Cloudflare.state(),
	},
	Effect.gen(function* () {
		const { stage, domains, urls } = yield* HazelStack

		// Before api, which binds its BotGateway Durable Objects cross-script.
		const botGateway = yield* BotGateway
		// The Live layer registers the api Worker's Durable Object classes in its bundle.
		const api = yield* Effect.provide(Api, ApiLive)
		// Also yields the `electric` Worker (self-hosted Electric in a Container) on deployed stages.
		const electricProxy = yield* ElectricProxy
		const linkPreview = yield* LinkPreview
		const actors = yield* Actors
		const web = yield* Web
		// Shared marketing site: prd only (previews and dev run their own dev servers). docs.hazel.sh
		// stays on Vercel until its DNS record is moved, so the docs site is not deployed here yet.
		const landing = stage.kind === "prd" ? yield* Landing : undefined

		const summary = {
			stage: formatHazelStage(stage),
			webUrl: domains.web ? `https://${domains.web}` : "",
			apiUrl: urls.api,
			electricUrl: urls.electric,
		}
		yield* Effect.sync(() =>
			appendStepOutputs([`web_url=${summary.webUrl}`, `api_url=${summary.apiUrl}`]),
		)

		return {
			...summary,
			apiWorker: api.workerName,
			botGatewayWorker: botGateway.workerName,
			electricProxyWorker: electricProxy.workerName,
			webWorker: web.workerName,
			linkPreviewWorker: linkPreview.workerName,
			actorsWorker: actors.workerName,
			landingWorker: landing?.workerName,
		}
	}).pipe(
		// The stack IS the entry point: the one place `HazelStack` is provided.
		Effect.provide(HazelStackLive),
		// `Alchemy.Stack` admits only `ConfigError`.
		Effect.catchTags({ "@hazel/infra/HazelStageError": asConfigError }),
	),
)
