/// <reference types="vite/client" />
// Owned by lane A1 (`docs/hazel-ui.md`, "Phase 2: lanes").
import squirrel from "../../../../../../apps/web-foldkit/public/images/squirrle_ocean.webp?url"
import mask from "../../../../../../apps/web-foldkit/public/images/image-mask.webp?url"
import type { EmptyIllustration } from "../../../vocabulary/options.ts"
import { glyph } from "../../icons.ts"
import { definePrimitive, option, part, type Primitive } from "../define.ts"

/**
 * Each `emptyIllustrations` value's asset and the mask its edges dissolve through (renderer-owned, as
 * `emptyStateView`'s `mask-[url(/images/image-mask.webp)] mask-size-[110%_90%] mask-center`).
 */
const illustrations = {
	squirrel: { src: squirrel, alt: "A squirrel gazing at the ocean", mask },
} as const satisfies Record<
	Exclude<EmptyIllustration, "none">,
	{ readonly src: string; readonly alt: string; readonly mask: string }
>

const illustrationOf = (name: string | undefined) =>
	name !== undefined && Object.hasOwn(illustrations, name)
		? illustrations[name as keyof typeof illustrations]
		: undefined

export const primitive = definePrimitive("emptyState", ({ document, tag, outer }) => {
	const node = outer("div")
	const illustration = part(document, "img", "illustration")
	illustration.hidden = true
	// The recipe's `size` is its width (a phone's small, a desk's 24rem); square, never wider than
	// the column, cropped to cover.
	illustration.style.maxWidth = "min(100%, 24rem)"
	illustration.style.height = "auto"
	illustration.style.aspectRatio = "1"
	illustration.style.objectFit = "cover"
	illustration.style.maskSize = "110% 90%"
	illustration.style.maskPosition = "center"
	illustration.style.maskRepeat = "no-repeat"
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
				illustration.style.maskImage = asset === undefined ? "" : `url("${asset.mask}")`
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
