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
		root: { layout: "row", align: "center", paddingX: "4", paddingY: "2", fill: true },
		parts: {
			lineStart: { grow: true, divider: "border" },
			lineEnd: { grow: true, divider: "border" },
			label: { text: "caption", nowrap: true, shrink: false },
		},
	},
	options: {
		kind: {
			default: "date",
			values: {
				// Today's date pill (`chat/message/row.ts` `dateDividerView`); its mono family is the renderer's.
				date: {
					parts: {
						label: {
							color: "muted-fg",
							paddingX: "3",
							paddingY: "1",
							radius: "lg",
							background: "secondary",
							shadow: "sm",
						},
					},
				},
				unread: {
					root: { gap: "2" },
					parts: {
						lineStart: { divider: "danger" },
						label: {
							strong: true,
							color: "danger-subtle-fg",
							paddingX: "2",
							paddingY: "0.5",
							radius: "full",
							ring: "danger-subtle",
							background: "danger-subtle",
						},
					},
				},
			},
		},
	},
})
