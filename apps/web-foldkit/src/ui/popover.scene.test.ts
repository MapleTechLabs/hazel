// @vitest-environment jsdom
import * as Scene from "foldkit/scene"
import { inertHtml as ih } from "foldkit/html"
import { describe, test } from "vitest"
import { dialogClose, dialogDescription, dialogTitle } from "./dialog"
import { init, Message, PortalPopover, popoverFooter, update, view } from "./popover"

/** Popover through the view: trigger state, the dialog labelled by its trigger, close and Escape. */

// The overlay renders beside the trigger: scene clicks bubble through the vdom, not the portal.
const sceneView = Scene.withViewInputs(view, {
	toTrigger: (attributes, overlay) => ih.div([], [ih.button([...attributes], ["Details"]), overlay]),
	toContent: (closeAttributes) => [
		dialogTitle(ih, {}, "Notifications"),
		dialogDescription(ih, "Choose when this channel notifies you."),
		popoverFooter(ih, [dialogClose(ih, closeAttributes, ["Close"])]),
	],
})

const config = { update, view: sceneView() }
const trigger = Scene.role("button", { name: "Details" })
const popover = Scene.role("dialog")
const opened = [
	Scene.given(init("details")),
	Scene.click(trigger),
	Scene.Mount.resolve(PortalPopover, Message.CompletedPortalPopover()),
]

describe("popover scene", () => {
	test("the trigger is collapsed and no popover renders while closed", () => {
		Scene.scene(
			config,
			Scene.given(init("details")),
			Scene.expect(trigger).toHaveAttr("aria-expanded", "false"),
			Scene.expect(trigger).toHaveId("details-trigger"),
			Scene.expect(popover).toBeAbsent(),
		)
	})

	test("pressing the trigger opens a dialog the trigger labels and controls", () => {
		Scene.scene(
			config,
			Scene.given(init("details")),
			Scene.click(trigger),
			Scene.Mount.expectExact(PortalPopover({ id: "details", placement: "bottom", offset: 8 })),
			Scene.Mount.resolve(PortalPopover, Message.CompletedPortalPopover()),
			Scene.expect(trigger).toHaveAttr("aria-expanded", "true"),
			Scene.expect(trigger).toHaveAttr("aria-controls", "details-popover"),
			Scene.expect(popover).toHaveAttr("aria-labelledby", "details-trigger"),
			Scene.expect(Scene.role("dialog", { name: "Details" })).toHaveId("details-popover"),
			Scene.expect(Scene.role("heading", { name: "Notifications", level: 3 })).toExist(),
		)
	})

	test("the close button in the content closes the popover", () => {
		Scene.scene(
			config,
			...opened,
			Scene.click(Scene.role("button", { name: "Close" })),
			Scene.Mount.expectEnded(PortalPopover),
			Scene.expect(popover).toBeAbsent(),
			Scene.expect(trigger).toHaveAttr("aria-expanded", "false"),
		)
	})

	test("Escape inside the popover closes it", () => {
		Scene.scene(
			config,
			...opened,
			Scene.keydown(popover, "Escape"),
			Scene.expectHandled(),
			Scene.Mount.expectEnded(PortalPopover),
			Scene.expect(popover).toBeAbsent(),
		)
	})

	test("other keys inside the popover fall through", () => {
		Scene.scene(
			config,
			...opened,
			Scene.keydown(popover, "Tab"),
			Scene.expectIgnored(),
			Scene.expect(popover).toExist(),
		)
	})

	test("the hidden dismiss buttons at both ends close the popover for screen readers", () => {
		Scene.scene(
			config,
			...opened,
			Scene.expectAll(Scene.all.role("button", { name: "Dismiss" })).toHaveCount(2),
			Scene.click(Scene.first(Scene.all.role("button", { name: "Dismiss" }))),
			Scene.Mount.expectEnded(PortalPopover),
			Scene.expect(popover).toBeAbsent(),
		)
	})

	test("a press outside dismisses the popover", () => {
		Scene.scene(
			config,
			...opened,
			Scene.Subscription.emit(Message.PressedOutside()),
			Scene.Mount.expectEnded(PortalPopover),
			Scene.expect(popover).toBeAbsent(),
		)
	})

	test("a popover with an arrow uses the larger offset and the requested placement", () => {
		Scene.scene(
			{ update, view: sceneView({ arrow: true, placement: "right" }) },
			Scene.given(init("details")),
			Scene.click(trigger),
			Scene.Mount.expectExact(PortalPopover({ id: "details", placement: "right", offset: 12 })),
			Scene.Mount.resolve(PortalPopover, Message.CompletedPortalPopover()),
			Scene.expect(Scene.selector("svg")).toExist(),
		)
	})
})
