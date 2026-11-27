import { defineRecipe } from "../recipe.ts"
import type { ChoiceStyle } from "../schema.ts"

/**
 * `hz:choiceGroup` (phase 4): radio rows (`radio.styles.ts`), choice cards (`choice-box.styles.ts`), the
 * segmented control (`segmented-control.ts`), toggle chips (`toggle-chip.ts`) and colour swatches
 * (`appearance/view.ts`). An option's own selected and hover looks are part states; its focus rings,
 * the cards' grid and joined column, the invalid edge and a selected segment's raised edge are the
 * web renderer's (`controls/choice-styles.ts`).
 */
type Part =
	| "label"
	| "description"
	| "options"
	| "option"
	| "indicator"
	| "box"
	| "mark"
	| "optionIcon"
	| "optionText"
	| "optionImage"
	| "optionLabel"
	| "optionDescription"
	| "optionBadge"
	| "error"

export const choiceGroup = defineRecipe<
	{ readonly style: ChoiceStyle; readonly columns: "1" | "2" | "3" },
	"multiple",
	Part
>({
	primitive: "choiceGroup",
	parts: {
		label: "part",
		description: "part",
		options: "part",
		option: { kind: "part", in: "options" },
		indicator: { kind: "part", in: "option" },
		box: { kind: "part", in: "indicator" },
		mark: { kind: "part", in: "box" },
		optionIcon: { kind: "part", in: "option" },
		optionText: { kind: "part", in: "option" },
		optionImage: { kind: "part", in: "optionText" },
		optionLabel: { kind: "part", in: "optionText" },
		optionDescription: { kind: "part", in: "optionText" },
		optionBadge: { kind: "part", in: "option" },
		error: "part",
	},
	base: {
		root: { layout: "column", rowGap: "2", fill: true },
		parts: {
			label: { text: "body", strong: true, color: "fg" },
			description: { text: "caption", color: "muted-fg" },
			error: { text: "caption", color: "danger-subtle-fg" },
			// Radio rows: `space-y-3`, the dot in a line-high cell beside the label (`radioLayoutStyles`).
			options: { layout: "column", rowGap: "3" },
			option: { layout: "row", align: "start", gap: "3", text: "body", color: "fg" },
			indicator: { layout: "row", align: "center", minHeight: "6", shrink: false },
			box: {
				layout: "row",
				align: "center",
				justify: "center",
				size: "4.5",
				shrink: false,
				radius: "full",
				ring: "input",
				color: "primary-fg",
				transition: "fast",
			},
			mark: { size: "2", radius: "full" },
			optionIcon: { size: "5", shrink: false, color: "muted-fg" },
			optionText: { layout: "column", rowGap: "1", grow: true },
			optionImage: { fill: true, radius: "md" },
			optionLabel: { text: "body", color: "fg" },
			optionDescription: { text: "body", color: "muted-fg" },
			optionBadge: { text: "caption", numeric: true, color: "muted-fg", shrink: false },
		},
		regular: { parts: { box: { size: "4" } } },
		// A chosen radio fills with the brand and shows its dot (`radio.styles.ts`).
		partStates: {
			option: {
				selected: { parts: { box: { background: "primary", ring: "primary" }, mark: { background: "bg" } } },
			},
		},
	},
	flags: {
		// Checkbox rows: the box is square (`checkbox.styles.ts` `rounded`), its mark the check.
		multiple: {
			parts: { box: { radius: "sm" }, mark: { size: "4", radius: "none" } },
			regular: { parts: { mark: { size: "3.5" } } },
			// A checked box keeps the ring's edge and draws the check, not a dot (`checkbox.styles.ts`).
			partStates: {
				option: {
					selected: { parts: { box: { ring: "ring" }, mark: { background: "transparent" } } },
					hover: { parts: { box: { ring: "control-hover-edge" }, mark: { background: "transparent" } } },
				},
			},
		},
	},
	options: {
		style: {
			default: "list",
			values: {
				list: {
					partStates: { option: { hover: { parts: { mark: { background: "control-hover-fill" } } } } },
				},
				// The choice box: an inset-ringed card, `p-3 sm:p-4`, medium label, check at the end.
				cards: {
					parts: {
						option: { ring: "border", radius: "lg", paddingX: "3", paddingY: "3", gap: "3" },
						optionLabel: { strong: true },
					},
					regular: { parts: { option: { paddingX: "4", paddingY: "4" } } },
					partStates: {
						option: {
							hover: { root: { ring: "control-hover-edge" } },
							selected: {
								root: { background: "primary-subtle", color: "primary-subtle-fg", ring: "focus-ring" },
								parts: {
									optionLabel: { color: "primary-subtle-fg" },
									optionDescription: { color: "primary-subtle-fg" },
									optionIcon: { color: "primary-subtle-fg" },
								},
							},
						},
					},
				},
				// `segmentedTrackClass` and `segmentClass`; `max-md:h-9 max-md:text-sm` is the compact class.
				segmented: {
					root: { align: "start" },
					parts: {
						options: {
							layout: "inline-row",
							align: "center",
							gap: "0.5",
							radius: "lg",
							background: "secondary-track",
							paddingX: "0.5",
							paddingY: "0.5",
						},
						option: {
							layout: "inline-row",
							align: "center",
							gap: "1.5",
							minHeight: "9",
							paddingX: "2.5",
							radius: "md",
							text: "label",
							strong: true,
							numeric: true,
							nowrap: true,
							color: "muted-fg",
							transition: "fast",
						},
						optionText: { layout: "row", rowGap: "0" },
						optionLabel: { text: "label", color: "muted-fg" },
						optionIcon: { size: "4" },
					},
					regular: {
						parts: {
							option: { minHeight: "7", text: "caption" },
							optionLabel: { text: "caption" },
						},
					},
					partStates: {
						option: {
							hover: { parts: { optionLabel: { color: "fg" } } },
							selected: { root: { background: "bg" }, parts: { optionLabel: { color: "fg" } } },
						},
					},
				},
				// `toggleChip`: `h-8 sm:h-7 px-2.5 rounded-md border font-medium text-sm`.
				chips: {
					root: { align: "start" },
					parts: {
						options: { layout: "row", wrap: true, gap: "2", rowGap: "2" },
						option: {
							layout: "inline-row",
							align: "center",
							justify: "center",
							gap: "1.5",
							minHeight: "8",
							paddingX: "2.5",
							radius: "md",
							borderWidth: "hairline",
							borderColor: "border",
							text: "label",
							strong: true,
							nowrap: true,
							color: "muted-fg",
							transition: "fast",
						},
						optionText: { layout: "row", rowGap: "0" },
						optionLabel: { text: "label", color: "muted-fg", truncate: true },
						optionIcon: { size: "4" },
					},
					regular: { parts: { option: { minHeight: "7" } } },
					partStates: {
						option: {
							hover: { root: { background: "secondary" }, parts: { optionLabel: { color: "fg" } } },
							selected: {
								root: { background: "chip-selected", borderColor: "chip-selected-border" },
								parts: { optionLabel: { color: "fg" } },
							},
						},
					},
				},
				// The brand colour picker: `size-7 max-md:size-8 rounded-full`, a hairline edge.
				swatches: {
					root: { align: "start" },
					parts: {
						options: { layout: "row", wrap: true, gap: "2", rowGap: "2" },
						option: { radius: "full" },
						indicator: { minHeight: "0" },
						box: { size: "8", ring: "swatch-edge" },
					},
					regular: { parts: { box: { size: "7" } } },
				},
			},
		},
		columns: { default: "1", values: { "1": {}, "2": {}, "3": {} } },
	},
	compounds: [
		// `gap-4` between cards in a grid; a single column joins them into one ringed stack (renderer).
		{ when: { style: "cards", columns: "1" }, style: { parts: { options: { rowGap: "0" } } } },
		{ when: { style: "cards", columns: "2" }, style: { parts: { options: { gap: "4", rowGap: "4" } } } },
		{ when: { style: "cards", columns: "3" }, style: { parts: { options: { gap: "4", rowGap: "4" } } } },
	],
	states: { disabled: { root: { opacity: 0.5 } } },
	inert: ["disabled"],
})
