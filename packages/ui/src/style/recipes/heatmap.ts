import { defineRecipe } from "../recipe.ts"

/**
 * `hz:heatmap` (phase 4): the calendar heatmap (`charts/calendar-heatmap.ts`): month and weekday labels
 * (`text-xs leading-none text-muted-fg`), the tooltip (`rounded-lg border-fg/10 bg-overlay px-2.5 py-1.5
 * text-xs shadow-md`) and the legend (`heatLegend`: `gap-1 text-xs text-muted-fg`, `size-2.5 rounded-xs`
 * squares). Cell positions, level fills and the phone's scrolling year are the renderer's.
 */
export const heatmap = defineRecipe<
	{},
	never,
	| "scroller"
	| "grid"
	| "days"
	| "day"
	| "months"
	| "month"
	| "weekdays"
	| "weekday"
	| "tooltip"
	| "tooltipValue"
	| "tooltipDate"
	| "legend"
	| "legendLabel"
	| "swatch"
>({
	primitive: "heatmap",
	parts: {
		scroller: "part",
		grid: { kind: "part", in: "scroller" },
		days: { kind: "part", in: "grid" },
		day: { kind: "part", in: "days" },
		months: { kind: "part", in: "grid" },
		month: { kind: "part", in: "months" },
		weekdays: { kind: "part", in: "grid" },
		weekday: { kind: "part", in: "weekdays" },
		tooltip: { kind: "part", in: "grid" },
		tooltipValue: { kind: "part", in: "tooltip" },
		tooltipDate: { kind: "part", in: "tooltip" },
		legend: "part",
		legendLabel: { kind: "part", in: "legend" },
		swatch: { kind: "part", in: "legend" },
	},
	base: {
		root: {},
		parts: {
			months: { text: "caption", leading: "3", color: "muted-fg" },
			weekdays: { text: "caption", leading: "3", color: "muted-fg" },
			tooltip: {
				background: "overlay",
				color: "overlay-fg",
				borderWidth: "hairline",
				borderColor: "overlay-border",
				radius: "lg",
				shadow: "md",
				paddingX: "2.5",
				paddingY: "1.5",
				text: "caption",
			},
			tooltipValue: { strong: true, color: "fg" },
			tooltipDate: { color: "muted-fg" },
			legend: { layout: "row", align: "center", gap: "1", text: "caption", color: "muted-fg" },
			swatch: { size: "2.5", radius: "xs" },
		},
	},
	options: {},
})
