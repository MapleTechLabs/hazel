import { defineRecipe } from "../recipe.ts"

/** `embed` (`chat/embeds/url-embeds.ts` `linkPreviewView`): a link card with its text and image. */
export const embed = defineRecipe<{}, never, "card" | "cardText" | "title" | "description" | "site">({
	primitive: "embed",
	parts: {
		card: "part",
		cardText: { kind: "part", in: "card" },
		title: { kind: "part", in: "cardText" },
		description: { kind: "part", in: "cardText" },
		site: { kind: "part", in: "cardText" },
	},
	base: {
		parts: {
			card: {
				radius: "lg",
				borderWidth: "hairline",
				borderColor: "border",
				background: "wash",
				color: "fg",
			},
			cardText: { layout: "column", paddingX: "3", paddingY: "3" },
			// HAZEL-GAP(chat-weights): today's card title is semibold (600).
			title: { text: "label", truncate: true },
			description: { color: "fg-3", text: "caption" },
			site: { color: "accent-fg", text: "micro" },
		},
		states: { hover: { parts: { card: { background: "muted" } } } },
	},
	options: {},
})
