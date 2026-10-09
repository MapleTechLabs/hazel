// @vitest-environment jsdom
import * as Scene from "foldkit/scene"
import { describe, test } from "vitest"
import { FocusSelectElement, init, item, Message, OutMessage, update } from "./select"
import { view } from "./select-view"

/** Select through the view: trigger ARIA, listbox options, keyboard and pointer selection. */

const items = [
	item("never", "Don't clear"),
	item("30m", "30 minutes"),
	item("1h", "1 hour", true),
	item("today", "Today"),
]
const sceneView = Scene.withViewInputs(view, { label: "Clear after", placeholder: "Choose a time" })
const config = { update, view: sceneView() }
const trigger = Scene.selector("#clear-trigger")
const listbox = Scene.role("listbox")
const option = (name: string) => Scene.within(listbox, Scene.role("option", { name }))
const mounted = Scene.Mount.resolve({ name: "FocusSelectTriggerOnPress" }, Message.CompletedPortalSelect())
const portal = { name: "PortalSelect" }
const portalled = Scene.Mount.resolve(portal, Message.CompletedPortalSelect())
const resolveFocus = Scene.Command.resolve(FocusSelectElement, Message.CompletedFocusElement())

describe("select scene", () => {
	test("a closed select shows its label, placeholder and a collapsed listbox trigger", () => {
		Scene.scene(
			config,
			Scene.given(init({ id: "clear", items })),
			mounted,
			Scene.expect(Scene.text("Clear after")).toExist(),
			Scene.expect(trigger).toContainText("Choose a time"),
			Scene.expect(trigger).toHaveAttr("aria-haspopup", "listbox"),
			Scene.expect(trigger).toHaveAttr("aria-expanded", "false"),
			Scene.expect(trigger).toHaveAttr("aria-labelledby", "clear-value clear-label"),
			Scene.expect(Scene.role("listbox")).toBeAbsent(),
		)
	})

	test("pressing the trigger opens the listbox with the selection marked", () => {
		Scene.scene(
			config,
			Scene.given(init({ id: "clear", items, selectedKey: "30m" })),
			mounted,
			Scene.pointerDown(trigger),
			portalled,
			Scene.expect(trigger).toHaveAttr("aria-expanded", "true"),
			Scene.expect(trigger).toHaveAttr("aria-controls", "clear-listbox"),
			Scene.expect(Scene.role("listbox")).toHaveId("clear-listbox"),
			Scene.inside(listbox, Scene.expectAll(Scene.all.role("option")).toHaveCount(4)),
			Scene.expect(option("30 minutes")).toHaveAttr("aria-selected", "true"),
			Scene.expect(option("Today")).toHaveAttr("aria-selected", "false"),
			Scene.expect(option("1 hour")).toHaveAttr("aria-disabled", "true"),
		)
	})

	test("ArrowDown on the trigger opens on the first option and arrows move the focus", () => {
		Scene.scene(
			config,
			Scene.given(init({ id: "clear", items })),
			mounted,
			Scene.keydown(trigger, "ArrowDown"),
			Scene.expectHandled(),
			portalled,
			Scene.expect(option("Don't clear")).toHaveAttr("data-focus-visible", "true"),
			Scene.keydown(Scene.role("dialog"), "End"),
			Scene.Command.expectExact(FocusSelectElement({ elementId: "clear-listbox-option-today" })),
			resolveFocus,
			Scene.expect(option("Today")).toHaveAttr("data-focused", "true"),
			Scene.expect(option("Don't clear")).not.toHaveAttr("data-focused"),
		)
	})

	test("clicking an option selects it, closes the listbox and shows its label", () => {
		Scene.scene(
			config,
			Scene.given(init({ id: "clear", items })),
			mounted,
			Scene.pointerDown(trigger),
			portalled,
			Scene.click(option("Today")),
			Scene.expectOutMessage(OutMessage.ChangedSelection({ key: "today" })),
			Scene.Mount.expectEnded(portal),
			Scene.expect(Scene.role("listbox")).toBeAbsent(),
			Scene.expect(trigger).toContainText("Today"),
			Scene.expect(trigger).toHaveAttr("aria-expanded", "false"),
		)
	})

	test("Escape closes the listbox and Tab is left to the browser", () => {
		Scene.scene(
			config,
			Scene.given(init({ id: "clear", items })),
			mounted,
			Scene.keydown(trigger, "Enter"),
			portalled,
			Scene.keydown(Scene.role("dialog"), "Tab"),
			Scene.expectIgnored(),
			Scene.keydown(Scene.role("dialog"), "Escape"),
			Scene.expectNoOutMessage(),
			Scene.Mount.expectEnded(portal),
			Scene.expect(Scene.role("listbox")).toBeAbsent(),
		)
	})

	test("ArrowRight on the closed trigger changes the shown value without opening", () => {
		Scene.scene(
			config,
			Scene.given(init({ id: "clear", items, selectedKey: "never" })),
			mounted,
			Scene.keydown(trigger, "ArrowRight"),
			Scene.expectOutMessage(OutMessage.ChangedSelection({ key: "30m" })),
			Scene.expect(trigger).toContainText("30 minutes"),
			Scene.expect(Scene.role("listbox")).toBeAbsent(),
		)
	})

	test("focusing the trigger marks the field focused until it blurs", () => {
		Scene.scene(
			config,
			Scene.given(init({ id: "clear", items })),
			mounted,
			Scene.focus(trigger),
			Scene.expect(Scene.selector("[data-focused]")).toHaveAttr("data-slot", "control"),
			Scene.blur(trigger),
			Scene.expect(Scene.selector("[data-focused]")).toBeAbsent(),
		)
	})

	test("a disabled select disables its trigger and hidden native select", () => {
		Scene.scene(
			config,
			Scene.given(init({ id: "clear", items, isDisabled: true })),
			mounted,
			Scene.expect(trigger).toBeDisabled(),
			Scene.expect(trigger).toHaveAttr("data-disabled", "true"),
			Scene.expect(Scene.selector("select")).toBeDisabled(),
		)
	})

	// T6: with only an aria-label, the popover and listbox are labelled by the trigger, as in React Aria.
	test("an aria-label-only select does not label its listbox by a missing element", () => {
		Scene.scene(
			{ update, view: sceneView({ label: undefined, ariaLabel: "Clear after" }) },
			Scene.given(init({ id: "clear", items })),
			mounted,
			Scene.expect(trigger).toHaveAttr("aria-label", "Clear after"),
			Scene.pointerDown(trigger),
			portalled,
			Scene.expect(Scene.role("listbox")).not.toHaveAttr("aria-labelledby", "clear-label"),
			Scene.expect(Scene.role("listbox")).toHaveAttr("aria-labelledby", "clear-trigger"),
			Scene.expect(Scene.role("dialog")).toHaveAttr("aria-labelledby", "clear-trigger"),
		)
	})
})
