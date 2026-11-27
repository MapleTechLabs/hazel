import { defineRecipe } from "../recipe.ts"
import type { FieldWidth } from "../schema.ts"

type SelectPart =
	| "label"
	| "caption"
	| "control"
	| "input"
	| "icon"
	| "button"
	| "panel"
	| "listbox"
	| "group"
	| "groupTitle"
	| "option"
	| "optionCheck"
	| "optionText"
	| "optionLabel"
	| "optionDescription"
	| "content"
	| "status"

/**
 * `select` (`select.styles.ts`): a caption over the field's fill, a chevron at its end. Searchable, the
 * combo box (`combo-box.styles.ts`, `dropdown.styles.ts`): an up-down chevron button, and under the
 * field a panel (`popover.styles.ts`) with the list (group titles, rows with a check, a label and a
 * description line) and the footer slot. `width` sizes the control, not the field. Highlight,
 * placement and the status line's hiding are the renderer's.
 */
export const select = defineRecipe<{ readonly width: FieldWidth }, "placeholder", SelectPart>({
	primitive: "select",
	parts: {
		label: "part",
		caption: { kind: "part", in: "label" },
		control: { kind: "part", in: "label" },
		input: { kind: "part", in: "control" },
		icon: { kind: "part", in: "control" },
		button: { kind: "part", in: "control" },
		panel: "part",
		listbox: { kind: "part", in: "panel" },
		group: { kind: "part", in: "listbox" },
		groupTitle: { kind: "part", in: "group" },
		option: { kind: "part", in: "group" },
		optionCheck: { kind: "part", in: "option" },
		optionText: { kind: "part", in: "option" },
		optionLabel: { kind: "part", in: "optionText" },
		optionDescription: { kind: "part", in: "optionText" },
		content: { kind: "part", in: "panel" },
		status: "part",
	},
	base: {
		root: { layout: "column", fill: true },
		parts: {
			label: { layout: "column", gap: "1", fill: true },
			caption: { text: "label", strong: true, color: "fg" },
			control: {
				layout: "row",
				align: "center",
				fill: true,
				radius: "lg",
				borderWidth: "hairline",
				borderColor: "transparent",
				background: "field",
				paddingX: { step: "3.5", lessBorder: true },
				gap: "2",
				transition: "fast",
			},
			input: {
				grow: true,
				color: "fg",
				text: "body",
				background: "transparent",
				paddingY: { step: "2.5", lessBorder: true },
			},
			icon: { size: "4", color: "muted-fg", shrink: false },
			button: { size: "5", color: "muted-fg", shrink: false },
			panel: {
				layout: "column",
				radius: "xl",
				borderWidth: "hairline",
				borderColor: "overlay-border",
				background: "overlay",
				color: "overlay-fg",
				shadow: "lg",
			},
			listbox: { layout: "column", gap: "1", paddingX: "1", paddingY: "1", overflow: "scrollY" },
			group: { layout: "column", gap: "1" },
			groupTitle: { paddingX: "3", paddingY: "2", text: "label", strong: true, color: "muted-fg" },
			option: {
				layout: "row",
				align: "center",
				gap: "1.5",
				paddingX: "3",
				paddingY: "2",
				radius: "lg",
				text: "body",
				color: "fg",
			},
			optionCheck: { size: "4", shrink: false },
			optionText: { layout: "column", grow: true },
			optionLabel: { truncate: true },
			optionDescription: { text: "label", color: "muted-fg" },
			content: { layout: "column", paddingX: "1", paddingBottom: "1" },
		},
		regular: {
			parts: {
				control: { paddingX: { step: "3", lessBorder: true } },
				input: { paddingY: { step: "1.5", lessBorder: true }, leading: "6" },
				button: { size: "4" },
				groupTitle: { paddingX: "2.5", paddingY: "1.5", text: "caption", leading: "3" },
				option: { paddingX: "2.5", paddingY: "1.5", leading: "6" },
			},
		},
		states: { hover: { parts: { control: { background: "field-hover" } } } },
	},
	options: {
		// The control's width; the field keeps its row (today's `triggerClassName: "w-36"`).
		width: {
			default: "auto",
			values: {
				auto: {},
				narrow: { parts: { control: { width: "36" } } },
				regular: { regular: { parts: { control: { width: "64" } } } },
			},
		},
	},
	flags: { placeholder: { parts: { input: { color: "muted-fg" } } } },
	states: { disabled: { root: { opacity: 0.5 } } },
	inert: ["disabled"],
	motion: {
		enter: [{ motion: "fadeIn", part: "panel" }],
	},
})
