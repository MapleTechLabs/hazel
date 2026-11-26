import { defineRecipe } from "../recipe.ts"

/**
 * `composer` (`chat/composer`): a bordered card holding the textarea, the `above` and `actions` slots
 * and the send button. Slot placement is renderer grid (`web/primitives/controls/styles.ts`).
 */
export const composer = defineRecipe<{}, "canSend", "content" | "input" | "send" | "above" | "actions">({
	primitive: "composer",
	parts: {
		content: "part",
		input: "part",
		send: "part",
		above: { kind: "slot", in: "content" },
		actions: { kind: "slot", in: "content" },
	},
	base: {
		root: {
			fill: true,
			radius: "xl",
			borderWidth: "hairline",
			borderColor: "border",
			background: "bg",
			shadow: "xs",
			paddingX: "2",
			paddingY: "2",
			gap: "1",
		},
		parts: {
			input: {
				fill: true,
				color: "fg",
				text: "body",
				background: "transparent",
				paddingX: "1.5",
				paddingY: "1",
			},
			send: {
				size: "8",
				layout: "row",
				align: "center",
				justify: "center",
				radius: "lg",
				background: "secondary",
				color: "muted-fg",
				transition: "fast",
			},
			above: { layout: "row", wrap: true, gap: "1" },
			actions: { layout: "row", align: "center", gap: "1" },
		},
		regular: { parts: { send: { size: "7" } } },
		states: { hover: { root: { borderColor: "border-hover" } } },
	},
	options: {},
	flags: { canSend: { parts: { send: { background: "primary", color: "primary-fg" } } } },
	states: { disabled: { root: { opacity: 0.5 } } },
	inert: ["disabled"],
})
