/**
 * The docs site (TanStack Start + fumadocs). `Website.Vite` injects the Cloudflare Vite plugin,
 * which builds the SSR Worker and client assets in one `vite build`.
 */
import { HazelStack, resolveWorkerName } from "@hazel/infra/cloudflare"
import * as Cloudflare from "alchemy/Cloudflare"
import { Effect } from "effect"

const props = Effect.gen(function* () {
	const { stage, domains } = yield* HazelStack
	return {
		name: resolveWorkerName("docs", stage),
		rootDir: new URL(".", import.meta.url).pathname,
		memo: { include: ["**/*", "../../packages/ui/src/**"], lockfile: true },
		compatibility: { date: "2026-10-01" },
		workersDev: stage.kind !== "prd",
		domain: domains.docs,
	}
})

export default class Docs extends Cloudflare.Website.Vite<Docs>()("docs", props) {}
