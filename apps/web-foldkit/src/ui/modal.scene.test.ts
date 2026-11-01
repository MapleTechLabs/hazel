// @vitest-environment jsdom
import * as Scene from "foldkit/scene"
import { inertHtml as ih } from "foldkit/html"
import { describe, test } from "vitest"
import { dialogClose, dialogFooter, dialogHeader } from "./dialog"
import { AcquireResources, init, initOpen, Message, titleId, update, view } from "./modal"

/** Modal through the view: a native dialog labelled by its title, closed by its buttons and backdrop. */

const sceneView = Scene.withViewInputs(view, {
	toContent: (closeAttributes) => [
		dialogHeader(ih, {
			title: { id: titleId("rename"), text: "Rename thread" },
			description: "Pick a name.",
		}),
		dialogFooter(ih, [dialogClose(ih, closeAttributes, ["Cancel"])]),
	],
})

type Inputs = Parameters<typeof sceneView>[0]
// A closed modal renders nothing, so the scene view wraps it in an element.
const wrapped =
	(inputs?: Inputs) =>
	(...args: Parameters<ReturnType<typeof sceneView>>) =>
		ih.main([], [sceneView(inputs)(...args)])
const config = { update, view: wrapped() }
const dialog = Scene.role("dialog", { name: "Rename thread" })
const backdrop = Scene.selector('[data-slot="modal-overlay"]')
const opened = [
	Scene.given(initOpen("rename")),
	Scene.Mount.resolve(AcquireResources, Message.SucceededAcquireResources()),
]
const closedByRequest = () => [
	Scene.Mount.expectEnded(AcquireResources),
	Scene.expect(Scene.role("dialog")).toBeAbsent(),
]

describe("modal scene", () => {
	test("a closed modal renders nothing", () => {
		Scene.scene(
			config,
			Scene.given(init("rename")),
			Scene.expect(Scene.role("dialog")).toBeAbsent(),
			Scene.Mount.expectNone(),
		)
	})

	test("an open modal is a dialog labelled by its title that takes its resources on mount", () => {
		Scene.scene(
			config,
			Scene.given(initOpen("rename")),
			Scene.Mount.expectExact(
				AcquireResources({ id: "rename", focusSelector: "[data-foldkit-dialog-initial-focus]" }),
			),
			Scene.Mount.resolve(AcquireResources, Message.SucceededAcquireResources()),
			Scene.expect(dialog).toHaveAttr("aria-modal", "true"),
			Scene.expect(Scene.role("heading", { name: "Rename thread" })).toExist(),
			Scene.expect(Scene.text("Pick a name.")).toExist(),
		)
	})

	test("the close icon closes the modal", () => {
		Scene.scene(
			config,
			...opened,
			Scene.click(Scene.role("button", { name: "Close" })),
			...closedByRequest(),
		)
	})

	test("a close button in the content closes the modal", () => {
		Scene.scene(
			config,
			...opened,
			Scene.click(Scene.role("button", { name: "Cancel" })),
			...closedByRequest(),
		)
	})

	test("a press on the backdrop dismisses the modal", () => {
		Scene.scene(config, ...opened, Scene.click(backdrop), ...closedByRequest())
	})

	test("an alert dialog has no close icon and its backdrop does not dismiss", () => {
		Scene.scene(
			{ update, view: wrapped({ role: "alertdialog" }) },
			...opened,
			Scene.expect(Scene.role("alertdialog", { name: "Rename thread" })).toExist(),
			Scene.expect(Scene.role("button", { name: "Close" })).toBeAbsent(),
		)
	})
})
