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
	gallery("toggle-group", {
		id: "gallery-toggle-group",
		title: "Toggle group: single, multiple, vertical",
	}),
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
	gallery("loader", {
		id: "gallery-loader",
		title: "Loader: ring and spin variants",
		// The spin variant rotates with SMIL, which the harness cannot freeze.
		mask: (page) => [page.getByRole("progressbar", { name: /^Spinning/ })],
	}),
	gallery("progress-bar", {
		id: "gallery-progress-bar",
		title: "Progress bar: values, header, indeterminate",
	}),
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

const table = (page: Page, name: string) => page.getByRole("grid", { name, exact: true })

const tableScenarios = [
	gallery("table", { id: "gallery-table", title: "Table: selectable, sortable, grid, striped, empty" }),
	gallery("table", {
		id: "gallery-table-click",
		title: "Table: row selection by click",
		steps: async (page) => {
			await table(page, "Members")
				.getByRole("row", { name: /Ada Lovelace/ })
				.click()
			await page.mouse.move(0, 0)
		},
	}),
	gallery("table", {
		id: "gallery-table-arrow-keys",
		title: "Table: keyboard focus ring and arrow keys skip disabled rows",
		steps: async (page) => {
			await page.keyboard.press("Tab")
			await page.keyboard.press("ArrowDown")
			await page.keyboard.press("ArrowDown")
		},
	}),
	gallery("table", {
		id: "gallery-table-cell-keys",
		title: "Table: cell focus by click, arrow keys move between cells",
		steps: async (page) => {
			await table(page, "Members").getByRole("gridcell", { name: "Owner" }).click()
			await page.mouse.move(0, 0)
			await page.keyboard.press("ArrowDown")
			await page.keyboard.press("ArrowRight")
		},
	}),
	gallery("table", {
		id: "gallery-table-sort",
		title: "Table: sortable header hover and sort change",
		steps: async (page) => {
			const sortable = table(page, "Sortable members")
			await sortable.getByRole("columnheader", { name: "Channels" }).click()
			await sortable.getByRole("columnheader", { name: "Channels" }).click()
			await sortable.getByRole("columnheader", { name: "Name" }).hover()
		},
	}),
]

const treeRow = (page: Page, name: string) => page.getByRole("row", { name, exact: false })

const treeScenarios = [
	gallery("tree", { id: "gallery-tree", title: "Tree: nested, expanded, disabled" }),
	gallery("tree", {
		id: "gallery-tree-click",
		title: "Tree: focus by click, collapse and expand with the chevron",
		steps: async (page) => {
			await treeRow(page, "backend").click()
			await treeRow(page, "Engineering").getByRole("button").first().click()
			await treeRow(page, "Design").getByRole("button").first().click()
			await page.mouse.move(0, 0)
		},
	}),
	gallery("tree", {
		id: "gallery-tree-arrow-keys",
		title: "Tree: arrow keys move focus, expand and collapse",
		steps: async (page) => {
			await page.keyboard.press("Tab")
			await page.keyboard.press("ArrowDown")
			await page.keyboard.press("ArrowDown")
			await page.keyboard.press("ArrowDown")
			await page.keyboard.press("ArrowDown")
			await page.keyboard.press("ArrowRight")
			await page.keyboard.press("ArrowUp")
			await page.keyboard.press("ArrowUp")
			await page.keyboard.press("ArrowLeft")
		},
	}),
]

export const galleryDataArea: AreaModule = {
	scenarios: [
		...tabsScenarios,
		...toggleScenarios,
		...toggleGroupScenarios,
		...staticScenarios,
		...tableScenarios,
		...treeScenarios,
	],
}
