// @vitest-environment jsdom
import * as Scene from "foldkit/scene"
import { describe, test } from "vitest"
import { AnnounceComboBox, FocusComboBoxInput, init, item, Message, OutMessage, update } from "./combo-box"
import { view } from "./combo-box-view"

/** ComboBox through the view: combobox ARIA, virtual focus via aria-activedescendant, commit and revert. */

const items = [
	item("general", "General"),
	item("design", "Design"),
	item("engineering", "Engineering", true),
	item("cafe", "Café"),
]
const sceneView = Scene.withViewInputs(view, { label: "Channel", placeholder: "Pick a channel" })
const config = { update, view: sceneView() }
const input = Scene.role("combobox")
const button = Scene.label("Show suggestions")
const listbox = Scene.role("listbox")
const option = (name: string) => Scene.within(listbox, Scene.role("option", { name }))
const mounted = Scene.Mount.resolveAll(
	[{ name: "KeepComboBoxTypedValue" }, Message.CompletedPortalComboBox()],
	[{ name: "KeepComboBoxInputFocus" }, Message.CompletedPortalComboBox()],
)
const portal = { name: "PortalComboBox" }
const portalled = Scene.Mount.resolve(portal, Message.CompletedPortalComboBox())
const announced = (text: string) =>
	Scene.Command.resolve(AnnounceComboBox({ message: text }), Message.CompletedAnnounce())

