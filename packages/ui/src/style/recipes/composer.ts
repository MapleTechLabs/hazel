import { defineRecipe } from "../recipe.ts"

type Part =
	| "content"
	| "input"
	| "send"
	| "sendIcon"
	| "above"
	| "actions"
	| "quote"
	| "codeBlock"
	| "subtext"
	| "context"
	| "contextLabel"
	| "contextPrefix"
	| "contextAuthor"
	| "contextText"
	| "contextIcon"
	| "contextTitle"
	| "suggestions"
	| "suggestionGroup"
	| "suggestionEmpty"
	| "suggestion"
	| "suggestionFace"
	| "suggestionIcon"
	| "suggestionEmoji"
	| "suggestionText"
	| "suggestionLine"
	| "suggestionLabel"
	| "suggestionChip"
	| "suggestionDescription"

/**
 * `composer` (`chat/composer`): a bordered card holding the editor, the `above` and `actions` slots
 * and the send button. Slot placement is renderer grid (`web/primitives/controls/styles.ts`). Send is
 * today's `sq-xs` circle button: `plain` while empty, `primary` once it can send (`composer/view.ts`).
 * The editor's blocks (`draft-view.ts` `toDOM` classes), the reply or edit bar (`draft-view.ts`) and
 * the suggestions panel (`autocomplete-view.ts`, `trigger-views.ts`) are parts; what a recipe cannot
 * say (positions, the quote's bar, list items and markers, nested paragraphs, inline atoms and
 * markdown runs at any depth in the editor, a `/` list's row shape) is the renderer's
 * (`controls/composer-styles.ts`).
 */
export const composer = defineRecipe<{}, "canSend", Part>({
	primitive: "composer",
	parts: {
		content: "part",
		input: "part",
		send: "part",
		sendIcon: { kind: "part", in: "send" },
		above: { kind: "slot", in: "content" },
		actions: { kind: "slot", in: "content" },
		quote: { kind: "part", in: "input" },
		codeBlock: { kind: "part", in: "input" },
		subtext: { kind: "part", in: "input" },
		context: "part",
		contextLabel: { kind: "part", in: "context" },
		contextPrefix: { kind: "part", in: "contextLabel" },
		contextAuthor: { kind: "part", in: "contextLabel" },
		contextText: { kind: "part", in: "contextLabel" },
		contextIcon: { kind: "part", in: "contextLabel" },
		contextTitle: { kind: "part", in: "contextLabel" },
		suggestions: "part",
		suggestionGroup: { kind: "part", in: "suggestions" },
		suggestionEmpty: { kind: "part", in: "suggestions" },
		suggestion: { kind: "part", in: "suggestions" },
		suggestionFace: { kind: "part", in: "suggestion" },
		suggestionIcon: { kind: "part", in: "suggestion" },
		suggestionEmoji: { kind: "part", in: "suggestion" },
		suggestionText: { kind: "part", in: "suggestion" },
		suggestionLine: { kind: "part", in: "suggestionText" },
		suggestionLabel: { kind: "part", in: "suggestionLine" },
		suggestionChip: { kind: "part", in: "suggestionLine" },
		suggestionDescription: { kind: "part", in: "suggestionText" },
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
			// The editor's blocks: `my-1 pl-4 italic`, `my-2 rounded-lg bg-muted p-4 font-mono text-sm`,
			// `-#` subtext (paragraphs, which also nest in quotes, and list items are the renderer's).
			quote: { paddingStart: "4" },
			codeBlock: { paddingX: "4", paddingY: "4", radius: "lg", background: "muted", text: "code" },
			subtext: { text: "caption", color: "muted-fg" },
			// `flex items-center gap-2 border-b bg-secondary px-3 py-2` over the card's top edge.
			context: {
				layout: "row",
				align: "center",
				gap: "2",
				paddingX: "3",
				paddingY: "2",
				background: "secondary",
				divider: "border",
			},
			contextLabel: {
				layout: "row",
				align: "center",
				gap: "2",
				grow: true,
				minWidth: "0",
				text: "label",
			},
			contextPrefix: { shrink: false, color: "muted-fg" },
			contextAuthor: { truncate: true, color: "fg", weight: "semibold" },
			contextText: { truncate: true, color: "muted-fg" },
			contextIcon: { layout: "row", size: "3.5", shrink: false, color: "primary" },
			contextTitle: { color: "primary", weight: "semibold" },
			// `rounded-xl border border-fg/10 bg-overlay shadow-lg`, its list `p-2`.
			suggestions: {
				paddingX: "2",
				paddingY: "2",
				radius: "xl",
				borderWidth: "hairline",
				borderColor: "overlay-border",
				background: "overlay",
				color: "fg",
				shadow: "lg",
			},
			suggestionGroup: {
				paddingX: "3",
				paddingTop: "2",
				paddingBottom: "1",
				text: "caption",
				strong: true,
				color: "muted-fg",
			},
			// An open trigger with nothing found: `p-4 text-center text-muted-fg text-sm`.
			suggestionEmpty: {
				paddingX: "2",
				paddingY: "2",
				text: "label",
				color: "muted-fg",
				textAlign: "center",
			},
			// `flex items-center gap-2 rounded-lg px-3 py-2 text-sm`.
			suggestion: {
				layout: "row",
				align: "center",
				gap: "2",
				paddingX: "3",
				paddingY: "2",
				radius: "lg",
				text: "label",
				transition: "fast",
			},
			// Today's `avatar` `xs`: 24px over `bg-muted`.
			suggestionFace: {
				layout: "row",
				align: "center",
				justify: "center",
				size: "6",
				shrink: false,
				radius: "xl",
				background: "muted",
				color: "muted-fg",
				text: "micro",
				strong: true,
			},
			// The `@` tile: `size-6 rounded-md bg-primary text-primary-fg`.
			suggestionIcon: {
				layout: "row",
				align: "center",
				justify: "center",
				size: "6",
				shrink: false,
				radius: "md",
				background: "primary",
				color: "primary-fg",
			},
			suggestionEmoji: { shrink: false },
			suggestionText: { layout: "column", grow: true, minWidth: "0" },
			// A command's name and its argument chips: `flex flex-wrap items-center gap-1.5`.
			suggestionLine: {
				layout: "row",
				wrap: true,
				align: "center",
				gap: "1.5",
				rowGap: "1",
				minWidth: "0",
			},
			suggestionLabel: { truncate: true, strong: true },
			// `rounded px-1.5 py-0.5 text-xs`, `bg-muted text-muted-fg` or `bg-warning/20 text-warning`.
			suggestionChip: {
				paddingX: "1.5",
				paddingY: "0.5",
				radius: "sm",
				text: "caption",
				background: "muted",
				color: "muted-fg",
			},
			suggestionDescription: { truncate: true, text: "caption", color: "muted-fg" },
		},
		regular: { parts: { send: { size: "7" }, sendIcon: { size: "3" } } },
		states: { hover: { root: { borderColor: "border-hover" } } },
		// The active row is `bg-primary/10 text-primary`; another under the pointer `bg-muted`.
		partStates: {
			suggestion: {
				selected: { root: { background: "primary-tint", color: "primary" } },
				hover: { root: { background: "muted" } },
			},
			// A required argument (`<name>`) is emphasized.
			suggestionChip: { emphasized: { root: { background: "warning-chip", color: "warning" } } },
		},
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
	motion: { enter: [{ motion: "suggestionsIn", part: "suggestions" }] },
})
