/**
 * `hz:attachmentGrid` (lane A5): images and videos in a mosaic, files as cards (`chat/attachments.ts`).
 * A press raises `press {id}`; with `removable` (the composer's previews) each has a remove button.
 */
import type { Attachment } from "../../../vocabulary/content.ts"
import { definePrimitive, flag, type Primitive } from "../define.ts"
import { attachments, batched, ensureStyles, fire } from "./shared.ts"

const isAttachments = (value: unknown): value is ReadonlyArray<Attachment> => Array.isArray(value)

export const primitive = definePrimitive("attachmentGrid", ({ document, tag, outer }) => {
	ensureStyles(document)
	const node = outer("div")
	let list: ReadonlyArray<Attachment> = []
	let removable = false
	const draw = batched(() => {
		const grid = attachments(document, list, {
			press: (id) => fire(primitive, "press", { id }),
			remove: removable ? (id) => fire(primitive, "remove", { id }) : undefined,
		})
		node.replaceChildren(...grid.childNodes)
	})
	const primitive: Primitive = {
		tag,
		outer: node,
		content: node,
		set: (name, value) => {
			if (name === "attachments") list = isAttachments(value) ? value : []
			else if (name === "removable") {
				removable = value === true
				flag(node, "removable", value)
			} else return
			draw()
		},
		events: undefined,
	}
	return primitive
})
