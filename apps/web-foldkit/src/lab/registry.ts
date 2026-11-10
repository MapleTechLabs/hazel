/**
 * The lab's catalogue. Registration is the file: every `src/lab/entries/**\/*.ts` that exports
 * `lab` is a page at `/lab/<path>` and is listed on `/lab`, grouped by folder. `LAB_DESCRIPTIONS`
 * only adds a line under a page's name; `registry.test.ts` checks it names real entries.
 */

export const LAB_ROOT = "/lab"

/** `./entries/customers/kit/badges.ts` → `/lab/customers/kit/badges`. */
export const labPathOfFile = (file: string): string =>
	file.replace(/^\.\/entries\//, `${LAB_ROOT}/`).replace(/\.ts$/, "")

/** `/lab/customers/kit/kpi-tiles` → `Kpi tiles`. */
export const labNameOf = (path: string): string => {
	const last = path.split("/").pop() ?? path
	const words = last.replace(/-/g, " ")
	return words.charAt(0).toUpperCase() + words.slice(1)
}

/** `/lab/customers/kit/badges` → `customers/kit`; top-level entries → ``. */
export const labGroupOf = (path: string): string =>
	path
		.slice(LAB_ROOT.length + 1)
		.split("/")
		.slice(0, -1)
		.join("/")

/** One line per page on `/lab` (optional). Page agents: ask the kit owner, or leave it out. */
export const LAB_DESCRIPTIONS: ReadonlyMap<string, string> = new Map([
	["/lab/customers/kit/tokens", "Chart, health and severity color tokens in light and dark."],
	[
		"/lab/customers/kit/badges",
		"Health badges and dots, severity and kind chips, lifecycle stages, open-signal counts.",
	],
	["/lab/customers/kit/identity", "Company logos and tints, owner avatars, source marks and chips."],
	[
		"/lab/customers/kit/kpi-tiles",
		"KPI tiles: positive, negative, neutral, ratio, loading, empty; definitions on hover.",
	],
	["/lab/customers/kit/sparklines", "Sparklines, mini bars, the limit meter and evidence bars."],
	["/lab/customers/kit/evidence", "Every evidence viz, compact (queue) and detailed (side panel)."],
	[
		"/lab/customers/kit/charts",
		"Active users lines, MRR movement bars, health distribution, with hover tooltips (`?range=`).",
	],
	[
		"/lab/customers/kit/table",
		"The customers table: sort, select, hover actions, loading, footer (`?state=`).",
	],
	[
		"/lab/customers/kit/queue",
		"Queue rows: default, hover actions, keyboard focus, selected, opportunity.",
	],
	[
		"/lab/customers/kit/controls",
		"View tabs, range picker, search, filter chips, sort, segmented toggles, shortcut bar.",
	],
	["/lab/customers/kit/menus", "The snooze menu and the row actions menu, live."],
	["/lab/customers/kit/empty-states", "All clear, connect a data source, no results."],
	["/lab/customers/kit/connect-cards", "Data source cards: connected, syncing, not connected, failing."],
])
