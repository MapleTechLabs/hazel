import { defineRecipe } from "../recipe.ts"

type Part =
	| "panel"
	| "header"
	| "searchBox"
	| "searchIcon"
	| "search"
	| "grid"
	| "category"
	| "categoryTitle"
	| "emojis"
	| "emoji"
	| "emojiImage"
	| "status"
	| "statusTitle"
	| "footer"
	| "footerEmoji"
	| "footerImage"
	| "footerLabel"
	| "footerHint"

/**
 * `hz:emojiPicker` (today's frimousse picker, `emoji-picker/view.ts` and `dialog.ts`): a 420px panel
 * with a search field, sticky category titles over nine columns of 40px cells (36px on a phone), the
 * loading, error and empty lines, and a footer naming the emoji under the pointer. The height, the
 * columns, the sticky titles, the footer's top edge, the field's hover and focus rings are the
 * renderer's (`overlays/emojiPicker.ts`).
 */
export const emojiPicker = defineRecipe<{}, never, Part>({
	primitive: "emojiPicker",
	parts: {
		panel: "part",
		header: { kind: "part", in: "panel" },
		searchBox: { kind: "part", in: "header" },
		searchIcon: { kind: "part", in: "searchBox" },
		search: { kind: "part", in: "searchBox" },
		grid: { kind: "part", in: "panel" },
		category: { kind: "part", in: "grid" },
		categoryTitle: { kind: "part", in: "category" },
		emojis: { kind: "part", in: "category" },
		emoji: { kind: "part", in: "emojis" },
		emojiImage: { kind: "part", in: "emoji" },
		status: { kind: "part", in: "grid" },
		statusTitle: { kind: "part", in: "status" },
		footer: { kind: "part", in: "panel" },
		footerEmoji: { kind: "part", in: "footer" },
		footerImage: { kind: "part", in: "footerEmoji" },
		footerLabel: { kind: "part", in: "footer" },
		footerHint: { kind: "part", in: "footer" },
	},
	base: {
		root: { layout: "contents" },
		parts: {
			// `h-[420px] rounded-xl border border-fg/10 shadow-lg`, `bg-overlay text-overlay-fg`.
			panel: {
				layout: "column",
				radius: "xl",
				borderWidth: "hairline",
				borderColor: "overlay-border",
				background: "overlay",
				color: "overlay-fg",
				shadow: "lg",
			},
			header: { paddingX: "2", paddingTop: "2", paddingBottom: "1", shrink: false },
			// `flex h-9 items-center gap-2 rounded-lg bg-field px-2.5 text-muted-fg`.
			searchBox: {
				layout: "row",
				align: "center",
				gap: "2",
				minHeight: "9",
				paddingX: "2.5",
				radius: "lg",
				background: "field",
				color: "muted-fg",
				transition: "fast",
			},
			searchIcon: { size: "4", shrink: false },
			search: { grow: true, minWidth: "0", text: "body", color: "fg", background: "transparent" },
			grid: { layout: "column", grow: true, overflow: "scrollY", paddingBottom: "1.5" },
			category: { layout: "column" },
			// `bg-overlay px-3 pt-3 pb-1.5 font-medium text-muted-fg text-xs leading-none`.
			categoryTitle: {
				paddingX: "3",
				paddingTop: "3",
				paddingBottom: "1.5",
				background: "overlay",
				text: "caption",
				leading: "3",
				strong: true,
				color: "muted-fg",
			},
			emojis: { paddingX: "1.5" },
			// `flex size-10 items-center justify-center rounded-lg text-2xl leading-none max-md:size-9`.
			emoji: {
				layout: "row",
				align: "center",
				justify: "center",
				size: "9",
				radius: "lg",
				text: "display",
				leading: "6",
			},
			emojiImage: { size: "5.5" },
			status: {
				layout: "column",
				align: "center",
				justify: "center",
				gap: "3",
				grow: true,
				paddingX: "6",
				text: "label",
				color: "muted-fg",
				textAlign: "center",
			},
			statusTitle: { strong: true, color: "fg" },
			// `flex h-12 items-center gap-2.5 border-t px-3`.
			footer: {
				layout: "row",
				align: "center",
				gap: "2.5",
				minHeight: "12",
				paddingX: "3",
				shrink: false,
				text: "label",
			},
			footerEmoji: {
				layout: "row",
				align: "center",
				justify: "center",
				size: "8",
				shrink: false,
				text: "display",
				leading: "6",
			},
			footerImage: { size: "6" },
			footerLabel: { truncate: true, strong: true, color: "fg" },
			footerHint: { truncate: true, paddingX: "0.5", color: "muted-fg" },
		},
		regular: {
			parts: {
				search: { text: "label" },
				emoji: { size: "10" },
				emojiImage: { size: "6" },
			},
		},
		partStates: {
			emoji: { hover: { root: { background: "wash-strong" } }, selected: { root: { background: "wash-strong" } } },
		},
	},
	options: {},
	motion: {
		enter: [{ motion: "fadeIn", part: "panel" }],
	},
})
