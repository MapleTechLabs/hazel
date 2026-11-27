// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * A fixture tree as an Effect UI view, for the web host and the native host. Built at the `View`
 * level, in `compile.ts`'s order (slots, then children), so internal tags (`action`, `ext`) work too.
 */
import { UiSchema } from "@effect/ui"
import * as View from "@effect/ui/View"
import { Schema } from "effect"
import { component, HzBuilder, textParents } from "../vocabulary/Hazel.ts"
import { isTagKey, type TagKey, tagName, tags } from "../vocabulary/spec.ts"
import { FixtureNode, type FixtureChild } from "./schema.ts"

export const FixtureMessage = UiSchema.TaggedEnum({ Fired: { event: Schema.String } })
export type FixtureMessage = typeof FixtureMessage.Type

const elements = { name: "hazel", textParents }

const build = (node: FixtureNode): View.Input<FixtureMessage, never> => {
	if (!isTagKey(node.tag)) throw new Error(`fixture tag ${node.tag} is not in vocabulary/spec.ts`)
	const key: TagKey = node.tag
	let builder: View.ElementBuilder<FixtureMessage, never, any, unknown, string> = View.withFields(
		new HzBuilder<FixtureMessage, never, TagKey>(tagName(key)),
		{ props: { ...node.props } },
	)
	if (node.key !== undefined) builder = builder.key(node.key)
	for (const event of node.events ?? []) builder = builder.on(event, FixtureMessage.Fired({ event }))
	const slots = (node.slots ?? []).map((slot) =>
		View.withNoTextContent(
			View.withFields(new HzBuilder<FixtureMessage, never, "slot">(tagName("slot")), {
				props: { name: slot.name },
			}),
			slot.children.map(child),
			elements,
		),
	)
	const children = (node.children ?? []).map(child)
	const all = [...slots, ...children]
	if (all.length === 0) return builder
	return tags[key].content === "text" && slots.length === 0
		? View.withContent(builder, all)
		: View.withNoTextContent(builder, all, elements)
}

const child = (input: FixtureChild): View.Input<FixtureMessage, never> =>
	typeof input === "string" ? input : build(input)

/** Mounts one case: `Renderer.mount(FixtureView, { root }, container)` on either host. */
export const FixtureView = component({
	name: "FixtureView",
	props: Schema.Struct({ root: FixtureNode }),
	model: Schema.Struct({ fired: Schema.Array(Schema.String) }),
	message: FixtureMessage,
}).make({
	init: () => ({ fired: [] }),
	update: { Fired: ($, { event }) => $.evolve({ fired: (all) => [...all, event] }) },
	view: (h) => build(h.props.root) as never,
})
