import { defineRecipe } from "../recipe.ts"

/**
 * `hz:listDivider`: today's date separator (a pill on a hairline, `chat/message/list.ts`) and the
 * unread line (danger ink, the label at the end). The unread kind drops `lineEnd` in the renderer.
 */
export const listDivider = defineRecipe<
	{ kind: "date" | "unread" },
	never,
	"lineStart" | "label" | "lineEnd"
>({
	primitive: "listDivider",
	parts: { lineStart: "part", label: "part", lineEnd: "part" },
	base: {
		root: { layout: "row", align: "center", gap: "2", paddingX: "4", paddingY: "2", fill: true },
		parts: {
			lineStart: { grow: true, divider: "border" },
			lineEnd: { grow: true, divider: "border" },
			label: {
				text: "caption",
				strong: true,
				color: "fg-3",
				paddingX: "2",
				paddingY: "0.5",
				radius: "full",
				ring: "border",
				background: "bg",
				nowrap: true,
				shrink: false,
			},
		},
	},
	options: {
		kind: {
			default: "date",
			values: {
				date: {},
				unread: {
					parts: {
						lineStart: { divider: "danger" },
						label: {
							color: "danger-subtle-fg",
							ring: "danger-subtle",
							background: "danger-subtle",
						},
					},
				},
			},
		},
	},
})
