import { Effect } from "effect"
import { Runtime } from "foldkit"
import { HazelRpc, HazelRpcLive } from "../rpc"
import { applyTheme, defaultCustomization, resolveSystemTheme } from "../theme"

/**
 * A gallery entry is a self-contained Foldkit program for one primitive, booted on
 * `/dev/gallery/<name>` instead of the main app. Closing over the program keeps each
 * entry fully typed while the registry only holds `start` functions.
 */
export interface GalleryEntry {
	readonly title: string
	readonly start: (container: HTMLElement) => void
}

export const defineGallery = <Model, Message extends { _tag: string }>(
	title: string,
	program: Omit<Runtime.ElementConfig<Model, Message, HazelRpc>, "container" | "resources">,
): GalleryEntry => ({
	title,
	start: (container) => {
		// Same theme effects as the app's ThemeProvider port; captures fix the color scheme, so once is enough.
		Effect.runSync(applyTheme(resolveSystemTheme(), defaultCustomization()))
		Runtime.run(
			Runtime.makeElement<Model, Message, HazelRpc>({ ...program, container, resources: HazelRpcLive }),
		)
	},
})
