/**
 * `hz:embed` (lane A5): a link preview card (`chat/embeds/url-embeds.ts` `linkPreviewView`). The
 * host raises `press` from the click; while the view handles it the link does not navigate.
 */
import type { Embed } from "../../../vocabulary/content.ts"
import { definePrimitive, type Primitive } from "../define.ts"
import { batched, embedCard, ensureStyles, handles } from "./shared.ts"

const isEmbed = (value: unknown): value is Embed =>
	typeof value === "object" && value !== null && "url" in value && typeof value.url === "string"

export const primitive = definePrimitive("embed", ({ document, tag, outer }) => {
	ensureStyles(document)
	const node = outer("div")
	let embed: Embed | undefined
	const draw = batched(() => {
		node.replaceChildren()
		if (embed === undefined) return
		node.append(
			embedCard(document, embed, (event) => {
				if (handles(primitive, "press")) event.preventDefault()
			}),
		)
	})
	const primitive: Primitive = {
		tag,
		outer: node,
		content: node,
		set: (name, value) => {
			if (name !== "embed") return
			embed = isEmbed(value) ? value : undefined
			draw()
		},
		events: undefined,
	}
	return primitive
})
