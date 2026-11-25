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

const groupView = (isMine: boolean) =>
	Scene.withViewInputs(view, {
		toTrigger: () =>
			markdownView(ih, "Hi @[group:g-1] and @[group:g-gone]", {
				mentions: [],
				emojis: [],
				groups: [{ groupId: "g-1", handle: "design", isMine }],
			}),
		toContent: () => [],
	})

const chip = (groupId: string) => Scene.selector(`[data-group-mention="${groupId}"]`)

describe("markdown group mention", () => {
	test("renders the group's handle; a deleted group reads as @group", () => {
		Scene.scene(
			{ update, view: groupView(false)() },
			Scene.given(init("group")),
			Scene.expect(chip("g-1")).toContainText("@design"),
			Scene.expect(chip("g-gone")).toContainText("@group"),
			Scene.expect(chip("g-1")).toHaveClass("text-primary"),
		)
	})

	test("is highlighted when the viewer is in the group", () => {
		Scene.scene(
			{ update, view: groupView(true)() },
			Scene.given(init("group")),
			Scene.expect(chip("g-1")).toHaveClass("bg-primary"),
			Scene.expect(chip("g-1")).toHaveClass("text-primary-fg"),
		)
	})
})