describe("combo box scene", () => {
	test("a closed combo box is a labelled, collapsed list autocomplete", () => {
		Scene.scene(
			config,
			Scene.given(init({ id: "channel", items, isAppleDevice: false })),
			mounted,
			Scene.expect(input).toHaveAttr("aria-labelledby", "channel-label"),
			Scene.expect(input).toHaveAttr("aria-autocomplete", "list"),
			Scene.expect(input).toHaveAttr("aria-expanded", "false"),
			Scene.expect(input).not.toHaveAttr("aria-controls"),
			Scene.expect(Scene.placeholder("Pick a channel")).toExist(),
			Scene.expect(listbox).toBeAbsent(),
		)
	})

	test("typing opens the list with only the matching options and no active option", () => {
		Scene.scene(
			config,
			Scene.given(init({ id: "channel", items, isAppleDevice: false })),
			mounted,
			Scene.type(input, "cafe"),
			announced("1 option available."),
			portalled,
			Scene.expect(input).toHaveAttr("aria-expanded", "true"),
			Scene.expect(input).toHaveAttr("aria-controls", "channel-listbox"),
			Scene.expect(input).not.toHaveAttr("aria-activedescendant"),
			Scene.inside(listbox, Scene.expectAll(Scene.all.role("option")).toHaveCount(1)),
			Scene.expect(option("Café")).toExist(),
		)
	})

	test("ArrowDown moves the virtual focus with aria-activedescendant, past the disabled option", () => {
		Scene.scene(
			config,
			Scene.given(init({ id: "channel", items, isAppleDevice: false })),
			mounted,
			Scene.keydown(input, "ArrowDown"),
			Scene.expectHandled(),
			portalled,
			Scene.expect(input).toHaveAttr("aria-activedescendant", "channel-listbox-option-general"),
			Scene.expect(option("General")).toHaveAttr("data-focus-visible", "true"),
			Scene.keydown(input, "ArrowDown"),
			Scene.keydown(input, "ArrowDown"),
			Scene.expect(input).toHaveAttr("aria-activedescendant", "channel-listbox-option-cafe"),
			Scene.expect(option("Engineering")).toHaveAttr("aria-disabled", "true"),
		)
	})

	test("Enter commits the active option into the input and closes the list", () => {
		Scene.scene(
			config,
			Scene.given(init({ id: "channel", items, isAppleDevice: false })),
			mounted,
			Scene.keydown(input, "ArrowDown"),
			portalled,
			Scene.keydown(input, "Enter"),
			Scene.expectOutMessage(OutMessage.ChangedSelection({ key: "general" })),
			Scene.Mount.expectEnded(portal),
			Scene.expect(input).toHaveValue("General"),
			Scene.expect(input).toHaveAttr("aria-expanded", "false"),
			Scene.expect(input).not.toHaveAttr("aria-activedescendant"),
		)
	})

	test("Escape throws away the typed text and restores the selected label", () => {
		Scene.scene(
			config,
			Scene.given(init({ id: "channel", items, selectedKey: "design", isAppleDevice: false })),
			mounted,
			Scene.expect(input).toHaveValue("Design"),
			Scene.type(input, "gen"),
			announced("1 option available."),
			portalled,
			Scene.keydown(input, "Escape"),
			Scene.expectNoOutMessage(),
			Scene.Mount.expectEnded(portal),
			Scene.expect(input).toHaveValue("Design"),
			Scene.expect(listbox).toBeAbsent(),
		)
	})

	test("the button opens every option on the selection and returns focus to the input", () => {
		Scene.scene(
			config,
			Scene.given(init({ id: "channel", items, selectedKey: "design", isAppleDevice: false })),
			mounted,
			Scene.expect(button).toHaveAttr("aria-haspopup", "listbox"),
			Scene.pointerDown(button),
			Scene.Command.expectExact(FocusComboBoxInput({ elementId: "channel-input" })),
			Scene.Command.resolve(FocusComboBoxInput, Message.CompletedFocusInput()),
			portalled,
			Scene.expect(button).toHaveAttr("aria-expanded", "true"),
			Scene.inside(listbox, Scene.expectAll(Scene.all.role("option")).toHaveCount(4)),
			Scene.expect(option("Design")).toHaveAttr("aria-selected", "true"),
			Scene.expect(option("General")).toHaveAttr("aria-selected", "false"),
			Scene.pointerDown(button),
			Scene.Command.resolve(FocusComboBoxInput, Message.CompletedFocusInput()),
			Scene.Mount.expectEnded(portal),
			Scene.expect(listbox).toBeAbsent(),
		)
	})

	test("a touch press on the button is left to the browser", () => {
		Scene.scene(
			config,
			Scene.given(init({ id: "channel", items, isAppleDevice: false })),
			mounted,
			Scene.pointerDown(button, { pointerType: "touch" }),
			Scene.expectIgnored(),
			Scene.expect(listbox).toBeAbsent(),
		)
	})

	test("clicking an option commits it, clicking a disabled one does nothing", () => {
		Scene.scene(
			config,
			Scene.given(init({ id: "channel", items, isAppleDevice: false })),
			mounted,
			Scene.keydown(input, "ArrowDown"),
			portalled,
			Scene.click(option("Engineering")),
			Scene.expectNoOutMessage(),
			Scene.expect(listbox).toExist(),
			Scene.click(option("Café")),
			Scene.expectOutMessage(OutMessage.ChangedSelection({ key: "cafe" })),
			Scene.Mount.expectEnded(portal),
			Scene.expect(input).toHaveValue("Café"),
		)
	})

	test("Tab and other keys in the input fall through to the browser", () => {
		Scene.scene(
			config,
			Scene.given(init({ id: "channel", items, isAppleDevice: false })),
			mounted,
			Scene.keydown(input, "Tab"),
			Scene.expectIgnored(),
			Scene.keydown(input, "Home"),
			Scene.expectIgnored(),
		)
	})

	test("without a label the listbox is named by the suggestions button", () => {
		Scene.scene(
			{ update, view: sceneView({ label: undefined }) },
			Scene.given(init({ id: "channel", items, isAppleDevice: false })),
			mounted,
			Scene.expect(input).not.toHaveAttr("aria-labelledby"),
			Scene.keydown(input, "ArrowUp"),
			portalled,
			Scene.expect(input).toHaveAttr("aria-activedescendant", "channel-listbox-option-cafe"),
			Scene.expect(listbox).toHaveAttr("aria-labelledby", "channel-listbox channel-button"),
		)
	})
})
