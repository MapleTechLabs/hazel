// @vitest-environment jsdom
import * as Scene from "foldkit/scene"
import { describe, test } from "vitest"
import {
	FocusToaster,
	init,
	MeasureToast,
	Message,
	type Model,
	OutMessage,
	PauseToastTimers,
	type ShowOptions,
	show,
	update,
	WaitForToastRemoval,
} from "./toast"
import { view } from "./toast-view"

/** The sonner Toaster through the view: the live region, the stack, expansion and the action button. */

const config = { update, view: Scene.withViewInputs(view, { theme: "light" })() }
const persistent = { duration: Number.POSITIVE_INFINITY }
const queued = (...options: ReadonlyArray<ShowOptions>): Model =>
	options.reduce((model, next) => show(model, { ...persistent, ...next }).model, init())
const region = Scene.role("region", { name: "Notifications alt+T" })
const toaster = Scene.selector("[data-sonner-toaster]")
const measured = (id: number, height: number) =>
	Scene.Mount.resolve(MeasureToast({ id }), Message.MeasuredToast({ id, height }))
const deleted = queued({ title: "Message deleted", actionLabel: "Undo" })

describe("toast scene", () => {
	test("an empty toaster is a polite live region with no list", () => {
		Scene.scene(
			config,
			Scene.given(init()),
			Scene.expect(region).toHaveAttr("aria-live", "polite"),
			Scene.expect(region).toBeEmpty(),
			Scene.Mount.expectNone(),
		)
	})

	test("a toast shows its title, description and kind once measured", () => {
		Scene.scene(
			config,
			Scene.given(
				queued({
					kind: "success",
					title: "Invitation sent",
					description: "ada@hazel.sh will get an email.",
				}),
			),
			Scene.Mount.expectExact(MeasureToast({ id: 1 })),
			measured(1, 52),
			Scene.expect(toaster).toHaveAttr("data-sonner-theme", "light"),
			Scene.expect(Scene.text("Invitation sent")).toExist(),
			Scene.expect(Scene.text("ada@hazel.sh will get an email.")).toExist(),
			Scene.expect(Scene.selector("[data-sonner-toast]")).toHaveAttr("data-type", "success"),
			Scene.expect(Scene.selector("[data-sonner-toast]")).toHaveAttr("data-mounted", "true"),
		)
	})

	test("the newest toast sits in front and only three toasts are visible", () => {
		Scene.scene(
			config,
			Scene.given(
				queued({ title: "First" }, { title: "Second" }, { title: "Third" }, { title: "Fourth" }),
			),
			Scene.Mount.resolveAll(
				[MeasureToast({ id: 4 }), Message.MeasuredToast({ id: 4, height: 40 })],
				[MeasureToast({ id: 3 }), Message.MeasuredToast({ id: 3, height: 40 })],
				[MeasureToast({ id: 2 }), Message.MeasuredToast({ id: 2, height: 40 })],
				[MeasureToast({ id: 1 }), Message.MeasuredToast({ id: 1, height: 40 })],
			),
			Scene.expectAll(Scene.all.selector("[data-sonner-toast]")).toHaveCount(4),
			Scene.expect(Scene.first(Scene.all.selector("[data-sonner-toast]"))).toHaveText("Fourth"),
			Scene.expect(Scene.first(Scene.all.selector("[data-sonner-toast]"))).toHaveAttr(
				"data-front",
				"true",
			),
			Scene.expect(Scene.nth(Scene.all.selector("[data-sonner-toast]"), 2)).toHaveAttr(
				"data-visible",
				"true",
			),
			Scene.expect(Scene.last(Scene.all.selector("[data-sonner-toast]"))).toHaveAttr(
				"data-visible",
				"false",
			),
		)
	})

	test("hovering the toaster expands the stack and pauses the timers", () => {
		Scene.scene(
			config,
			Scene.given(queued({ title: "Saved" }, { title: "Synced" })),
			measured(2, 40),
			measured(1, 40),
			Scene.expect(Scene.first(Scene.all.selector("[data-sonner-toast]"))).toHaveAttr(
				"data-expanded",
				"false",
			),
			Scene.hover(toaster),
			Scene.Command.expectExact(PauseToastTimers()),
			Scene.Command.resolve(PauseToastTimers, Message.PausedTimers({ at: 0 })),
			Scene.expect(Scene.first(Scene.all.selector("[data-sonner-toast]"))).toHaveAttr(
				"data-expanded",
				"true",
			),
		)
	})

	test("the action button removes its toast after the exit animation and tells the parent", () => {
		Scene.scene(
			config,
			Scene.given(deleted),
			measured(1, 48),
			Scene.click(Scene.role("button", { name: "Undo" })),
			Scene.expectOutMessage(OutMessage.ClickedAction({ id: 1 })),
			Scene.expect(Scene.selector("[data-sonner-toast]")).toHaveAttr("data-removed", "true"),
			Scene.Command.resolve(WaitForToastRemoval, Message.CompletedWaitForRemoval({ id: 1 })),
			Scene.Mount.expectEnded(MeasureToast),
			Scene.expect(region).toBeEmpty(),
		)
	})

	test("pressing inside the toaster pauses the timers until the press ends", () => {
		Scene.scene(
			config,
			Scene.given(deleted),
			measured(1, 48),
			Scene.pointerDown(toaster),
			Scene.Command.resolve(PauseToastTimers, Message.PausedTimers({ at: 0 })),
			Scene.pointerUp(toaster),
			Scene.Command.expectNone(),
			Scene.expect(Scene.text("Message deleted")).toExist(),
		)
	})

	test("alt+T expands the stack and moves focus into the toaster", () => {
		Scene.scene(
			config,
			Scene.given(deleted),
			measured(1, 48),
			Scene.Subscription.emit(Message.PressedHotkey()),
			Scene.Command.expectExact(PauseToastTimers(), FocusToaster()),
			Scene.Command.resolveAll(
				[PauseToastTimers, Message.PausedTimers({ at: 0 })],
				[FocusToaster, Message.CompletedFocusToaster()],
			),
			Scene.expect(Scene.selector("[data-sonner-toast]")).toHaveAttr("data-expanded", "true"),
		)
	})

	test("a loading toast shows the spinner instead of an icon", () => {
		Scene.scene(
			config,
			Scene.given(queued({ kind: "loading", title: "Uploading attachment" })),
			measured(1, 48),
			Scene.expect(Scene.selector(".sonner-loading-wrapper")).toHaveAttr("data-visible", "true"),
			Scene.expect(Scene.selector("[data-sonner-toast]")).toHaveAttr("data-type", "loading"),
		)
	})
})
