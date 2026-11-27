import { defineRecipe } from "../recipe.ts"

/**
 * `hz:disclosure` (phase 4): a header that shows or hides its body (`customers/ui/disclosure.ts`: a
 * chevron, then `text-xs` muted, `gap-1.5`; `ui/thought-line.ts`: `font-medium`, the body `pt-2`).
 * The body is `contents`, so the trailing slot shares the header's line; the chevron's turn, hiding
 * the closed body and the hover are the web renderer's (`structure/disclosure.ts`).
 */
export const disclosure = defineRecipe<
	{},
	"open" | "running",
	"header" | "chevron" | "title" | "subtitle" | "trailing" | "body"
>({
	primitive: "disclosure",
	parts: {
		header: "part",
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
			chevron: { size: "3", shrink: false, opacity: 0.55, transition: "fast" },
			title: { truncate: true },
			subtitle: { truncate: true, opacity: 0.7 },
			body: { layout: "contents" },
			trailing: { layout: "row", align: "center", gap: "1" },
		},
	},
	options: {},
	flags: {
		open: { parts: { chevron: { opacity: 1 } } },
		running: {},
	},
	// While running, the title breathes (today's `thought-breathe` and sweep).
	motion: { loop: [{ motion: "skeletonPulse", part: "title" }] },
})
