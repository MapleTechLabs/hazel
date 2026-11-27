// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/** A small `hazel` fixture for the wire goldens and DOM tests: select, reorder and remove keyed rows. */
import { UiSchema } from "@effect/ui"
import { Schema } from "effect"
import { Hazel } from "../vocabulary/index.ts"

export const RowsMessage = UiSchema.TaggedEnum({
	PressedRow: { id: Schema.String },
	Reversed: {},
	Removed: { id: Schema.String },
})

export const Rows = Hazel.component({
	name: "Rows",
	props: Schema.Struct({}),
	model: Schema.Struct({ ids: Schema.Array(Schema.String), selected: Schema.NullOr(Schema.String) }),
	message: RowsMessage,
}).make({
	init: () => ({ ids: ["a", "b", "c"], selected: null }),
	update: {
		PressedRow: ($, { id }) => $.evolve({ selected: id }),
		Reversed: ($) => $.evolve({ ids: (ids) => [...ids].reverse() }),
		Removed: ($, { id }) => $.evolve({ ids: (ids) => ids.filter((other) => other !== id) }),
	},
	view: (h, model) =>
		h.section.title("Rows").children(
			model.ids.map((id) =>
				h.item
					.key(id)
					.title(id.toUpperCase())
					.leading(h.icon.name("hashtag"))
					.selected(model.selected === id)
					// A selected row is a button, the others links: the host swaps inside the item.
					.href(model.selected === id ? undefined : `#/${id}`)
					.on("press", RowsMessage.PressedRow({ id })),
			),
		),
})
