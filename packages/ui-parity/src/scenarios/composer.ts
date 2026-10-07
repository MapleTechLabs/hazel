import type { AreaModule, Scenario } from "./types.ts"

/**
 * The channel composer on `/dev/gallery/composer` (legacy `SlateMessageComposer`, Foldkit
 * ProseMirror Mount). The chat shell is not ported yet, so the composer is compared alone.
 * The editor is a combobox with no accessible name (README, known gaps).
 */
const composer = (scenario: Omit<Scenario, "area" | "path">): Scenario => ({
	...scenario,
	area: "chat",
	path: "/dev/gallery/composer",
})

const editor = (page: Parameters<NonNullable<Scenario["steps"]>>[0]) => page.getByRole("combobox")

export const composerArea: AreaModule = {
	scenarios: [
		composer({ id: "composer-empty", title: "Composer: empty with placeholder", themes: ["light", "dark"] }),
		composer({
			id: "composer-focused",
			title: "Composer: focused with draft text",
			themes: ["light", "dark"],
			steps: async (page) => {
				await editor(page).click()
				await page.keyboard.type("Draft reply with **bold** text")
			},
		}),
		composer({
			id: "composer-with-draft",
			title: "Composer: multi-line draft with bold, italic, code and a mention",
			themes: ["light", "dark"],
			steps: async (page) => {
				await editor(page).click()
				await page.keyboard.type("Release notes are **ready** for review")
				await page.keyboard.press("Shift+Enter")
				await page.keyboard.type("Please check the _wording_ and the `sync` section")
				await page.keyboard.press("Shift+Enter")
				await page.keyboard.type("cc @gr")
				await page.getByRole("option", { name: "Grace Hopper" }).waitFor()
				await page.keyboard.press("Enter")
				await page.keyboard.type(" thanks!")
			},
		}),
		composer({
			id: "composer-mention-autocomplete",
			title: "Composer: mention autocomplete open",
			themes: ["light", "dark"],
			steps: async (page) => {
				await editor(page).click()
				await page.keyboard.type("Hey @g")
				await page.getByRole("listbox").waitFor()
			},
		}),
	],
}
