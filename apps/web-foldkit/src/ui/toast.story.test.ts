import * as UiToast from "@foldkit/ui/toast"
import { Option } from "effect"
import { Command, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import { init, Message, type Payload, show, update } from "./toast"

/** The app's payload on the `@foldkit/ui` Toast: kinds, stickiness and in-place replacement by key. */

const payload = (overrides: Partial<Payload> = {}): Payload => ({
	kind: "success",
	title: "Saved",
	maybeDescription: Option.none(),
	maybeAction: Option.none(),
	maybeKey: Option.none(),
	...overrides,
})

const entryId = "toaster-entry-0"

describe("toast show", () => {
	test("a toast takes the kit variant of its kind and the 4s default lifetime", () => {
		const shown = show(init(), payload({ kind: "warning" }), false)
		expect(shown.model.entries[0]).toMatchObject({ id: entryId, variant: "Warning" })
		expect(shown.model.entries[0]?.maybeDuration).toEqual(Option.some(shown.model.defaultDuration))
		expect(shown.commands?.map((command) => command.name)).toContain(UiToast.WaitBeforeDismissal.name)
	})

	test("loading and sticky toasts have no lifetime", () => {
		const loading = show(init(), payload({ kind: "loading" }), false)
		expect(loading.model.entries[0]).toMatchObject({ variant: "Info", maybeDuration: Option.none() })
		expect(loading.commands?.map((command) => command.name)).not.toContain(
			UiToast.WaitBeforeDismissal.name,
		)
		const sticky = show(init(), payload(), true)
		expect(sticky.model.entries[0]?.maybeDuration).toEqual(Option.none())
	})

	test("a toast with a live key replaces it in place (loading, then success)", () => {
		const key = Option.some("save")
		const loading = show(init(), payload({ kind: "loading", title: "Saving...", maybeKey: key }), false)
		const done = show(loading.model, payload({ title: "Saved", maybeKey: key }), false)
		expect(done.model.entries).toHaveLength(1)
		expect(done.model.entries[0]).toMatchObject({
			id: entryId,
			variant: "Success",
			pendingDismissVersion: 1,
			payload: { kind: "success", title: "Saved" },
		})
		expect(done.commands?.map((command) => command.args)).toEqual([
			{ entryId, version: 1, duration: done.model.defaultDuration },
		])
		const other = show(done.model, payload({ title: "Other" }), false)
		expect(other.model.entries.map((entry) => entry.payload.title)).toEqual(["Saved", "Other"])
	})

	test("replacing a hovered toast leaves its timer paused", () => {
		const key = Option.some("save")
		const loading = show(init(), payload({ kind: "loading", maybeKey: key }), false).model
		const hovered = update(loading, Message.HoveredEntry({ entryId })).model
		const done = show(hovered, payload({ maybeKey: key }), false)
		expect(done.commands).toEqual([])
	})
})

describe("toast lifecycle", () => {
	test("hovering pauses the lifetime; leaving restarts it with a fresh version", () => {
		story(
			update,
			given(show(init(), payload(), false).model),
			message(Message.HoveredEntry({ entryId })),
			Command.expectNone(),
			message(Message.LeftEntry({ entryId })),
			Command.expectExact(UiToast.WaitBeforeDismissal),
			// The timer started before the hover is stale and does nothing.
			Command.resolve(
				UiToast.WaitBeforeDismissal,
				Message.CompletedWaitBeforeDismissal({ entryId, version: 0 }),
			),
			model((m) => expect(m.entries[0]?.animation.isShowing).toBe(true)),
		)
	})
})
