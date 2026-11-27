import { defineRecipe } from "../recipe.ts"

/**
 * `hz:datePicker` (`date-field.styles.ts`, `date-picker.styles.ts`, `calendar.styles.ts`): a caption,
 * the field (segments, clear and calendar buttons on the field's fill), description and error lines,
 * and the calendar popover. Per-day and per-segment states (focus, selected, today) are the renderer's.
 */
export const datePicker = defineRecipe<
	{ granularity: "date" | "time" | "dateTime" },
	"invalid" | "open",
	| "label"
	| "field"
	| "segments"
	| "segment"
	| "clear"
	| "clearIcon"
	| "trigger"
	| "triggerIcon"
	| "description"
	| "error"
	| "panel"
	| "calendar"
	| "header"
	| "pickers"
	| "month"
	| "year"
	| "pages"
	| "previous"
	| "previousIcon"
	| "next"
	| "nextIcon"
	| "grid"
	| "weekdays"
	| "weekday"
	| "week"
	| "cell"
	| "day"
>({
	primitive: "datePicker",
	parts: {
		label: "part",
		field: "part",
		segments: { kind: "part", in: "field" },
		segment: { kind: "part", in: "segments" },
		clear: { kind: "part", in: "field" },
		clearIcon: { kind: "part", in: "clear" },
		trigger: { kind: "part", in: "field" },
		triggerIcon: { kind: "part", in: "trigger" },
		description: "part",
		error: "part",
		panel: "part",
		calendar: { kind: "part", in: "panel" },
		header: { kind: "part", in: "calendar" },
		pickers: { kind: "part", in: "header" },
		month: { kind: "part", in: "pickers" },
		year: { kind: "part", in: "pickers" },
		pages: { kind: "part", in: "header" },
		previous: { kind: "part", in: "pages" },
		previousIcon: { kind: "part", in: "previous" },
		next: { kind: "part", in: "pages" },
		nextIcon: { kind: "part", in: "next" },
		grid: { kind: "part", in: "calendar" },
		weekdays: { kind: "part", in: "grid" },
		weekday: { kind: "part", in: "weekdays" },
		week: { kind: "part", in: "grid" },
		cell: { kind: "part", in: "week" },
		day: { kind: "part", in: "cell" },
	},
	base: {
		// `fieldStyles`: the label, then the control `mt-2`, then the description or error `mt-2`.
		root: { layout: "column", rowGap: "2", fill: true },
		parts: {
			label: { text: "body", strong: true, color: "fg" },
			// The kit's date input (`dateInputStyles`) and its group, as one row on the field's fill.
			field: {
				layout: "row",
				align: "center",
				fill: true,
				radius: "lg",
				borderWidth: "hairline",
				borderColor: "transparent",
				background: "field",
				color: "fg",
				text: "body",
				transition: "fast",
			},
			segments: {
				grow: true,
				paddingX: { step: "3.5", lessBorder: true },
				paddingY: { step: "2.5", lessBorder: true },
			},
			// Colours are the renderer's: focus and placeholder states, which a recipe cannot reach per segment.
			segment: { radius: "sm", paddingX: "1", paddingY: "0.5", numeric: true },
			clear: {
				layout: "row",
				align: "center",
				justify: "center",
				shrink: false,
				color: "muted-fg",
				paddingX: "1",
				paddingY: { step: "2.5", lessBorder: true },
			},
			clearIcon: { size: "3.5" },
			// `datePickerTriggerClassName`: as wide as the kit's `pr-11` gutter, the icon centred.
			trigger: {
				layout: "row",
				align: "center",
				justify: "center",
				shrink: false,
				color: "muted-fg",
				paddingX: { step: "3.5", lessBorder: true },
				paddingY: { step: "2.5", lessBorder: true },
				transition: "fast",
			},
			triggerIcon: { size: "4.5" },
			description: { text: "label", color: "muted-fg" },
			error: { text: "label", color: "danger-subtle-fg" },
			// `popoverContentBase` with `datePickerOverlayClassName(1)`.
			panel: {
				layout: "column",
				radius: "xl",
				borderWidth: "hairline",
				borderColor: "overlay-border",
				background: "overlay",
				color: "overlay-fg",
				shadow: "lg",
				paddingX: "4",
				paddingY: "4",
			},
			calendar: { layout: "column" },
			// `calendarHeaderClassName`: `pt-1 pr-1 pb-5 pl-1.5`.
			header: {
				layout: "row",
				align: "center",
				gap: "1.5",
				paddingX: "1",
				paddingStart: "1.5",
				paddingTop: "1",
				paddingBottom: "5",
			},
			pickers: { layout: "row", align: "center", gap: "1.5", grow: true },
			// The month and year Select triggers (`selectTriggerBase` with the calendar's overrides).
			month: {
				radius: "lg",
				borderWidth: "hairline",
				borderColor: "transparent",
				background: "field",
				color: "fg",
				text: "label",
				paddingX: { step: "3.5", lessBorder: true },
				paddingY: { step: "2.5", lessBorder: true },
				minWidth: "20",
			},
			year: {
				radius: "lg",
				borderWidth: "hairline",
				borderColor: "transparent",
				background: "field",
				color: "fg",
				text: "label",
				paddingX: { step: "3.5", lessBorder: true },
				paddingY: { step: "2.5", lessBorder: true },
			},
			pages: { layout: "row", align: "center", gap: "1" },
			// Plain circle buttons (`sq-sm`, `calendarNavButtonClassName`).
			previous: {
				layout: "row",
				align: "center",
				justify: "center",
				size: "8",
				radius: "full",
				color: "fg",
				transition: "fast",
			},
			previousIcon: { size: "4.5" },
			next: {
				layout: "row",
				align: "center",
				justify: "center",
				size: "8",
				radius: "full",
				color: "fg",
				transition: "fast",
			},
			nextIcon: { size: "4.5" },
			grid: { layout: "column" },
			weekdays: { layout: "row" },
			// `calendarHeaderCellClassName`.
			weekday: {
				minWidth: "11",
				paddingBottom: "2",
				text: "label",
				leading: "6",
				weight: "semibold",
				color: "muted-fg",
				textAlign: "center",
			},
			week: { layout: "row" },
			// `calendarCellClassName`; its colours follow the day's state (renderer).
			day: {
				layout: "row",
				align: "center",
				justify: "center",
				size: "11",
				radius: "lg",
				numeric: true,
			},
		},
		regular: {
			parts: {
				label: { leading: "6" },
				field: { leading: "6" },
				segments: {
					paddingX: { step: "3", lessBorder: true },
					paddingY: { step: "1.5", lessBorder: true },
				},
				clear: { paddingY: { step: "1.5", lessBorder: true } },
				trigger: {
					paddingX: { step: "3", lessBorder: true },
					paddingY: { step: "1.5", lessBorder: true },
				},
				triggerIcon: { size: "4" },
				description: { leading: "6" },
				error: { leading: "6" },
				panel: { paddingX: "2", paddingTop: "3", paddingBottom: "2", text: "label" },
				header: { paddingBottom: "4" },
				month: { paddingX: "2.5", paddingY: "1.5" },
				year: { paddingX: "2.5", paddingY: "1.5" },
				previous: { size: "7" },
				previousIcon: { size: "4" },
				next: { size: "7" },
				nextIcon: { size: "4" },
				weekday: { minWidth: "9", paddingTop: "0.5", paddingBottom: "0.5" },
				day: { size: "9", text: "label", leading: "6" },
			},
		},
	},
	options: {
		granularity: {
			default: "date",
			values: { date: {}, time: {}, dateTime: {} },
		},
	},
	flags: {
		invalid: { parts: { field: { borderColor: "invalid-border" } } },
		open: { parts: { field: { borderColor: "focus-ring" } } },
	},
	states: {
		disabled: {
			parts: {
				label: { opacity: 0.5 },
				field: { background: "muted" },
				description: { opacity: 0.5 },
				error: { opacity: 0.5 },
			},
		},
	},
	inert: ["disabled"],
	motion: {
		enter: [
			{ motion: "fieldErrorIn", part: "error" },
			{ motion: "fadeIn", part: "panel" },
		],
	},
})
