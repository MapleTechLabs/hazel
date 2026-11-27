import { defineRecipe } from "../recipe.ts"

/**
 * `hz:list`: rows in a scroll viewport (the message list, `chat/message/list.ts`). The recipe spaces the
 * edge spinners; scrolling, anchoring, the overlay slot's place and the `loading` skeleton
 * (renderer-owned, GAPS `skeleton`) are the web renderer's (`list/list.ts`).
 */
export const list = defineRecipe<
	{ anchor: "start" | "end" },
	"stickToBottom" | "loading" | "loadingStart" | "loadingEnd" | "reorderable",
	| "viewport"
	| "content"
	| "loadingStart"
	| "loadingEnd"
	| "overlay"
	| "skeleton"
	| "skeletonAvatar"
	| "skeletonLine"
	| "spinner"
>({
	primitive: "list",
	parts: {
		viewport: "part",
		content: { kind: "part", in: "viewport" },
		overlay: { kind: "slot", in: "content" },
		loadingStart: { kind: "part", in: "viewport" },
		loadingEnd: { kind: "part", in: "viewport" },
		// The renderer's loading skeleton (`list/list.ts`): parts only motion names.
		skeleton: { kind: "part", in: "viewport" },
		skeletonAvatar: { kind: "part", in: "skeleton" },
		skeletonLine: { kind: "part", in: "skeleton" },
		// An edge spinner's three dots (in `loadingStart` and `loadingEnd`); their look is the renderer's.
		spinner: { kind: "part", in: "loadingStart" },
	},
	base: {
		root: { fill: true },
		parts: {
			viewport: { fill: true },
			content: { paddingY: "2" },
			loadingStart: { layout: "row", justify: "center", gap: "1", paddingY: "3" },
			loadingEnd: { layout: "row", justify: "center", gap: "1", paddingY: "3" },
			overlay: { gap: "2" },
		},
	},
	// A chat (`end`) insets its rows as today's list does (`px-4 py-2`).
	options: {
		anchor: { default: "start", values: { start: {}, end: { parts: { content: { paddingX: "4" } } } } },
	},
	flags: { stickToBottom: {}, loading: {}, loadingStart: {}, loadingEnd: {}, reorderable: {} },
	motion: {
		enter: [{ motion: "skeletonIn", part: "skeleton" }],
		loop: [
			{ motion: "skeletonPulse", part: "skeletonAvatar" },
			{ motion: "skeletonPulse", part: "skeletonLine" },
			// The edge spinner's pulse, 0.2s apart (`motion-renderer-loops`, `motion-stagger`).
			{ motion: "spinnerPulse", part: "spinner", stagger: 0.2 },
		],
	},
})
