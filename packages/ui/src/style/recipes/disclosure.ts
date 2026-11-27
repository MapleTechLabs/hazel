import { defineRecipe } from "../recipe.ts"
import type { DisclosureTone } from "../schema.ts"

/**
 * `hz:disclosure` (phase 4): a header that shows or hides its body (`customers/ui/disclosure.ts`: a
 * chevron, then `text-xs` muted, `gap-1.5`; `ui/thought-line.ts`: `font-medium`, the body `pt-2`).
 * The body is `contents`, so the trailing slot shares the header's line; the chevron's turn, hiding
 * the closed body and the hover are the web renderer's (`structure/disclosure.ts`). An `icon` is the
 * thought line's glyph (`size-3.5`, dimmed to 55% once done); `danger` its failed step's ink.
 */
export const disclosure = defineRecipe<
	{ readonly tone: DisclosureTone },
	"open" | "running",
	"header" | "icon" | "chevron" | "title" | "subtitle" | "trailing" | "body"
>({
	primitive: "disclosure",
	parts: {
		header: "part",
		icon: { kind: "part", in: "header" },
		chevron: { kind: "part", in: "header" },
		title: { kind: "part", in: "header" },
		subtitle: { kind: "part", in: "header" },
		body: "part",
		trailing: { kind: "slot", in: "body" },
	},
	base: {
		root: { layout: "row", wrap: true, align: "center", rowGap: "2", gap: "2" },
		parts: {
			header: {
				layout: "row",
				align: "center",
				gap: "1.5",
				radius: "sm",
				text: "caption",
				strong: true,
				color: "muted-fg",
				transition: "fast",
				shrink: true,
			},
			icon: { size: "3.5", shrink: false, opacity: 0.55, transition: "slow" },
			chevron: { size: "3", shrink: false, opacity: 0.55, transition: "fast" },
			title: { truncate: true },
			subtitle: { truncate: true, opacity: 0.7 },
			body: { layout: "contents" },
			trailing: { layout: "row", align: "center", gap: "1" },
		},
	},
	options: {
		tone: {
			default: "default",
			values: { default: {}, danger: { parts: { header: { color: "danger" } } } },
		},
	},
	flags: {
		open: { parts: { chevron: { opacity: 1 } } },
		running: { parts: { icon: { opacity: 1 } } },
	},
	// While running, the title breathes (today's `thought-breathe` and sweep).
	motion: { loop: [{ motion: "skeletonPulse", part: "title" }] },
})
