import type { AreaModule, Scenario } from "./types.ts"

/**
 * UI kit primitives on `/dev/gallery/<name>` (legacy `src/dev-gallery/entries`, Foldkit
 * `src/gallery/entries`). Interactive states come from steps, so they also exercise behavior.
 */
const gallery = (name: string, scenario: Omit<Scenario, "area" | "path"> & { readonly query?: string }) => ({
	...scenario,
	area: "gallery",
	path: `/dev/gallery/${name}${scenario.query ?? ""}`,
})

export const galleryArea: AreaModule = {
	scenarios: [
		gallery("button", {
			id: "gallery-button",
			title: "Button: intents, sizes, circle",
			themes: ["light", "dark"],
		}),
		gallery("button", {
			id: "gallery-button-hover",
			title: "Button: hovered primary",
			themes: ["light", "dark"],
			steps: async (page) => {
				await page.getByRole("button", { name: "primary", exact: true }).hover()
			},
		}),
		gallery("button", {
			id: "gallery-button-focus-visible",
			title: "Button: keyboard focus ring",
			themes: ["light", "dark"],
			steps: async (page) => {
				await page.keyboard.press("Tab")
			},
		}),
	],
}
