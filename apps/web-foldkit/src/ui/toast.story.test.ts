// @vitest-environment jsdom
import { Command, expectNoOutMessage, expectOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import {
	dismiss,
	FocusToaster,
	init,
	Message,
	type Model,
	offsetOf,
	OutMessage,
	PauseTimers,
	show,
	StartTimer,
	update,
	WaitForLifetime,
	WaitForRemoval,
} from "./toast"

/** sonner's Toaster: newest-first stack, 4s lifetimes paused by hover, press and hidden tabs. */

const commandsOf = (result: {
	readonly commands?: ReadonlyArray<{ readonly name: string; readonly args?: unknown }>
}) => (result.commands ?? []).map(({ name, args }) => ({ name, args }))
const one = show(init(), { kind: "success", title: "Channel created" }).model
// One toast whose timer started at t=1000.
const running: Model = update(one, Message.StartedTimer({ id: 1, version: 1, at: 1000 })).model
const two = show(running, { title: "Message copied" }).model
const toastAt = (model: Model, index: number) => model.toasts[index]

describe("toast story: show and lifetime", () => {
	test("showing a toast puts it at the front and starts its 4s timer", () => {
		const first = show(init(), { kind: "error", title: "Couldn't send" })
		const second = show(first.model, { title: "Retrying" })
		expect(second.id).toBe(2)
		expect(second.model.toasts.map((item) => item.title)).toEqual(["Retrying", "Couldn't send"])
		expect(toastAt(second.model, 0)).toMatchObject({ kind: null, duration: 4000, remainingMs: 4000 })
		expect(commandsOf(second)).toEqual([{ name: StartTimer.name, args: { id: 2, version: 1 } }])
	})

	test("loading and infinite toasts never start a timer", () => {
		expect(commandsOf(show(init(), { kind: "loading", title: "Uploading" }))).toEqual([])
		expect(commandsOf(show(init(), { title: "Pinned", duration: Number.POSITIVE_INFINITY }))).toEqual([])
	})

	test("a started timer waits out the lifetime, then removes the toast after its exit animation", () => {
		story(
			update,
			given(one),
			message(Message.StartedTimer({ id: 1, version: 1, at: 1000 })),
			Command.expectExact(WaitForLifetime({ id: 1, version: 1, ms: 4000 })),
			Command.resolve(WaitForLifetime, Message.CompletedWaitForLifetime({ id: 1, version: 1 })),
			Command.expectExact(WaitForRemoval({ id: 1 })),
			model((next) => expect(toastAt(next, 0)?.isRemoved).toBe(true)),
			Command.resolve(WaitForRemoval, Message.CompletedWaitForRemoval({ id: 1 })),
			model((next) => expect(next.toasts).toEqual([])),
		)
	})

	test("a lifetime that ends after a pause or update never dismisses the toast", () => {
		story(
			update,
			given({ ...running, toasts: running.toasts.map((item) => ({ ...item, timerVersion: 2 })) }),
			message(Message.CompletedWaitForLifetime({ id: 1, version: 1 })),
			Command.expectNone(),
			model((next) => expect(toastAt(next, 0)?.isRemoved).toBe(false)),
		)
	})

	test("showing with a known id updates the toast in place and restarts its timer", () => {
		const loading = show(init(), { kind: "loading", title: "Saving", isPromise: true })
		const saved = show(loading.model, { id: loading.id, kind: "success", title: "Saved" })
		expect(saved.model.toasts).toHaveLength(1)
		expect(toastAt(saved.model, 0)).toMatchObject({ kind: "success", title: "Saved", isPromise: true })
		expect(commandsOf(saved)).toEqual([{ name: StartTimer.name, args: { id: 1, version: 1 } }])
	})

	test("dismissing keeps the toast's offset for its exit animation, then drops it", () => {
		const measured = update(two, Message.MeasuredToast({ id: 1, height: 50 })).model
		const withHeights = update(measured, Message.MeasuredToast({ id: 2, height: 40 })).model
		const older = toastAt(withHeights, 1)
		expect(older === undefined ? null : offsetOf(withHeights, older)).toBe(54)
		const dismissed = dismiss(withHeights, 1)
		expect(toastAt(dismissed.model, 1)).toMatchObject({ isRemoved: true, offsetBeforeRemove: 54 })
		expect(dismissed.model.heights).toEqual([{ toastId: 2, height: 40 }])
		expect(commandsOf(dismissed)).toEqual([{ name: WaitForRemoval.name, args: { id: 1 } }])
	})
})

// `running` hovered at t=2500: expanded, 2500ms left, timer version 2.
const paused: Model = {
	...running,
	isExpanded: true,
	toasts: running.toasts.map((item) => ({
		...item,
		remainingMs: 2500,
		timerStartedAt: null,
		timerVersion: 2,
	})),
}

describe("toast story: pausing", () => {
	test("hovering the toaster expands the stack and pauses every timer", () => {
		story(
			update,
			given(running),
			message(Message.HoveredToaster()),
			Command.expectExact(PauseTimers()),
			Command.resolve(PauseTimers, Message.PausedTimers({ at: 2500 })),
			model((next) => {
				expect(next.isExpanded).toBe(true)
				expect(toastAt(next, 0)).toMatchObject({
					remainingMs: 2500,
					timerStartedAt: null,
					timerVersion: 2,
				})
			}),
		)
	})

	test("leaving the toaster resumes each timer with only the time that was left", () => {
		story(
			update,
			given(paused),
			message(Message.LeftToaster()),
			Command.expectExact(StartTimer({ id: 1, version: 3 })),
			Command.resolve(StartTimer, Message.StartedTimer({ id: 1, version: 3, at: 9000 })),
			Command.expectExact(WaitForLifetime({ id: 1, version: 3, ms: 2500 })),
			Command.resolve(WaitForLifetime, Message.CompletedWaitForLifetime({ id: 1, version: 3 })),
			Command.resolve(WaitForRemoval, Message.CompletedWaitForRemoval({ id: 1 })),
			model((next) => expect(next).toMatchObject({ isExpanded: false, toasts: [] })),
		)
	})

	test("a press that drags out of the toaster keeps it expanded until the pointer leaves again", () => {
		story(
			update,
			given(paused),
			message(Message.PressedToaster()),
			Command.expectNone(),
			message(Message.LeftToaster()),
			model((next) => expect(next).toMatchObject({ isExpanded: true, isInteracting: true })),
			message(Message.ReleasedToaster()),
			Command.expectNone(),
			model((next) => expect(next).toMatchObject({ isExpanded: true, isInteracting: false })),
		)
	})

	test("a hidden tab pauses the timers and a visible one resumes them", () => {
		story(
			update,
			given(running),
			message(Message.ChangedVisibility({ isHidden: true })),
			Command.resolve(PauseTimers, Message.PausedTimers({ at: 4000 })),
			model((next) => expect(toastAt(next, 0)?.remainingMs).toBe(1000)),
			message(Message.ChangedVisibility({ isHidden: false })),
			Command.expectExact(StartTimer({ id: 1, version: 3 })),
			Command.resolve(StartTimer, Message.StartedTimer({ id: 1, version: 3, at: 5000 })),
			Command.expectExact(WaitForLifetime({ id: 1, version: 3, ms: 1000 })),
			Command.resolve(WaitForLifetime, Message.CompletedWaitForLifetime({ id: 1, version: 3 })),
			Command.resolve(WaitForRemoval, Message.CompletedWaitForRemoval({ id: 1 })),
		)
	})

	test("alt+T expands the stack, pauses the timers and focuses the toaster", () => {
		story(
			update,
			given(running),
			message(Message.PressedHotkey()),
			Command.expectExact(PauseTimers(), FocusToaster()),
			Command.resolve(PauseTimers, Message.PausedTimers({ at: 1500 })),
			Command.resolve(FocusToaster, Message.CompletedFocusToaster()),
			model((next) => expect(next.isExpanded).toBe(true)),
		)
	})

	test("Escape inside the toaster collapses the stack and resumes the timers", () => {
		story(
			update,
			given(paused),
			message(Message.PressedEscape()),
			Command.expectExact(StartTimer({ id: 1, version: 3 })),
			model((next) => expect(next.isExpanded).toBe(false)),
			Command.resolve(StartTimer, Message.StartedTimer({ id: 1, version: 3, at: 0 })),
			Command.resolve(WaitForLifetime, Message.CompletedWaitForLifetime({ id: 1, version: 3 })),
			Command.resolve(WaitForRemoval, Message.CompletedWaitForRemoval({ id: 1 })),
		)
	})
})

describe("toast story: actions and removal", () => {
	test("the action button removes its toast and tells the parent which one", () => {
		story(
			update,
			given(two),
			message(Message.ClickedAction({ id: 2 })),
			expectOutMessage(OutMessage.ClickedAction({ id: 2 })),
			Command.expectExact(WaitForRemoval({ id: 2 })),
			Command.resolve(WaitForRemoval, Message.CompletedWaitForRemoval({ id: 2 })),
			expectNoOutMessage(),
			model((next) => expect(next.toasts.map((item) => item.id)).toEqual([1])),
		)
	})

	test("removing down to one toast collapses the stack and resumes its timer", () => {
		const expanded: Model = { ...two, isExpanded: true }
		story(
			update,
			given(expanded),
			message(Message.ClickedAction({ id: 2 })),
			Command.resolve(WaitForRemoval, Message.CompletedWaitForRemoval({ id: 2 })),
			Command.expectExact(StartTimer({ id: 1, version: 2 })),
			model((next) => expect(next.isExpanded).toBe(false)),
			Command.resolve(StartTimer, Message.StartedTimer({ id: 1, version: 2, at: 0 })),
			Command.resolve(WaitForLifetime, Message.CompletedWaitForLifetime({ id: 1, version: 2 })),
			Command.resolve(WaitForRemoval, Message.CompletedWaitForRemoval({ id: 1 })),
			model((next) => expect(next.toasts).toEqual([])),
		)
	})

	test("measuring a toast marks it mounted and records its height newest first", () => {
		story(
			update,
			given(two),
			message(Message.MeasuredToast({ id: 1, height: 50 })),
			message(Message.MeasuredToast({ id: 2, height: 40 })),
			message(Message.MeasuredToast({ id: 2, height: 64 })),
			Command.expectNone(),
			model((next) => {
				expect(next.heights).toEqual([
					{ toastId: 2, height: 64 },
					{ toastId: 1, height: 50 },
				])
				expect(toastAt(next, 0)).toMatchObject({ isMounted: true, initialHeight: 64 })
			}),
		)
	})
})
