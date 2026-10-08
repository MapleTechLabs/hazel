// @vitest-environment jsdom
import * as Scene from "foldkit/scene"
import { type ChildAttribute, type Html, inertHtml as ih } from "foldkit/html"
import { describe, test } from "vitest"
import { FocusElement, init, item, leaf, Message, OutMessage, update } from "./menu"
import { contextMenuView, FocusTriggerOnPress, menuLabel, view } from "./menu-view"

/** Menu through the view: trigger ARIA, open and close by pointer and keys, submenus, context menus. */

const labels: Readonly<Record<string, string>> = {
	new: "New file",
	open: "Open file",
	archive: "Archive",
	share: "Share",
	email: "Email",
	slack: "Slack",
}
const viewInputs = {
	toTrigger: (attributes: ReadonlyArray<ChildAttribute>, overlay: Html) =>
		ih.button([...attributes, ih.Attribute("aria-label", "File")], ["File", overlay]),
	content: (key: string) => [menuLabel(ih, "file", key, labels[key] ?? key)],
}
const entries = [
	item("new", { textValue: "New file" }),
	item("open", { textValue: "Open file" }),
	item("archive", { isDisabled: true }),
	item("share", { submenu: [leaf("email"), leaf("slack")] }),
]
const config = { update, view: Scene.withViewInputs(view, viewInputs)() }
const trigger = Scene.role("button", { name: "File" })
const menuItem = (name: string) => Scene.role("menuitem", { name })
const portal = { name: "PortalMenu" }
const mounted = Scene.Mount.resolve(FocusTriggerOnPress, Message.CompletedFocusTriggerOnPress())
const portalled = Scene.Mount.resolve(portal, Message.CompletedPortalMenu())
const resolveFocus = Scene.Command.resolve(FocusElement, Message.CompletedFocusElement())

describe("menu scene", () => {
	test("a closed trigger advertises its popup and renders no menu", () => {
		Scene.scene(
			config,
			Scene.given(init({ id: "file", entries })),
			mounted,
			Scene.expect(trigger).toHaveAttr("aria-haspopup", "true"),
			Scene.expect(trigger).toHaveAttr("aria-expanded", "false"),
			Scene.expect(trigger).not.toHaveAttr("aria-controls"),
			Scene.expect(Scene.role("menu")).toBeAbsent(),
		)
	})

	test("pressing the trigger opens a menu labelled by it with every item", () => {
		Scene.scene(
			config,
			Scene.given(init({ id: "file", entries })),
			mounted,
			Scene.pointerDown(trigger),
			portalled,
			Scene.expect(trigger).toHaveAttr("aria-expanded", "true"),
			Scene.expect(trigger).toHaveAttr("aria-controls", "file-menu"),
			Scene.expect(Scene.role("menu")).toHaveId("file-menu"),
			Scene.expect(Scene.role("menu")).toHaveAttr("aria-labelledby", "file-trigger"),
			Scene.expectAll(Scene.all.role("menuitem")).toHaveCount(4),
			Scene.expect(menuItem("New file")).not.toHaveAttr("data-focused"),
		)
	})

	test("a right-button press on the trigger is ignored", () => {
		Scene.scene(
			config,
			Scene.given(init({ id: "file", entries })),
			mounted,
			Scene.pointerDown(trigger, { button: 2 }),
			Scene.expectIgnored(),
			Scene.expect(trigger).toHaveAttr("aria-expanded", "false"),
		)
	})

	test("ArrowDown on the trigger opens the menu and focuses the first item", () => {
		Scene.scene(
			config,
			Scene.given(init({ id: "file", entries })),
			mounted,
			Scene.keydown(trigger, "ArrowDown"),
			Scene.expectHandled(),
			Scene.Mount.expectHas({ name: "PortalMenu" }),
			portalled,
			Scene.expect(menuItem("New file")).toHaveAttr("data-focused", "true"),
			Scene.expect(menuItem("New file")).toHaveAttr("data-focus-visible", "true"),
			Scene.keydown(Scene.role("dialog"), "ArrowDown"),
			Scene.Command.expectExact(FocusElement({ elementId: "file-item-open" })),
			resolveFocus,
			Scene.expect(menuItem("Open file")).toHaveAttr("data-focused", "true"),
			Scene.expect(menuItem("New file")).not.toHaveAttr("data-focused"),
		)
	})

	test("a key the trigger does not handle falls through", () => {
		Scene.scene(
			config,
			Scene.given(init({ id: "file", entries })),
			mounted,
			Scene.keydown(trigger, "a"),
			Scene.expectIgnored(),
			Scene.expect(Scene.role("menu")).toBeAbsent(),
		)
	})

	test("clicking an item closes the menu and reports the selection", () => {
		Scene.scene(
			config,
			Scene.given(init({ id: "file", entries })),
			mounted,
			Scene.pointerDown(trigger),
			portalled,
			Scene.click(menuItem("Open file")),
			Scene.expectOutMessage(OutMessage.SelectedItem({ key: "open" })),
			Scene.Mount.expectEnded(portal),
			Scene.expect(Scene.role("menu")).toBeAbsent(),
			Scene.expect(trigger).toHaveAttr("aria-expanded", "false"),
		)
	})

	test("a disabled item is aria-disabled and clicking it keeps the menu open", () => {
		Scene.scene(
			config,
			Scene.given(init({ id: "file", entries })),
			mounted,
			Scene.pointerDown(trigger),
			portalled,
			Scene.expect(menuItem("Archive")).toHaveAttr("aria-disabled", "true"),
			Scene.click(menuItem("Archive")),
			Scene.expectNoOutMessage(),
			Scene.expect(Scene.role("menu")).toExist(),
		)
	})

	test("a single-selection menu renders radio items with the selected one checked", () => {
		Scene.scene(
			config,
			Scene.given(init({ id: "file", entries, selectionMode: "Single", selectedKeys: ["open"] })),
			mounted,
			Scene.pointerDown(trigger),
			portalled,
			Scene.expect(Scene.role("menuitemradio", { name: "Open file" })).toHaveAttr(
				"aria-checked",
				"true",
			),
			Scene.expect(Scene.role("menuitemradio", { name: "New file" })).toHaveAttr(
				"aria-checked",
				"false",
			),
			Scene.click(Scene.role("menuitemradio", { name: "New file" })),
			Scene.expectOutMessage(OutMessage.SelectedItem({ key: "new" })),
			Scene.Mount.expectEnded(portal),
			Scene.pointerDown(trigger),
			portalled,
			Scene.expect(Scene.role("menuitemradio", { name: "New file" })).toHaveAttr(
				"aria-checked",
				"true",
			),
		)
	})

	test("ArrowRight on a submenu trigger expands it and Escape collapses it again", () => {
		Scene.scene(
			config,
			Scene.given(init({ id: "file", entries })),
			mounted,
			Scene.keydown(trigger, "ArrowUp"),
			portalled,
			Scene.expect(menuItem("Share")).toHaveAttr("aria-haspopup", "menu"),
			Scene.expect(menuItem("Share")).toHaveAttr("aria-expanded", "false"),
			Scene.keydown(Scene.role("dialog"), "ArrowRight"),
			Scene.Command.expectExact(FocusElement({ elementId: "file-item-email" })),
			resolveFocus,
			Scene.Mount.resolve({ name: "PositionSubmenu" }, Message.CompletedPositionMenu()),
			Scene.expect(menuItem("Share")).toHaveAttr("aria-expanded", "true"),
			Scene.expect(menuItem("Share")).toHaveAttr("aria-controls", "file-submenu"),
			Scene.expectAll(Scene.all.role("menu")).toHaveCount(2),
			Scene.expect(Scene.selector("#file-submenu")).toHaveAttr("aria-labelledby", "file-item-share"),
			Scene.expect(menuItem("Email")).toHaveAttr("data-focused", "true"),
			Scene.keydown(Scene.first(Scene.all.role("dialog")), "Escape"),
			Scene.Command.expectExact(FocusElement({ elementId: "file-item-share" })),
			resolveFocus,
			Scene.Mount.expectEnded({ name: "PositionSubmenu" }),
			Scene.expect(menuItem("Share")).toHaveAttr("aria-expanded", "false"),
			Scene.expect(menuItem("Email")).toBeAbsent(),
		)
	})

	test("the hidden Dismiss button closes the menu", () => {
		Scene.scene(
			config,
			Scene.given(init({ id: "file", entries })),
			mounted,
			Scene.pointerDown(trigger),
			portalled,
			Scene.click(Scene.first(Scene.all.role("button", { name: "Dismiss" }))),
			Scene.Mount.expectEnded(portal),
			Scene.expect(Scene.role("menu")).toBeAbsent(),
		)
	})
})

