/**
 * `hz:attachmentGrid` (lane A5): a message's mosaic of images and videos with files as cards
 * (`chat/attachments.ts`), or the files page's `grid`, `masonry` and `list` (`files/media-view.ts`).
 * A press raises `press {id}`, a failed one's `retry {id}` when handled; with `removable` (the
 * composer's previews) each has a remove button.
 */
import type { Attachment } from "../../../vocabulary/content.ts"
import type { AttachmentLayout } from "../../../vocabulary/options.ts"
import { definePrimitive, flag, type Primitive } from "../define.ts"
import { attachments, batched, ensureStyles, fire, handles } from "./shared.ts"

const isAttachments = (value: unknown): value is ReadonlyArray<Attachment> => Array.isArray(value)

const layouts: ReadonlyArray<AttachmentLayout> = ["mosaic", "grid", "masonry", "list"]
const isLayout = (value: unknown): value is AttachmentLayout => layouts.some((each) => each === value)

export const primitive = definePrimitive("attachmentGrid", ({ document, tag, outer }) => {
	ensureStyles(document)
	const node = outer("div")
	let list: ReadonlyArray<Attachment> = []
	let removable = false
	let layout: AttachmentLayout = "mosaic"
	const draw = batched(() => {
		const grid = attachments(
			document,
			list,
			{
				press: (id) => fire(primitive, "press", { id }),
				remove: removable ? (id) => fire(primitive, "remove", { id }) : undefined,
				retry: handles(primitive, "retry") ? (id) => fire(primitive, "retry", { id }) : undefined,
			},
			layout,
		)
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
			} else if (name === "layout") {
				layout = isLayout(value) ? value : "mosaic"
				node.dataset.layout = layout
			} else return
			draw()
		},
		events: undefined,
	}
	return primitive
})
