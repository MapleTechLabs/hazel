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
		gallery("button", {
			id: "gallery-button-pressed",
			title: "Button: pointer held down on secondary",
			themes: ["light", "dark"],
			steps: async (page) => {
				await page.getByRole("button", { name: "secondary", exact: true }).hover()
				await page.mouse.down()
			},
		}),
		gallery("button", {
			id: "gallery-button-clicked",
			title: "Button: focused by pointer (no ring), pointer moved away",
			themes: ["light", "dark"],
			steps: async (page) => {
				await page.getByRole("button", { name: "outline", exact: true }).click()
				await page.mouse.move(0, 0)
			},
		}),
		gallery("button", {
			id: "gallery-button-keyboard-pressed",
			title: "Button: Space held on the focused button",
			themes: ["light", "dark"],
			steps: async (page) => {
				await page.keyboard.press("Tab")
				await page.keyboard.down(" ")
			},
		}),
		gallery("button", {
			id: "gallery-button-pending-hover",
			title: "Button: hovering a pending button shows no hover state",
			themes: ["light", "dark"],
			steps: async (page) => {
				await page.getByRole("button", { name: /Saving/ }).hover()
			},
		}),
	],
}
