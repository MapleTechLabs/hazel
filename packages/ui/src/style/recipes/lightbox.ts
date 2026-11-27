import { defineRecipe } from "../recipe.ts"
import { type MenuListPart, menuListParts, menuListStyles } from "./menu.ts"

type LightboxPart =
	| "stage"
	| "backdrop"
	| "viewport"
	| "slides"
	| "slide"
	| "zoom"
	| "media"
	| "file"
	| "live"
	| "counter"
	| "step"
	| "stepIcon"
	| "toolbar"
	| "tool"
	| "toolIcon"
	| "strip"
	| "thumbs"
	| "thumb"
	| "thumbMedia"
	| "thumbIcon"
	| "menu"
	| "author"
	| "authorAvatar"
	| "authorImage"
	| "authorInitial"
	| "authorLines"
	| "authorName"
	| "authorMeta"
	| "caption"
	| "captionTitle"
	| "captionDescription"
	| MenuListPart

/**
 * `hz:lightbox` (today's `chat/image-viewer.ts`): the stage over the page with the slides, a counter,
 * the step buttons, the toolbar (zoom, the entries, close), the thumbnail strip, and the entries again
 * as the image's right-click menu (`menu.ts`). Placement, the track and the dark palette are the
 * renderer's (`web/primitives/overlays/lightbox-styles.ts`).
 */
export const lightbox = defineRecipe<{}, never, LightboxPart>({
	primitive: "lightbox",
	parts: {
		stage: "part",
		backdrop: { kind: "part", in: "stage" },
		viewport: { kind: "part", in: "stage" },
		slides: { kind: "part", in: "viewport" },
		slide: { kind: "part", in: "slides" },
		zoom: { kind: "part", in: "slide" },
		media: { kind: "part", in: "zoom" },
		file: { kind: "part", in: "zoom" },
		live: { kind: "part", in: "stage" },
		counter: { kind: "part", in: "stage" },
		step: { kind: "part", in: "stage" },
		stepIcon: { kind: "part", in: "step" },
		toolbar: { kind: "part", in: "stage" },
		tool: { kind: "part", in: "toolbar" },
		toolIcon: { kind: "part", in: "tool" },
		strip: { kind: "part", in: "stage" },
		thumbs: { kind: "part", in: "strip" },
		thumb: { kind: "part", in: "thumbs" },
		thumbMedia: { kind: "part", in: "thumb" },
		thumbIcon: { kind: "part", in: "thumb" },
		menu: { kind: "part", in: "stage" },
		author: { kind: "part", in: "stage" },
		authorAvatar: { kind: "part", in: "author" },
		authorImage: { kind: "part", in: "authorAvatar" },
		authorInitial: { kind: "part", in: "authorAvatar" },
		authorLines: { kind: "part", in: "author" },
		authorName: { kind: "part", in: "authorLines" },
		authorMeta: { kind: "part", in: "authorLines" },
		caption: { kind: "part", in: "slide" },
		captionTitle: { kind: "part", in: "caption" },
		captionDescription: { kind: "part", in: "caption" },
		...menuListParts,
		panel: { kind: "part", in: "menu" },
	},
	base: {
		root: { layout: "contents" },
		parts: {
			...menuListStyles,
			stage: { color: "lightbox-fg" },
			backdrop: { background: "lightbox-scrim" },
			media: { radius: "md" },
			file: { text: "body", strong: true },
			counter: {
				paddingX: "3",
				paddingY: "1.5",
				radius: "md",
				text: "label",
				numeric: true,
				background: "lightbox-chrome",
			},
			step: {
				layout: "row",
				align: "center",
				justify: "center",
				size: "11",
				radius: "full",
				background: "lightbox-chrome",
			},
			stepIcon: { size: "5" },
			toolbar: {
				layout: "row",
				gap: "1",
				paddingX: "1",
				paddingY: "1",
				radius: "md",
				borderWidth: "hairline",
				borderColor: "lightbox-edge",
				background: "lightbox-chrome",
			},
			tool: { layout: "row", align: "center", justify: "center", size: "10", radius: "lg" },
			toolIcon: { size: "4.5", shrink: false },
			thumbs: { layout: "row", gap: "2", radius: "md", overflow: "scrollX" },
			thumb: { radius: "md" },
			thumbIcon: { size: "6" },
			// Today's author: an `md` avatar beside the name (`text-sm` white) over the time (`text-xs`).
			author: { layout: "row", align: "center", gap: "2" },
			authorAvatar: { size: "10", radius: "xl", background: "muted", shrink: false },
			authorLines: { layout: "column" },
			authorName: { text: "label", color: "lightbox-fg" },
			authorMeta: { text: "caption", color: "muted-fg" },
			// An embed image's caption: the title `text-sm` medium, the description `text-xs` at 60%.
			caption: { textAlign: "center" },
			captionTitle: { text: "label", strong: true, color: "lightbox-fg" },
			captionDescription: { text: "caption", color: "lightbox-muted" },
		},
		regular: {
			parts: {
				item: { minHeight: "8", text: "label" },
				step: { size: "9" },
				stepIcon: { size: "4.5" },
				tool: { size: "8" },
				toolIcon: { size: "4" },
			},
		},
	},
	options: {},
	motion: {
		// Where no View Transition carries the image in (reduced motion, an older engine), it fades.
		enter: [
			{ motion: "scrimIn", part: "stage" },
			{ motion: "fadeIn", part: "panel" },
		],
	},
})
