// @vitest-environment jsdom
import { Duration } from "effect"
import * as Scene from "foldkit/scene"
import { inertHtml as ih } from "foldkit/html"
import { describe, test } from "vitest"
import { AnchorTooltipPanel, init, Message, update, view, WaitBeforeShowing } from "./tooltip"

/** Tooltip through the view: hover, focus, press and Escape come from the trigger's own handlers. */

const sceneView = Scene.withViewInputs(view, {
	toTrigger: (attributes, overlay) => ih.div([], [ih.button([...attributes], ["Add reaction"]), overlay]),
	content: ["React with an emoji"],
})

const config = { update, view: sceneView() }
const trigger = Scene.role("button", { name: "Add reaction" })
const tooltip = Scene.role("tooltip")
const anchored = Scene.Mount.resolve(AnchorTooltipPanel, Message.CompletedAnchorTooltip())
const shownByFocus = [Scene.given(init("react")), Scene.focus(trigger), anchored]

describe("tooltip scene", () => {
	test("no tooltip renders until the trigger is hovered or focused", () => {
		Scene.scene(
			config,
			Scene.given(init("react")),
			Scene.expect(trigger).toHaveId("react-trigger"),
			Scene.expect(tooltip).toBeAbsent(),
		)
	})

	test("hovering shows the tooltip after the delay and describes the trigger", () => {
		Scene.scene(
			config,
			Scene.given(init("react")),
			Scene.hover(trigger),
			Scene.expect(tooltip).toBeAbsent(),
			Scene.Command.expectExact(WaitBeforeShowing({ delay: Duration.millis(1500), version: 1 })),
			Scene.Command.resolve(WaitBeforeShowing, Message.CompletedWaitBeforeShowing({ version: 1 })),
			Scene.Mount.expectExact(
				AnchorTooltipPanel({
					buttonId: "react-trigger",
					anchor: { placement: "top", gap: 10, padding: 8 },
					arrowId: "react-arrow",
				}),
			),
			anchored,
			Scene.expect(tooltip).toHaveText("React with an emoji"),
			Scene.expect(tooltip).toHaveId("react-panel"),
			Scene.expect(trigger).toHaveAttr("aria-describedby", "react-panel"),
			Scene.expect(trigger).toHaveAccessibleDescription("React with an emoji"),
		)
	})

	test("keyboard focus shows the tooltip at once", () => {
		Scene.scene(config, ...shownByFocus, Scene.Command.expectNone(), Scene.expect(tooltip).toExist())
	})

	test("focus from a mouse press does not show the tooltip", () => {
		Scene.scene(
			config,
			Scene.given(init("react")),
			Scene.pointerDown(trigger),
			Scene.focus(trigger),
			Scene.expect(tooltip).toBeAbsent(),
		)
	})

	test("Escape on the trigger hides the tooltip", () => {
		Scene.scene(
			config,
			...shownByFocus,
			Scene.keydown(trigger, "Escape"),
			Scene.Mount.expectEnded(AnchorTooltipPanel),
			Scene.expect(tooltip).toBeAbsent(),
		)
	})

	test("blurring the trigger hides the tooltip without a delay", () => {
		Scene.scene(
			config,
			...shownByFocus,
			Scene.blur(trigger),
			Scene.Command.expectNone(),
			Scene.Mount.expectEnded(AnchorTooltipPanel),
			Scene.expect(tooltip).toBeAbsent(),
		)
	})

	test("an inverse tooltip without an arrow renders only its content at the mapped placement", () => {
		Scene.scene(
			{ update, view: sceneView({ arrow: false, inverse: true, placement: "end top" }) },
			Scene.given(init("react")),
			Scene.focus(trigger),
			Scene.Mount.expectExact(
				AnchorTooltipPanel({
					buttonId: "react-trigger",
					anchor: { placement: "right-start", gap: 10, padding: 8 },
					arrowId: "react-arrow",
				}),
			),
			anchored,
			Scene.expect(Scene.within(tooltip, Scene.selector("svg"))).toBeAbsent(),
		)
	})
})
