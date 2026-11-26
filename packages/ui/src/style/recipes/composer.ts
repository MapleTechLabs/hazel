import { defineRecipe } from "../recipe.ts"

/**
 * `composer` (`chat/composer`): a bordered card holding the textarea, the `above` and `actions` slots
 * and the send button. Slot placement is renderer grid (`web/primitives/controls/styles.ts`). Send is
 * today's `sq-xs` circle button: `plain` while empty, `primary` once it can send (`composer/view.ts`).
 */
export const composer = defineRecipe<
	{},
	"canSend",
	"content" | "input" | "send" | "sendIcon" | "above" | "actions"
>({
	primitive: "composer",
	parts: {
		content: "part",
		input: "part",
		send: "part",
		sendIcon: { kind: "part", in: "send" },
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
				shrink: false,
				radius: "full",
				borderWidth: "hairline",
				borderColor: "transparent",
				background: "transparent",
				color: "muted-fg",
				transition: "fast",
			},
			sendIcon: { size: "3.5", color: "muted-fg" },
			above: { layout: "row", wrap: true, gap: "1" },
			actions: { layout: "row", align: "center", gap: "1" },
		},
		regular: { parts: { send: { size: "7" }, sendIcon: { size: "3" } } },
		states: { hover: { root: { borderColor: "border-hover" } } },
	},
	options: {},
	flags: {
		canSend: {
			parts: {
				send: { background: "primary", color: "primary-fg", shadow: "control" },
				sendIcon: { color: "primary-icon" },
			},
		},
	},
	states: { disabled: { root: { opacity: 0.5 } } },
	inert: ["disabled"],
})
