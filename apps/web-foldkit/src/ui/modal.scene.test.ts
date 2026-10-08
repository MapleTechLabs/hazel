// @vitest-environment jsdom
import * as Scene from "foldkit/scene"
import { inertHtml as ih } from "foldkit/html"
import { describe, test } from "vitest"
import { dialogClose, dialogFooter, dialogHeader } from "./dialog"
import type { HtmlBuilder } from "foldkit/html"
import { controlledModal, init, Message, type Model, PortalModal, titleId, update, view } from "./modal"

/** Modal through the view: trigger state, the labelled dialog, close button, Escape and outside press. */

// The overlay renders beside the trigger: scene clicks bubble through the vdom, not the portal.
const sceneView = Scene.withViewInputs(view, {
	toTrigger: (attributes, overlay) => ih.div([], [ih.button([...attributes], ["Open rename"]), overlay]),
	toContent: (closeAttributes) => [
		dialogHeader(ih, {
			title: { id: titleId("rename"), text: "Rename thread" },
			description: "Pick a name.",
		}),
		dialogFooter(ih, [dialogClose(ih, closeAttributes, ["Cancel"])]),
	],
})

const config = { update, view: sceneView() }
const trigger = Scene.role("button", { name: "Open rename" })
// The Escape handler sits on the overlay root, which has no role.
const overlayRoot = Scene.selector('[style="display: contents;"]')
const dialog = Scene.role("dialog", { name: "Rename thread" })
const opened = [
	Scene.given(init("rename")),
	Scene.click(trigger),
	Scene.Mount.resolve(PortalModal, Message.CompletedPortalModal()),
]

describe("modal scene", () => {
	test("the trigger is collapsed and no dialog renders while the modal is closed", () => {
		Scene.scene(
			config,
			Scene.given(init("rename")),
			Scene.expect(trigger).toHaveAttr("aria-expanded", "false"),
			Scene.expect(trigger).not.toHaveAttr("aria-controls"),
			Scene.expect(Scene.role("dialog")).toBeAbsent(),
			Scene.Mount.expectNone(),
		)
	})

	test("pressing the trigger opens a dialog labelled by its title", () => {
		Scene.scene(
			config,
			...opened,
			Scene.expect(trigger).toHaveAttr("aria-expanded", "true"),
			Scene.expect(trigger).toHaveAttr("aria-controls", "rename-dialog"),
			Scene.expect(trigger).toHaveAttr("data-pressed", "true"),
			Scene.expect(dialog).toHaveAttr("aria-labelledby", "rename-title"),
			Scene.expect(dialog).toHaveId("rename-dialog"),
			Scene.expect(Scene.role("heading", { name: "Rename thread" })).toExist(),
			Scene.expect(Scene.text("Pick a name.")).toExist(),
		)
	})

	test("the close icon button closes the modal", () => {
		Scene.scene(
			config,
			...opened,
			Scene.click(Scene.role("button", { name: "Close" })),
			Scene.Mount.expectEnded(PortalModal),
			Scene.expect(Scene.role("dialog")).toBeAbsent(),
			Scene.expect(trigger).toHaveAttr("aria-expanded", "false"),
		)
	})

	test("a close button in the content closes the modal", () => {
		Scene.scene(
			config,
			...opened,
			Scene.click(Scene.role("button", { name: "Cancel" })),
			Scene.Mount.expectEnded(PortalModal),
			Scene.expect(Scene.role("dialog")).toBeAbsent(),
		)
	})

	test("Escape inside the modal closes it", () => {
		Scene.scene(
			config,
			...opened,
			Scene.keydown(overlayRoot, "Escape"),
			Scene.expectHandled(),
			Scene.Mount.expectEnded(PortalModal),
			Scene.expect(Scene.role("dialog")).toBeAbsent(),
		)
	})

	test("other keys inside the modal fall through", () => {
		Scene.scene(
			config,
			...opened,
			Scene.keydown(overlayRoot, "a"),
			Scene.expectIgnored(),
			Scene.expect(dialog).toExist(),
		)
	})

	test("a press outside the modal dismisses it", () => {
		Scene.scene(
			config,
			...opened,
			Scene.Subscription.emit(Message.PressedOutside()),
			Scene.Mount.expectEnded(PortalModal),
			Scene.expect(Scene.role("dialog")).toBeAbsent(),
		)
	})

	test("an alert dialog has no close icon and no hidden dismiss button", () => {
		Scene.scene(
			{ update, view: sceneView({ role: "alertdialog" }) },
			Scene.given(init("rename")),
			Scene.click(trigger),
			Scene.Mount.expectHas(
				PortalModal({
					id: "rename",
					isDismissable: false,
					restoresToPrevious: false,
					autoFocusId: null,
				}),
			),
			Scene.Mount.resolve(PortalModal, Message.CompletedPortalModal()),
			Scene.expect(Scene.role("alertdialog", { name: "Rename thread" })).toExist(),
			Scene.expect(Scene.role("button", { name: "Close" })).toBeAbsent(),
			Scene.expect(Scene.role("button", { name: "Dismiss" })).toBeAbsent(),
		)
	})

	test("a modal its parent opens without a trigger restores focus to the previous element and closes on Escape", () => {
		const controlledView = (model: Model, h: HtmlBuilder<Message>) =>
			h.main(
				[],
				[
					controlledModal(h, {
						model,
						toParentMessage: (message) => message,
						toContent: () => [
							dialogHeader(h, { title: { id: titleId("rename"), text: "Rename thread" } }),
						],
						restoresFocusToPrevious: true,
					}),
				],
			)
		Scene.scene(
			{ update, view: controlledView },
			Scene.given({ ...init("rename"), isOpen: true }),
			Scene.Mount.expectExact(
				PortalModal({
					id: "rename",
					isDismissable: true,
					restoresToPrevious: true,
					autoFocusId: null,
				}),
			),
			Scene.Mount.resolve(PortalModal, Message.CompletedPortalModal()),
			Scene.expect(dialog).toExist(),
			Scene.keydown(overlayRoot, "Escape"),
			Scene.Mount.expectEnded(PortalModal),
			Scene.expect(Scene.role("dialog")).toBeAbsent(),
		)
	})
})
