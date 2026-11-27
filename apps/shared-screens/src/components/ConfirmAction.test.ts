// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { UiSchema } from "@effect/ui"
import { Locator, Scene } from "@effect/ui/testing"
import { Hazel } from "@hazel/ui/vocabulary/index"
import { Schema } from "effect"
import { describe, expect, test } from "vitest"
import { ask, cancel, ConfirmState, closed, confirm, confirmDialog, failed } from "./ConfirmAction"

/** A page holding one confirmation: delete a named row. */
const DemoMessage = UiSchema.TaggedEnum({
	PressedDelete: { name: Schema.String },
	ConfirmedDelete: {},
	CancelledDelete: {},
	FailedDelete: {},
})

const Demo = Hazel.component({
	name: "ConfirmDemo",
	props: Schema.Struct({}),
	model: Schema.Struct({ confirm: ConfirmState(Schema.String) }),
	message: DemoMessage,
}).make({
	init: () => ({ confirm: closed }),
	update: {
		PressedDelete: ($, { name }) => $.evolve({ confirm: (state) => ask(state, name) }),
		ConfirmedDelete: ($) => $.evolve({ confirm: (state) => confirm(state)?.[0] ?? state }),
		CancelledDelete: ($) => $.evolve({ confirm: cancel }),
		FailedDelete: ($) => $.evolve({ confirm: failed }),
	},
	view: (h, model) =>
		h.stack.children(
			h.button.label("Delete general").on("press", DemoMessage.PressedDelete({ name: "general" })),
			// Stands in for the action's failed Command.
			h.button.label("Report failure").on("press", DemoMessage.FailedDelete()),
			confirmDialog(h, model.confirm, {
				key: "delete",
				title: "Delete channel",
				description: "This can't be undone.",
				confirmLabel: "Delete",
				runningLabel: "Deleting...",
				confirmed: DemoMessage.ConfirmedDelete(),
				cancelled: DemoMessage.CancelledDelete(),
			}),
		),
})

const dialog = Locator.tag("hz:dialog")
const button = (label: string): Locator.Locator => ({
	description: `<hz:button label=${label}>`,
	all: (root) =>
		Locator.all(root, Locator.tag("hz:button")).filter((node) => node.props?.["label"] === label),
})

describe("confirm action", () => {
	test("asks, runs, and asks again after a failure", () => {
		const s = Scene.start(Demo, {})
		expect(s.get(dialog).props?.["open"]).toBeUndefined()
		s.fire(button("Delete general"), "press")
		expect(s.get(dialog).props).toMatchObject({ open: true, title: "Delete channel", destructive: true })
		s.fire(button("Delete"), "press")
		expect(s.get(button("Deleting...")).props).toMatchObject({ loading: true, disabled: true })
		// Dismissing while it runs leaves it running; the result settles it.
		s.fire(dialog, "dismiss").expect(button("Deleting...")).toExist()
		s.fire(button("Report failure"), "press").expect(button("Delete")).toExist()
		s.fire(button("Cancel"), "press")
		expect(s.get(dialog).props?.["open"]).toBeUndefined()
	})

	test("the transitions", () => {
		expect(ask(closed, "a")).toEqual({ _tag: "Confirming", target: "a" })
		expect(ask({ _tag: "Running", target: "a" }, "b")).toEqual({ _tag: "Running", target: "a" })
		expect(confirm(closed)).toBeUndefined()
		expect(cancel({ _tag: "Running", target: "a" })).toEqual({ _tag: "Running", target: "a" })
	})
})
