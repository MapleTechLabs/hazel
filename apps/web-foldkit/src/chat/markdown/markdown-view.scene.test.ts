// @vitest-environment jsdom
import * as Scene from "foldkit/scene"
import { inertHtml as ih } from "foldkit/html"
import { describe, test } from "vitest"
import { init, update, view } from "../../ui/popover"
import { markdownView } from "./markdown-view"

/** A user mention rendered as its profile popover's trigger, the way a message row renders it. */

const sceneView = Scene.withViewInputs(view, {
	toTrigger: (attributes) =>
		markdownView(
			ih,
			"Hi @[userId:user-1]",
			{ mentions: [{ userId: "user-1", name: "Ada" }], emojis: [] },
			(_mention, toTrigger) => toTrigger(attributes),
		),
	toContent: () => [],
})

const config = { update, view: sceneView() }
const mention = Scene.role("button")

describe("markdown mention", () => {
	test("the mention is the popover's trigger, a plain button", () => {
		Scene.scene(
			config,
			Scene.given(init("mention")),
			Scene.expect(mention).toHaveAttr("type", "button"),
			Scene.expect(mention).toHaveAttr("aria-expanded", "false"),
			Scene.expect(mention).toHaveId("mention-button"),
		)
	})
})
