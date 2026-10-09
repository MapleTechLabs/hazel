// @vitest-environment jsdom
import * as Scene from "foldkit/scene"
import { inertHtml as ih } from "foldkit/html"
import { describe, test } from "vitest"
import {
	init,
	Message,
	PortalTooltip,
	TrackTrigger,
	update,
	view,
	WaitForTooltipHideDelay,
	WaitForTooltipShowDelay,
} from "./tooltip"

/** Tooltip through the view: hover and focus come from the TrackTrigger Mount's listeners. */

const sceneView = Scene.withViewInputs(view, {
	toTrigger: (attributes, overlay) => ih.div([], [ih.button([...attributes], ["Add reaction"]), overlay]),
	content: ["React with an emoji"],
})

const config = { update, view: sceneView() }
const trigger = Scene.role("button", { name: "Add reaction" })
const tooltip = Scene.role("tooltip")
const tracked = [
	Scene.given(init("react")),
	Scene.Mount.resolve(TrackTrigger, Message.CompletedTrackTrigger()),
]
const shownByFocus = [
	...tracked,
	Scene.Subscription.emit(Message.FocusedTrigger({ isFocusVisible: true })),
	Scene.Mount.resolve(PortalTooltip, Message.CompletedPortalTooltip()),
]

describe("tooltip scene", () => {
	test("the trigger tracks hover and focus, with no tooltip until one starts", () => {
		Scene.scene(
			config,
			Scene.given(init("react")),
			Scene.Mount.expectExact(TrackTrigger()),
			Scene.Mount.resolve(TrackTrigger, Message.CompletedTrackTrigger()),
			Scene.expect(trigger).toHaveId("react-trigger"),
			Scene.expect(trigger).not.toHaveAttr("aria-describedby"),
			Scene.expect(tooltip).toBeAbsent(),
		)
	})

	test("hovering shows the tooltip after the delay and describes the trigger", () => {
		Scene.scene(
			config,
			...tracked,
			Scene.Subscription.emit(Message.HoveredTrigger({ isPointerModality: true })),
			Scene.expect(tooltip).toBeAbsent(),
			Scene.Command.expectExact(WaitForTooltipShowDelay({ version: 1, delayMs: 1500 })),
			Scene.Command.resolve(WaitForTooltipShowDelay, Message.CompletedWaitForShowDelay({ version: 1 })),
			Scene.Mount.expectExact(PortalTooltip({ id: "react", placement: "top", offset: 10 })),
			Scene.Mount.resolve(PortalTooltip, Message.CompletedPortalTooltip()),
			Scene.expect(tooltip).toHaveText("React with an emoji"),
			Scene.expect(tooltip).toHaveId("react-tooltip"),
			Scene.expect(trigger).toHaveAttr("aria-describedby", "react-tooltip"),
			Scene.expect(trigger).toHaveAccessibleDescription("React with an emoji"),
		)
	})

	test("keyboard focus shows the tooltip at once", () => {
		Scene.scene(config, ...shownByFocus, Scene.Command.expectNone(), Scene.expect(tooltip).toExist())
	})

	test("Escape anywhere in the document hides the tooltip", () => {
		Scene.scene(
			config,
			...shownByFocus,
			Scene.Subscription.emit(Message.PressedEscape()),
			Scene.Mount.expectEnded(PortalTooltip),
			Scene.expect(tooltip).toBeAbsent(),
			Scene.expect(trigger).not.toHaveAttr("aria-describedby"),
		)
	})

	test("blurring the trigger hides the tooltip without a delay", () => {
		Scene.scene(
			config,
			...shownByFocus,
			Scene.Subscription.emit(Message.BlurredTrigger()),
			Scene.Command.expectNone(),
			Scene.Mount.expectEnded(PortalTooltip),
			Scene.expect(tooltip).toBeAbsent(),
		)
	})

	test("leaving the trigger hides the tooltip after the hide delay", () => {
		Scene.scene(
			config,
			...tracked,
			Scene.Subscription.emit(Message.HoveredTrigger({ isPointerModality: true })),
			Scene.Command.resolve(WaitForTooltipShowDelay, Message.CompletedWaitForShowDelay({ version: 1 })),
			Scene.Mount.resolve(PortalTooltip, Message.CompletedPortalTooltip()),
			Scene.Subscription.emit(Message.UnhoveredTrigger()),
			Scene.expect(tooltip).toExist(),
			Scene.Command.resolve(WaitForTooltipHideDelay, Message.CompletedWaitForHideDelay({ version: 2 })),
			Scene.Mount.expectEnded(PortalTooltip),
			Scene.expect(tooltip).toBeAbsent(),
		)
	})

	test("an inverse tooltip without an arrow renders only its content", () => {
		Scene.scene(
			{ update, view: sceneView({ arrow: false, inverse: true, placement: "bottom" }) },
			...tracked,
			Scene.Subscription.emit(Message.FocusedTrigger({ isFocusVisible: true })),
			Scene.Mount.expectExact(PortalTooltip({ id: "react", placement: "bottom", offset: 10 })),
			Scene.Mount.resolve(PortalTooltip, Message.CompletedPortalTooltip()),
			Scene.expect(Scene.within(tooltip, Scene.selector("svg"))).toBeAbsent(),
		)
	})
})
