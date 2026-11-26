/**
 * `hz:reactionBar` (lane A5): a message's reaction pills (`chat/message/tooltips.ts` `reactionButton`),
 * and with `addable` the "Add reaction" pill. A press raises `pressReaction {emoji}` or `add`.
 */
import type { Reaction } from "../../../vocabulary/content.ts"
import { definePrimitive, flag, type Primitive } from "../define.ts"
import { batched, countsOf, ensureStyles, fire, type ReactionCounts, reactionPills } from "./shared.ts"

const isReactions = (value: unknown): value is ReadonlyArray<Reaction> => Array.isArray(value)

export const primitive = definePrimitive("reactionBar", ({ document, tag, outer }) => {
	ensureStyles(document)
	const node = outer("div")
	node.setAttribute("role", "group")
	node.setAttribute("aria-label", "Reactions")
	let reactions: ReadonlyArray<Reaction> = []
	let addable = false
	// Undefined until the first draw: pills already there when the bar appears do not move.
	let previous: ReactionCounts | undefined
	const draw = batched(() => {
		const bar = reactionPills(
			document,
			reactions,
			(emoji) => fire(primitive, "pressReaction", { emoji }),
			addable ? () => fire(primitive, "add") : undefined,
			previous,
		)
		previous = countsOf(reactions)
		node.replaceChildren(...bar.childNodes)
	})
	const primitive: Primitive = {
		tag,
		outer: node,
		content: node,
		set: (name, value) => {
			if (name === "reactions") reactions = isReactions(value) ? value : []
			else if (name === "addable") {
				addable = value === true
				flag(node, "addable", value)
			} else return
			draw()
		},
		events: undefined,
	}
	draw()
	return primitive
})
