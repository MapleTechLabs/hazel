/** The marketing site: the Astro static build served as Worker static assets. */
import { HazelStack, resolveWorkerName } from "@hazel/infra/cloudflare"
import * as Cloudflare from "alchemy/Cloudflare"
import { Effect } from "effect"

const props = Effect.gen(function* () {
	const { stage, domains } = yield* HazelStack
	return {
		name: resolveWorkerName("landing", stage),
		cwd: new URL(".", import.meta.url).pathname,
		command: "bun run build",
		outdir: "dist",
		dev: { command: "bun run dev" },
		memo: { include: ["**/*", "../../packages/ui/src/**"], lockfile: true },
		compatibility: { date: "2026-10-01" },
		workersDev: stage.kind !== "prd",
		domain: domains.landing,
	}
})

export default class Landing extends Cloudflare.Website.StaticSite<Landing>()("landing", props) {}
