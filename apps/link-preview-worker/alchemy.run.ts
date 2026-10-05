/** The link-preview Worker: an async (non-Effect-runtime) Worker over its own `src/index.ts`. */
import { HazelStack, hazelWorkerProps, stageProps } from "@hazel/infra/cloudflare"
import * as Cloudflare from "alchemy/Cloudflare"
import { Effect } from "effect"

/** Pre-alchemy wrangler title, kept for prd so `--adopt` reuses the existing namespace. */
export const LinkCache = Cloudflare.KV.Namespace(
	"link-cache",
	stageProps("link-cache", (name, stage) => ({
		title: stage.kind === "prd" ? "link-preview-worker-link-cache" : name,
	})),
)

export default Effect.gen(function* () {
	const stack = yield* HazelStack
	const linkCache = yield* LinkCache
	return yield* Cloudflare.Worker("link-preview", {
		...hazelWorkerProps("link-preview", stack),
		main: new URL("./src/index.ts", import.meta.url).pathname,
		observability: { enabled: true },
		workersDev: stack.stage.kind !== "prd",
		domain: stack.domains.linkPreview,
		env: { LINK_CACHE: linkCache },
	})
})
