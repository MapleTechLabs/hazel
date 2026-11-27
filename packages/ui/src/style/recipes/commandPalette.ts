import { defineRecipe } from "../recipe.ts"

type Part =
	| "panel"
	| "field"
	| "fieldIcon"
	| "input"
	| "escape"
	| "results"
	| "group"
	| "groupTitle"
	| "item"
	| "itemIcon"
	| "itemFace"
	| "itemLabel"
	| "itemDescription"
	| "itemShortcut"
	| "empty"
	| "header"
	| "back"
	| "title"
	| "content"

/**
 * `hz:commandPalette` (today's `ui/command-menu-view.ts`, `command-menu.styles.ts`): a modal card with
 * the query field over grouped results, or a form page's header and body. Placement, the highlight
 * and the wide-screen key hints are the renderer's.
 */
export const commandPalette = defineRecipe<{}, never, Part>({
	primitive: "commandPalette",
	parts: {
		panel: "part",
		field: { kind: "part", in: "panel" },
		fieldIcon: { kind: "part", in: "field" },
		input: { kind: "part", in: "field" },
		escape: { kind: "part", in: "field" },
		results: { kind: "part", in: "panel" },
		group: { kind: "part", in: "results" },
		groupTitle: { kind: "part", in: "group" },
		item: { kind: "part", in: "group" },
		itemIcon: { kind: "part", in: "item" },
		itemFace: { kind: "part", in: "item" },
		itemLabel: { kind: "part", in: "item" },
		itemDescription: { kind: "part", in: "item" },
		itemShortcut: { kind: "part", in: "item" },
		empty: { kind: "part", in: "results" },
		header: { kind: "part", in: "panel" },
		back: { kind: "part", in: "header" },
		title: { kind: "part", in: "header" },
		content: { kind: "part", in: "panel" },
	},
	base: {
		root: { layout: "contents" },
		parts: {
			panel: {
				layout: "column",
				radius: "2xl",
				background: "overlay",
				color: "overlay-fg",
				shadow: "palette",
			},
			field: {
				layout: "row",
				align: "center",
				fill: true,
				paddingX: "2.5",
				paddingY: "1",
				divider: "border",
			},
			fieldIcon: { size: "5", shrink: false, color: "muted-fg" },
			input: { grow: true, paddingX: "2.5", paddingY: "2", text: "body", color: "fg" },
			escape: {
				paddingX: "1.5",
				paddingY: "0.5",
				radius: "sm",
				borderWidth: "hairline",
				borderColor: "border",
				text: "caption",
				shrink: false,
			},
			results: { layout: "column", rowGap: "3", paddingX: "2", paddingY: "2" },
			// `gap-y-[calc(var(--spacing)*0.25)]`: a pixel between rows.
			group: { layout: "column", rowGap: "px" },
			groupTitle: {
				paddingX: "2.5",
				marginBottom: "1",
				text: "caption",
				color: "muted-fg",
				truncate: true,
			},
			item: {
				layout: "row",
				align: "center",
				gap: "2.5",
				paddingX: "3",
				paddingY: "2",
				radius: "lg",
				text: "body",
				leading: "6",
				color: "fg",
			},
			itemIcon: { size: "5", shrink: false, color: "fg-2" },
			itemFace: { size: "6", shrink: false, radius: "full", text: "micro", strong: true },
			itemLabel: { grow: true, truncate: true },
			itemDescription: { text: "label", color: "muted-fg", shrink: false, nowrap: true },
			itemShortcut: { text: "tiny", leading: "6", color: "muted-fg", shrink: false, nowrap: true },
			empty: { paddingX: "4", paddingY: "4", text: "label", color: "muted-fg", textAlign: "center" },
			header: {
				layout: "row",
				align: "center",
				gap: "2",
				paddingX: "3",
				paddingY: "2.5",
				divider: "border",
			},
			back: {
				layout: "row",
				align: "center",
				justify: "center",
				size: "6",
				radius: "sm",
				color: "muted-fg",
				shrink: false,
				transition: "fast",
			},
			title: { grow: true, truncate: true, text: "label", weight: "semibold", color: "fg" },
			content: { layout: "column", rowGap: "3", paddingX: "3", paddingY: "3" },
		},
		regular: {
			parts: {
				panel: { radius: "xl" },
				input: { paddingX: "2", paddingY: "1.5" },
				item: { paddingX: "2.5", paddingY: "1.5" },
				itemIcon: { size: "4" },
				itemFace: { size: "5" },
				header: { paddingX: "2.5", paddingY: "2" },
				content: { paddingX: "2.5", paddingY: "2.5" },
			},
		},
	},
	options: {},
	motion: {
		enter: [
			{ motion: "riseIn", part: "panel", regular: "scaleIn" },
			{ motion: "scrimIn", part: "panel", backdrop: true },
		],
	},
})
