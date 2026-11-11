// @vitest-environment jsdom
import * as Scene from "foldkit/scene"
import { inertHtml as ih } from "foldkit/html"
import { describe, test } from "vitest"
import { dialogClose, dialogDescription, dialogTitle } from "./dialog"
import {
	AnchorPopover,
	FocusButton,
	init,
	Message,
	PortalPopoverBackdrop,
	popoverFooter,
	update,
	view,
} from "./popover"

/** Popover through the view: the trigger, the dialog it labels, close, Escape and the backdrop. */

const sceneView = Scene.withViewInputs(view, {
	toTrigger: (attributes) => ih.button([...attributes], ["Details"]),
	toContent: (closeAttributes) => [
		dialogTitle(ih, {}, "Notifications"),
		dialogDescription(ih, "Choose when this channel notifies you."),
		popoverFooter(ih, [dialogClose(ih, closeAttributes, ["Close"])]),
	],
})

const config = { update, view: sceneView() }
const trigger = Scene.role("button", { name: "Details" })
const popover = Scene.role("dialog")
const opened = () => [
	Scene.given(init("details")),
	Scene.click(trigger),
	Scene.Mount.resolve(PortalPopoverBackdrop, Message.CompletedPortalPopoverBackdrop()),
	Scene.Mount.resolve(AnchorPopover, Message.CompletedAnchorPopover()),
]
const closed = () => [
	Scene.Command.resolve(FocusButton, Message.CompletedFocusButton()),
	Scene.Mount.expectEnded(PortalPopoverBackdrop),
	Scene.Mount.expectEnded(AnchorPopover),
	Scene.expect(popover).toBeAbsent(),
	Scene.expect(trigger).toHaveAttr("aria-expanded", "false"),
]

describe("popover scene", () => {
	test("the trigger is collapsed and no popover renders while closed", () => {
		Scene.scene(
			config,
			Scene.given(init("details")),
			Scene.expect(trigger).toHaveAttr("aria-expanded", "false"),
			Scene.expect(trigger).toHaveId("details-button"),
			Scene.expect(popover).toBeAbsent(),
		)
	})

	test("pressing the trigger opens a dialog the trigger labels and controls", () => {
		Scene.scene(
			config,
			...opened(),
			Scene.expect(trigger).toHaveAttr("aria-expanded", "true"),
			Scene.expect(trigger).toHaveAttr("aria-controls", "details-panel"),
			Scene.expect(Scene.role("dialog", { name: "Details" })).toHaveId("details-panel"),
			Scene.expect(Scene.role("heading", { name: "Notifications", level: 3 })).toExist(),
		)
	})

	test("the close button in the content closes the popover", () => {
		Scene.scene(config, ...opened(), Scene.click(Scene.role("button", { name: "Close" })), ...closed())
	})

	test("Escape in the popover closes it", () => {
		Scene.scene(config, ...opened(), Scene.keydown(popover, "Escape"), Scene.expectHandled(), ...closed())
	})

	test("pressing the trigger again closes it", () => {
		Scene.scene(config, ...opened(), Scene.click(trigger), ...closed())
	})
})
