import type { Page } from "playwright"
import type { AreaModule, Scenario } from "./types.ts"

/**
 * Data-display UI kit primitives on `/dev/gallery/<name>` (tabs, toggles, lists, tables, ...).
 * Static states come from the entry; hover, focus-visible and selection changes come from steps.
 */
const gallery = (
	name: string,
	scenario: Omit<Scenario, "area" | "path" | "themes" | "fullPage"> & { readonly query?: string },
): Scenario => ({
	...scenario,
	area: "gallery",
	path: `/dev/gallery/${name}${scenario.query ?? ""}`,
	themes: ["light", "dark"],
	fullPage: true,
})

const tab = (page: Page, name: string) => page.getByRole("tab", { name, exact: true })

const tabsScenarios = [
	gallery("tabs", { id: "gallery-tabs", title: "Tabs: horizontal, vertical, icons, long labels" }),
	gallery("tabs", {
		id: "gallery-tabs-hover",
		title: "Tabs: hovered tab",
		steps: async (page) => {
			await tab(page, "Members").hover()
		},
	}),
	gallery("tabs", {
		id: "gallery-tabs-focus-visible",
		title: "Tabs: keyboard focus ring on the selected tab",
		steps: async (page) => {
			await page.keyboard.press("Tab")
		},
	}),
	gallery("tabs", {
		id: "gallery-tabs-click",
		title: "Tabs: selection changed by click",
		steps: async (page) => {
			await tab(page, "Integrations").click()
			await page.mouse.move(0, 0)
		},
	}),
	gallery("tabs", {
		id: "gallery-tabs-arrow-keys",
		title: "Tabs: arrow keys move selection and skip disabled tabs",
		steps: async (page) => {
			await page.keyboard.press("Tab")
			await page.keyboard.press("ArrowRight")
			await page.keyboard.press("ArrowRight")
			await tab(page, "Security").click()
			await page.mouse.move(0, 0)
			await page.keyboard.press("ArrowDown")
		},
	}),
]

const toggleScenarios = [
	gallery("toggle", { id: "gallery-toggle", title: "Toggle: intents, sizes, selected, disabled" }),
	gallery("toggle", {
		id: "gallery-toggle-hover",
		title: "Toggle: hovered",
		steps: async (page) => {
			await page.getByRole("button", { name: "Outline", exact: true }).hover()
		},
	}),
	gallery("toggle", {
		id: "gallery-toggle-keyboard",
		title: "Toggle: focus ring and Space toggles",
		steps: async (page) => {
			await page.keyboard.press("Tab")
			await page.keyboard.press("Tab")
			await page.keyboard.press("Space")
		},
	}),
	gallery("toggle", {
		id: "gallery-toggle-click",
		title: "Toggle: click selects and deselects",
		steps: async (page) => {
			await page.getByRole("button", { name: "Plain", exact: true }).click()
			await page.getByRole("button", { name: "Outline selected", exact: true }).click()
			await page.mouse.move(0, 0)
		},
	}),
]

const toggleGroupScenarios = [
	gallery("toggle-group", { id: "gallery-toggle-group", title: "Toggle group: single, multiple, vertical" }),
	gallery("toggle-group", {
		id: "gallery-toggle-group-hover",
		title: "Toggle group: hovered item",
		steps: async (page) => {
			await page.getByRole("radio", { name: "Left", exact: true }).hover()
		},
	}),
	gallery("toggle-group", {
		id: "gallery-toggle-group-click",
		title: "Toggle group: click selection, single and multiple",
		steps: async (page) => {
			await page.getByRole("radio", { name: "Right", exact: true }).click()
			await page.getByRole("button", { name: "Underline", exact: true }).click()
			await page.getByRole("button", { name: "Bold", exact: true }).click()
			await page.mouse.move(0, 0)
		},
	}),
	gallery("toggle-group", {
		id: "gallery-toggle-group-arrow-keys",
		title: "Toggle group: arrow keys move focus, Space selects",
		steps: async (page) => {
			await page.keyboard.press("Tab")
			await page.keyboard.press("ArrowRight")
			await page.keyboard.press("Space")
		},
	}),
]

const staticScenarios = [
	gallery("separator", { id: "gallery-separator", title: "Separator: horizontal, vertical" }),
	gallery("empty-state", { id: "gallery-empty-state", title: "Empty state: full, title only, long" }),
	gallery("section-header", {
		id: "gallery-section-header",
		title: "Section header, label and footer",
	}),
	gallery("text", { id: "gallery-text", title: "Text, strong, code, keyboard" }),
	gallery("toolbar", { id: "gallery-toolbar", title: "Toolbar: horizontal, vertical" }),
	gallery("toolbar", {
		id: "gallery-toolbar-arrow-keys",
		title: "Toolbar: arrow keys move focus",
		steps: async (page) => {
			await page.keyboard.press("Tab")
			await page.keyboard.press("ArrowRight")
			await page.keyboard.press("ArrowRight")
		},
	}),
]

export const galleryDataArea: AreaModule = {
	scenarios: [...tabsScenarios, ...toggleScenarios, ...toggleGroupScenarios, ...staticScenarios],
}
