import { defineRecipe } from "../recipe.ts"
import type { StatDeltaTone, StatTrend } from "../schema.ts"

/**
 * `hz:statTile` (phase 4): the KPI tile (`customers/ui/kpi-tile.ts`) on today's card (`rounded-xl
 * border bg-bg shadow-xs p-4`, `max-md:p-3`, `gap-1.5`): the label (`text-xs/5 font-medium`), the
 * value (`text-2xl/8 font-semibold`), the delta pill (`deltaPill`, green or red by `deltaTone`), the
 * comparison and the definition card. Layout, the link, the reveal and skeleton shapes are the renderer's.
 */
export const statTile = defineRecipe<
	{ readonly trend: StatTrend; readonly deltaTone: StatDeltaTone },
	"loading",
	| "link"
	| "label"
	| "term"
	| "definition"
	| "row"
	| "figure"
	| "value"
	| "detail"
	| "footer"
	| "delta"
	| "comparison"
	| "placeholder"
	| "skeletons"
	| "skeleton"
	| "skeletonLine"
	| "chart"
	| "action"
>({
	primitive: "statTile",
	parts: {
		link: "part",
		label: "part",
		term: { kind: "part", in: "label" },
		definition: { kind: "part", in: "label" },
		row: "part",
		figure: { kind: "part", in: "row" },
		value: { kind: "part", in: "figure" },
		detail: { kind: "part", in: "figure" },
		footer: "part",
		delta: { kind: "part", in: "footer" },
		comparison: { kind: "part", in: "footer" },
		placeholder: "part",
		skeletons: { kind: "part", in: "placeholder" },
		skeleton: { kind: "part", in: "skeletons" },
		skeletonLine: { kind: "part", in: "placeholder" },
		chart: { kind: "slot", in: "row" },
		action: { kind: "slot", in: "row" },
	},
	base: {
		root: {
			radius: "xl",
			borderWidth: "hairline",
			borderColor: "border",
			background: "bg",
			shadow: "xs",
			paddingX: "3",
			paddingY: "3",
			rowGap: "1.5",
		},
		regular: { root: { paddingX: "4", paddingY: "4" } },
		parts: {
			label: { text: "caption", leading: "5", strong: true, color: "muted-fg" },
			definition: {
				background: "overlay",
				color: "overlay-fg",
				borderWidth: "hairline",
				borderColor: "overlay-border",
				radius: "lg",
				shadow: "md",
				paddingX: "3",
				paddingY: "2",
				text: "caption",
				leading: "5",
			},
			value: { text: "stat", weight: "semibold", color: "fg", numeric: true },
			detail: { text: "label", color: "muted-fg", numeric: true, truncate: true },
			footer: { layout: "row", align: "center", gap: "1.5", text: "caption", leading: "5" },
			delta: {
				layout: "inline-row",
				align: "center",
				gap: "0.5",
				nowrap: true,
				strong: true,
				numeric: true,
				color: "muted-fg",
			},
			comparison: { color: "muted-fg", truncate: true },
			skeleton: { radius: "md", background: "secondary" },
			skeletonLine: { radius: "sm", background: "secondary" },
		},
	},
	options: {
		trend: {
			default: "none",
			values: { none: {}, up: {}, down: {} },
		},
		deltaTone: {
			default: "neutral",
			values: {
				neutral: {},
				success: { parts: { delta: { color: "success-subtle-fg" } } },
				danger: { parts: { delta: { color: "danger-subtle-fg" } } },
			},
		},
	},
	flags: { loading: {} },
	motion: {
		loop: [
			{ motion: "skeletonPulse", part: "skeleton" },
			{ motion: "skeletonPulse", part: "skeletonLine" },
		],
	},
})
