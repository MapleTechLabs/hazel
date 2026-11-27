import { defineRecipe } from "../recipe.ts"
import type { ToggleStyle } from "../schema.ts"

/**
 * `toggle` (`switch.styles.ts`, `checkbox.styles.ts`): label and description beside the control;
 * `selected` is on. A switch's thumb slides (renderer motion); a checkbox draws a box in a line-high
 * cell before the label, its mark a check, or a dash while `indeterminate`.
 */
export const toggle = defineRecipe<
	{ readonly style: ToggleStyle },
	"indeterminate",
	"text" | "label" | "description" | "control" | "thumb" | "box" | "mark"
>({
	primitive: "toggle",
	parts: {
		text: "part",
		label: { kind: "part", in: "text" },
		description: { kind: "part", in: "text" },
		control: "part",
		thumb: { kind: "part", in: "control" },
		box: { kind: "part", in: "control" },
		mark: { kind: "part", in: "box" },
	},
	base: {
		root: { layout: "row", gap: "6", fill: true },
		parts: {
			text: { layout: "column", gap: "1", grow: true },
			label: { text: "body", strong: true, color: "fg" },
			description: { text: "caption", color: "muted-fg" },
			control: { layout: "row", shrink: false },
		},
	},
	options: {
		style: {
			default: "switch",
			values: {
				switch: {
					parts: {
						control: {
							radius: "full",
							background: "secondary-hover",
							paddingX: "0.5",
							paddingY: "0.5",
							// `switch.styles.ts`: `transition duration-200 ease-in-out`.
							transition: "normal",
							transitionEase: "inOut",
						},
						thumb: { size: "4.5", radius: "full", background: "bg", shadow: "xs" },
					},
					regular: { parts: { thumb: { size: "3.5" } } },
					states: { selected: { parts: { control: { background: "primary" } } } },
				},
				// `checkbox.styles.ts`: `gap-x-3`, a `size-4.5 sm:size-4` box with an `inset-ring-input`.
				checkbox: {
					root: { gap: "3" },
					parts: {
						control: { align: "center", minHeight: "6", radius: "sm" },
						box: {
							layout: "row",
							align: "center",
							justify: "center",
							size: "4.5",
							radius: "sm",
							ring: "input",
							color: "primary-fg",
							transition: "fast",
						},
						mark: { size: "4" },
					},
					regular: { parts: { box: { size: "4" }, mark: { size: "3.5" } } },
					states: {
						// Disabled and empty is a muted well: the renderer's, it needs not-selected.
						selected: { parts: { box: { background: "primary", ring: "ring" } } },
					},
				},
			},
		},
	},
	flags: {
		indeterminate: { parts: { box: { background: "primary", ring: "ring" } } },
	},
	states: { disabled: { root: { opacity: 0.5 } } },
	inert: ["disabled"],
})
