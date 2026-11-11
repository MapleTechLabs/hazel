// @vitest-environment jsdom
import * as Scene from "foldkit/scene"
import { inertHtml as ih } from "foldkit/html"
import { describe, test } from "vitest"
import { dialogClose, dialogFooter, dialogHeader } from "./dialog"
import { AcquireResources, initOpen, Message, titleId, update } from "./modal"
import { view } from "./sheet"

/** Sheet through the view: a Modal with an edge panel, sharing the Modal Model and update. */

const sceneView = Scene.withViewInputs(view, {
	toContent: (closeAttributes) => [
		dialogHeader(ih, { title: { id: titleId("details"), text: "Channel details" } }),
		dialogFooter(ih, [dialogClose(ih, closeAttributes, ["Done"])]),
	],
})

type Inputs = Parameters<typeof sceneView>[0]
// A closed sheet renders nothing, so the scene view wraps it in an element.
const wrapped =
	(inputs?: Inputs) =>
	(...args: Parameters<ReturnType<typeof sceneView>>) =>
		ih.main([], [sceneView(inputs)(...args)])
const config = { update, view: wrapped() }
const sheet = Scene.role("dialog", { name: "Channel details" })
const opened = [
	Scene.given(initOpen("details")),
	Scene.Mount.resolve(AcquireResources, Message.SucceededAcquireResources()),
]

describe("sheet scene", () => {
	test("an open sheet is a dialog labelled by its title", () => {
		Scene.scene(config, ...opened, Scene.expect(sheet).toHaveAttr("aria-modal", "true"))
	})

	test("an aria-label names a sheet without a title", () => {
		Scene.scene(
			{ update, view: wrapped({ ariaLabel: "Sidebar", toContent: () => [] }) },
			...opened,
			Scene.expect(Scene.role("dialog", { name: "Sidebar" })).toExist(),
		)
	})

	test("Done closes the sheet", () => {
		Scene.scene(
			config,
			...opened,
			Scene.click(Scene.role("button", { name: "Done" })),
			Scene.Mount.expectEnded(AcquireResources),
			Scene.expect(Scene.role("dialog")).toBeAbsent(),
		)
	})

	test("panel attributes land on the panel", () => {
		Scene.scene(
			{ update, view: wrapped({ panelAttributes: { "data-intent": "default" } }) },
			...opened,
			Scene.expect(Scene.selector('[data-intent="default"]')).toExist(),
		)
	})
})
