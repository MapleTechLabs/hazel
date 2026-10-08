// @vitest-environment jsdom
import * as Scene from "foldkit/scene"
import { inertHtml as ih } from "foldkit/html"
import { describe, test } from "vitest"
import { dialogClose, dialogFooter, dialogHeader } from "./dialog"
import { init, Message, PortalModal, titleId, update } from "./modal"
import { view } from "./sheet"

/** Sheet through the view: a Modal with an edge panel, sharing the Modal update and PortalModal. */

// The overlay renders beside the trigger: scene clicks bubble through the vdom, not the portal.
const sceneView = Scene.withViewInputs(view, {
	toTrigger: (attributes, overlay) => ih.div([], [ih.button([...attributes], ["Open details"]), overlay]),
	toContent: (closeAttributes) => [
		dialogHeader(ih, { title: { id: titleId("details"), text: "Channel details" } }),
		dialogFooter(ih, [dialogClose(ih, closeAttributes, ["Done"])]),
	],
})

const config = { update, view: sceneView() }
const trigger = Scene.role("button", { name: "Open details" })
const sheet = Scene.role("dialog", { name: "Channel details" })
// The Escape handler sits on the overlay root, which has no role.
const overlayRoot = Scene.selector('[style="display: contents;"]')
const opened = [
	Scene.given(init("details")),
	Scene.click(trigger),
	Scene.Mount.resolve(PortalModal, Message.CompletedPortalModal()),
]

describe("sheet scene", () => {
	test("pressing the trigger opens a sheet labelled by its title", () => {
		Scene.scene(
			config,
			Scene.given(init("details")),
			Scene.expect(trigger).toHaveAttr("aria-expanded", "false"),
			Scene.click(trigger),
			Scene.Mount.expectExact(
				PortalModal({
					id: "details",
					isDismissable: true,
					restoresToPrevious: false,
					autoFocusId: null,
				}),
			),
			Scene.Mount.resolve(PortalModal, Message.CompletedPortalModal()),
			Scene.expect(trigger).toHaveAttr("aria-expanded", "true"),
			Scene.expect(trigger).toHaveAttr("aria-controls", "details-dialog"),
			Scene.expect(sheet).toHaveAttr("aria-labelledby", "details-title"),
		)
	})

	test("the close icon closes the sheet", () => {
		Scene.scene(
			config,
			...opened,
			Scene.click(Scene.role("button", { name: "Close" })),
			Scene.Mount.expectEnded(PortalModal),
			Scene.expect(Scene.role("dialog")).toBeAbsent(),
			Scene.expect(trigger).toHaveAttr("aria-expanded", "false"),
		)
	})

	test("a close button in the content closes the sheet", () => {
		Scene.scene(
			config,
			...opened,
			Scene.click(Scene.role("button", { name: "Done" })),
			Scene.Mount.expectEnded(PortalModal),
			Scene.expect(Scene.role("dialog")).toBeAbsent(),
		)
	})

	test("Escape closes the sheet", () => {
		Scene.scene(
			config,
			...opened,
			Scene.keydown(overlayRoot, "Escape"),
			Scene.expectHandled(),
			Scene.Mount.expectEnded(PortalModal),
			Scene.expect(Scene.role("dialog")).toBeAbsent(),
		)
	})

	test("a press outside the sheet dismisses it", () => {
		Scene.scene(
			config,
			...opened,
			Scene.Subscription.emit(Message.PressedOutside()),
			Scene.Mount.expectEnded(PortalModal),
			Scene.expect(Scene.role("dialog")).toBeAbsent(),
		)
	})

	test("an aria-label replaces the title as the sheet's name", () => {
		Scene.scene(
			{ update, view: sceneView({ ariaLabel: "Navigation" }) },
			...opened,
			Scene.expect(Scene.role("dialog", { name: "Navigation" })).not.toHaveAttr("aria-labelledby"),
		)
	})

	test("overlay attributes land on the modal overlay", () => {
		Scene.scene(
			{ update, view: sceneView({ overlayAttributes: { "data-slot": "sheet-overlay" } }) },
			...opened,
			Scene.expect(Scene.selector("[data-modal-overlay]")).toHaveAttr("data-slot", "sheet-overlay"),
		)
	})

	test("a non-dismissable alert sheet has no close icon and ignores outside presses", () => {
		Scene.scene(
			{ update, view: sceneView({ role: "alertdialog" }) },
			Scene.given(init("details")),
			Scene.click(trigger),
			Scene.Mount.expectExact(
				PortalModal({
					id: "details",
					isDismissable: false,
					restoresToPrevious: false,
					autoFocusId: null,
				}),
			),
			Scene.Mount.resolve(PortalModal, Message.CompletedPortalModal()),
			Scene.expect(Scene.role("alertdialog", { name: "Channel details" })).toExist(),
			Scene.expect(Scene.role("button", { name: "Close" })).toBeAbsent(),
		)
	})
})
