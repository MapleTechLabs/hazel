/**
 * The web SPA: `vite build` output served as Worker static assets (no Worker code).
 * `VITE_*` keys in `env` are build inputs: they reach `vite build` via the process env and are
 * folded into the memo hash, so changing one rebuilds with no source change.
 */
import { HazelStack, resolveWorkerName } from "@hazel/infra/cloudflare"
import { plainFrom } from "@hazel/infra/env"
import * as Cloudflare from "@alchemy.run/cloudflare"
import { Effect } from "effect"

const props = Effect.gen(function* () {
	const { stage, domains, urls } = yield* HazelStack
	return {
		name: resolveWorkerName("web", stage),
		cwd: new URL("./", import.meta.url).pathname,
		command: "bunx vite build",
		outdir: "dist",
		dev: { command: "bun run dev" },
		assets: {
			// Deep links serve the shell in place.
			notFoundHandling: "single-page-application" as const,
		},
		// Also hash the workspace sources the SPA bundles.
		memo: {
			include: ["**/*", "../../packages/*/src/**", "../../libs/*/src/**"],
			lockfile: true,
		},
		compatibility: { date: "2026-09-25" },
		workersDev: stage.kind !== "prd",
		domain: domains.web,
		env: {
			VITE_BACKEND_URL: yield* plainFrom(["VITE_BACKEND_URL"], urls.api),
			VITE_R2_PUBLIC_URL: yield* plainFrom(["VITE_R2_PUBLIC_URL"], "https://cdn.hazel.sh"),
		},
	}
}).pipe(
	// StaticSite requires `never` errors; every read here has a default.
	Effect.orDie,
)

// Alchemy keys state by logical id: renaming `web` replaces the Worker behind app.hazel.sh.
export default class Web extends Cloudflare.Website.StaticSite<Web>()("web", props) {}