const contextConfig = { update, view: Scene.withViewInputs(contextMenuView, viewInputs)() }
const capture = { name: "CaptureContextMenu" }

describe("context menu scene", () => {
	test("a right-click opens the menu at the pointer, unlabelled by the trigger", () => {
		Scene.scene(
			contextConfig,
			Scene.given(init({ id: "file", entries, anchor: "Pointer" })),
			Scene.expect(trigger).toHaveAttr("aria-haspopup", "menu"),
			Scene.Mount.resolve(capture, Message.PressedContextMenu({ offset: -20, crossOffset: 40 })),
			portalled,
			Scene.expect(Scene.role("dialog")).toHaveId("file-popover"),
			Scene.expect(Scene.role("dialog")).not.toHaveAttr("aria-labelledby"),
			Scene.expect(Scene.role("menu")).not.toHaveAttr("aria-labelledby"),
			Scene.expect(menuItem("New file")).not.toHaveAttr("data-focused"),
		)
	})

	test("arrow keys go to the menu, the popover itself only handles Escape", () => {
		Scene.scene(
			contextConfig,
			Scene.given(init({ id: "file", entries, anchor: "Pointer" })),
			Scene.Mount.resolve(capture, Message.PressedContextMenu({ offset: 0, crossOffset: 0 })),
			portalled,
			Scene.keydown(Scene.role("dialog"), "ArrowDown"),
			Scene.expectIgnored(),
			Scene.keydown(Scene.role("menu"), "ArrowDown"),
			Scene.Command.expectExact(FocusElement({ elementId: "file-item-new" })),
			resolveFocus,
			Scene.expect(menuItem("New file")).toHaveAttr("data-focused", "true"),
			Scene.keydown(Scene.role("dialog"), "Escape"),
			Scene.Mount.expectEnded(portal),
			Scene.expect(Scene.role("menu")).toBeAbsent(),
		)
	})
})
