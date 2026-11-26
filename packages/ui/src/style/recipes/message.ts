import { defineRecipe } from "../recipe.ts"

/**
 * `message` (`apps/web-foldkit/src/chat/message/row.ts`): the row's box, its states as flags, and the
 * token-level look of its parts. Rich text runs, the thread spine, the reply curve, the pinned edge,
 * the hover reveals and the enter motion are renderer-owned (`web/primitives/chat/styles.ts`).
 */
export const message = defineRecipe<
	{},
	"grouped" | "pinned" | "highlighted" | "entering" | "pending" | "failed",
	| "reply"
	| "main"
	| "avatar"
	| "avatarImage"
	| "gutterTime"
	| "body"
	| "header"
	| "author"
	| "time"
	| "text"
	| "reactions"
	| "thread"
	| "failure"
	| "toolbar"
>({
	primitive: "message",
	parts: {
		reply: "part",
		main: "part",
		avatar: { kind: "part", in: "main" },
		avatarImage: { kind: "part", in: "avatar" },
		gutterTime: { kind: "part", in: "main" },
		body: { kind: "part", in: "main" },
		header: { kind: "part", in: "body" },
		author: { kind: "part", in: "header" },
		time: { kind: "part", in: "header" },
		text: { kind: "part", in: "body" },
		reactions: { kind: "part", in: "body" },
		thread: { kind: "part", in: "body" },
		failure: { kind: "part", in: "body" },
		toolbar: "part",
	},
	base: {
		root: { paddingX: "0.5", paddingY: "1", radius: "lg", color: "fg", text: "reading" },
		parts: {
			main: { layout: "row", gap: "4" },
			avatarImage: {
				layout: "row",
				align: "center",
				justify: "center",
				size: "10",
				radius: "xl",
				background: "muted",
				color: "muted-fg",
				text: "caption",
				strong: true,
				shrink: false,
			},
			gutterTime: { color: "muted-fg", text: "micro", shrink: false },
			body: { grow: true },
			header: { gap: "2" },
			author: { color: "fg" },
			time: { color: "muted-fg", text: "caption" },
			reactions: { layout: "row", wrap: true, gap: "1", rowGap: "1" },
			thread: {
				paddingX: "3",
				radius: "lg",
				borderWidth: "hairline",
				borderColor: "border",
				background: "wash",
				text: "label",
			},
			failure: { gap: "1.5", color: "danger-subtle-fg", text: "caption" },
			toolbar: {
				layout: "row",
				align: "center",
				gap: "0.5",
				paddingX: "0.5",
				paddingY: "0.5",
				radius: "lg",
				borderWidth: "hairline",
				borderColor: "border",
				background: "bg",
				shadow: "xs",
			},
		},
		states: { hover: { root: { background: "secondary" } } },
	},
	options: {},
	flags: {
		grouped: {},
		// HAZEL-GAP(chat-tints): today's pinned tint is `warning/10`; `warning-subtle` is the nearest.
		pinned: { root: { background: "warning-subtle", shadow: "xs" } },
		highlighted: { root: { background: "primary-subtle" } },
		entering: {},
		pending: { parts: { main: { opacity: 0.6 } } },
		failed: {},
	},
})
