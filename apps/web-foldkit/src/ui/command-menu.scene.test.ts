// @vitest-environment jsdom
import * as Scene from "foldkit/scene"
import { type HtmlBuilder, inertHtml as ih } from "foldkit/html"
import { describe, test } from "vitest"
import { init, item, Message, type Model, OutMessage, open, section, update } from "./command-menu"
import { commandMenuDescription, PortalCommandMenu, view } from "./command-menu-view"
import { menuLabel } from "./menu-view"

/** Command menu through the view: the labelled dialog, search filtering, virtual focus and dismissal. */

const ID = "palette"
const labels: Readonly<Record<string, string>> = {
	general: "general",
	design: "design",
	create: "Create channel",
}
const sceneView = Scene.withViewInputs(view, {
	content: (key) => [
		menuLabel(ih, ID, key, labels[key] ?? key),
		...(key === "design" ? [commandMenuDescription(ih, ID, key, "12 members")] : []),
	],
	placeholder: "Where would you like to go?",
})
// The closed menu renders nothing, and a scene needs a root element.
const withRoot = (inner: ReturnType<typeof sceneView>) => (model: Model, h: HtmlBuilder<Message>) =>
	h.main([], [inner(model, h)])

const config = { update, view: withRoot(sceneView()) }
const palette = init({
	id: ID,
	sections: [
		section("Recent", [item("general", "general"), item("design", "design", true)]),
		section("Quick Actions", [item("create", "create channel")]),
	],
})
const search = Scene.role("searchbox", { name: "Quick search" })
const menuItem = (name: string) => Scene.role("menuitem", { name })
const opened = [
	Scene.given(open(palette).model),
	Scene.Mount.resolve(PortalCommandMenu, Message.CompletedPortalCommandMenu()),
]

describe("command menu scene", () => {
	test("a closed menu renders nothing", () => {
		Scene.scene(
			config,
			Scene.given(palette),
			Scene.expect(Scene.role("dialog")).toBeAbsent(),
			Scene.Mount.expectNone(),
		)
	})

	test("an open menu is a labelled dialog with a search field controlling the list", () => {
		Scene.scene(
			config,
			Scene.given(open(palette).model),
			Scene.Mount.expectExact(PortalCommandMenu({ id: ID, isDismissable: true })),
			Scene.Mount.resolve(PortalCommandMenu, Message.CompletedPortalCommandMenu()),
			Scene.expect(Scene.role("dialog", { name: "Command Menu" })).toExist(),
			Scene.expect(search).toHaveAttr("placeholder", "Where would you like to go?"),
			Scene.expect(search).toHaveAttr("aria-controls", "palette-list"),
			Scene.expect(search).not.toHaveAttr("aria-activedescendant"),
			Scene.expect(Scene.role("menu", { name: "Suggestions" })).toExist(),
			Scene.expect(Scene.role("group", { name: "Recent" })).toExist(),
			Scene.expectAll(Scene.all.role("menuitem")).toHaveCount(3),
			Scene.expect(menuItem("design")).toHaveAccessibleDescription("12 members"),
		)
	})

	test("typing filters the list and points the search at the first match", () => {
		Scene.scene(
			config,
			...opened,
			Scene.type(search, "chan"),
			Scene.expectAll(Scene.all.role("menuitem")).toHaveCount(1),
			Scene.expect(Scene.role("group", { name: "Recent" })).toBeAbsent(),
			Scene.expect(search).toHaveAttr("aria-activedescendant", "palette-item-create"),
			Scene.expect(menuItem("Create channel")).toHaveAttr("data-focused", "true"),
		)
	})

	test("a search with no match shows the empty state", () => {
		Scene.scene(
			config,
			...opened,
			Scene.type(search, "zzz"),
			Scene.expect(Scene.text("No results found.")).toExist(),
			Scene.expect(Scene.role("menu")).toHaveAttr("data-empty", "true"),
		)
	})

	test("arrow keys move virtual focus with a keyboard focus ring", () => {
		Scene.scene(
			config,
			...opened,
			Scene.keydown(search, "ArrowDown"),
			Scene.expectHandled(),
			Scene.keydown(search, "ArrowDown"),
			Scene.expect(search).toHaveAttr("aria-activedescendant", "palette-item-design"),
			Scene.expect(menuItem("design")).toHaveAttr("data-focus-visible", "true"),
			Scene.keydown(search, "ArrowUp"),
			Scene.expect(menuItem("general")).toHaveAttr("data-focused", "true"),
		)
	})

	test("Enter selects the focused item and closes the menu", () => {
		Scene.scene(
			config,
			...opened,
			Scene.keydown(search, "ArrowDown"),
			Scene.keydown(search, "Enter"),
			Scene.expectOutMessage(OutMessage.SelectedItem({ key: "general" })),
			Scene.Mount.expectEnded(PortalCommandMenu),
			Scene.expect(Scene.role("dialog")).toBeAbsent(),
		)
	})

	test("clicking an item selects it", () => {
		Scene.scene(
			config,
			...opened,
			Scene.click(menuItem("Create channel")),
			Scene.expectOutMessage(OutMessage.SelectedItem({ key: "create" })),
			Scene.Mount.expectEnded(PortalCommandMenu),
		)
	})

	test("Escape clears the search, then a second Escape closes the menu", () => {
		Scene.scene(
			config,
			...opened,
			Scene.type(search, "gen"),
			Scene.keydown(search, "Escape"),
			Scene.expectNoOutMessage(),
			Scene.expect(search).toHaveValue(""),
			Scene.keydown(search, "Escape"),
			Scene.expectOutMessage(OutMessage.Closed()),
			Scene.Mount.expectEnded(PortalCommandMenu),
			Scene.expect(Scene.role("dialog")).toBeAbsent(),
		)
	})

	test("typing a letter is left to the search field", () => {
		Scene.scene(config, ...opened, Scene.keydown(search, "g"), Scene.expectIgnored())
	})

	test("the Esc button closes the menu", () => {
		Scene.scene(
			config,
			...opened,
			Scene.click(Scene.role("button", { name: "Clear search" })),
			Scene.expectOutMessage(OutMessage.Closed()),
			Scene.Mount.expectEnded(PortalCommandMenu),
		)
	})

	test("a press outside closes the menu", () => {
		Scene.scene(
			config,
			...opened,
			Scene.Subscription.emit(Message.PressedOutside()),
			Scene.Mount.expectEnded(PortalCommandMenu),
			Scene.expect(Scene.role("dialog")).toBeAbsent(),
		)
	})

	test("a form page replaces the search and closes on Escape from anywhere in the menu", () => {
		Scene.scene(
			{
				update,
				view: withRoot(
					sceneView({
						toFormPage: (closeAttributes) => [ih.button([...closeAttributes], ["Back"])],
					}),
				),
			},
			...opened,
			Scene.expect(search).toBeAbsent(),
			Scene.keydown(Scene.selector('[style="display: contents;"]'), "Escape"),
			Scene.expectOutMessage(OutMessage.Closed()),
			Scene.Mount.expectEnded(PortalCommandMenu),
			Scene.expect(Scene.role("dialog")).toBeAbsent(),
		)
	})
})
