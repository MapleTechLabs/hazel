/// <reference types="vite/client" />
// Owned by lane A1 (`docs/hazel-ui.md`, "Phase 2: lanes").
import squirrel from "../../../../../../apps/web-foldkit/public/images/squirrle_ocean.webp?url"
import type { EmptyIllustration } from "../../../vocabulary/options.ts"
import { glyph } from "../../icons.ts"
import { definePrimitive, option, part, type Primitive } from "../define.ts"

/** Each `emptyIllustrations` value's asset: the web app's own picture (`page/chat/channel/view.ts`). */
const illustrations = {
	squirrel: { src: squirrel, alt: "A squirrel gazing at the ocean" },
} as const satisfies Record<
	Exclude<EmptyIllustration, "none">,
	{ readonly src: string; readonly alt: string }
>

const illustrationOf = (name: string | undefined) =>
	name !== undefined && Object.hasOwn(illustrations, name)
		? illustrations[name as keyof typeof illustrations]
		: undefined

export const primitive = definePrimitive("emptyState", ({ document, tag, outer }) => {
	const node = outer("div")
	// HAZEL-GAP(recipe-text-align): a recipe cannot centre text; the renderer does.
	node.style.textAlign = "center"
	const illustration = part(document, "img", "illustration")
	illustration.hidden = true
	// Renderer-owned asset sizing: the kit's `aspect-square w-full max-w-sm`, cropped to cover.
	illustration.style.width = "min(100%, 24rem)"
	illustration.style.aspectRatio = "1"
	illustration.style.objectFit = "cover"
	const tile = part(document, "span", "tile")
	tile.setAttribute("aria-hidden", "true")
	tile.hidden = true
	const icon = part(document, "span", "icon")
	tile.append(icon)
	const title = part(document, "h3", "title")
	const description = part(document, "p", "description")
	description.hidden = true
	description.style.maxWidth = "24rem"
	// The `action` slot lands here: the renderer's children.
	const content = part(document, "div", "content")
	node.append(illustration, tile, title, description, content)
	const primitive: Primitive = {
		tag,
		outer: node,
		content,
		set: (name, value) => {
			const text = typeof value === "string" ? value : undefined
			if (name === "title") title.textContent = text ?? ""
			else if (name === "description") {
				description.textContent = text ?? ""
				description.hidden = text === undefined || text === ""
			} else if (name === "icon") {
				glyph(icon, text)
				tile.hidden = text === undefined
			} else if (name === "illustration") {
				option(node, "illustration", value)
				const asset = illustrationOf(text)
				illustration.hidden = asset === undefined
				if (asset === undefined) illustration.removeAttribute("src")
				else {
					illustration.setAttribute("src", asset.src)
					illustration.setAttribute("alt", asset.alt)
				}
			}
		},
		events: undefined,
	}
	return primitive
})
