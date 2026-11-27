// @vitest-environment jsdom
// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { Html } from "@effect/ui/html"
import { Hazel } from "@hazel/ui/vocabulary/index"
import { HtmlScene } from "@effect/ui/html/testing"
import { Locator } from "@effect/ui/testing"
import { Schema } from "effect"
import { describe, expect, test } from "vitest"
import { flagsOf, hostRequestsOf, owner, shellSignedIn } from "../test/root-fixtures"
import { App, type Boot } from "./app"
import {
	ShellAccountMenu,
	ShellChannelSettingsHeader,
	ShellOrgSwitcher,
	ShellSectionSidebar,
} from "./children"
import { type AppModel, update } from "./logic"
import { AppMessage } from "./message"
import { sectionContent } from "./sections"

/** The section layouts the shell draws: its sidebars, the content column, and the page inside it. */

const boot: Boot = {
	...flagsOf(),
	isCreateChannelHintDismissed: false,
	aiPanel: { isOpen: false, width: null },
}
const frame = (model: AppModel) => HtmlScene.start(App, { route: model.route, boot }).given(model)

interface ChildNode {
	readonly _tag: "Child"
	readonly component: unknown
	readonly props: Record<string, unknown>
}

/** The component children a view declares (a scene keeps them as leaves). */
const childrenOf = (node: unknown): ReadonlyArray<ChildNode> => {
	if (typeof node !== "object" || node === null) return []
	const { _tag, children } = node as { readonly _tag?: string; readonly children?: ReadonlyArray<unknown> }
	if (_tag === "Child") return [node as ChildNode]
	return (children ?? []).flatMap(childrenOf)
}
const childOf = (s: { readonly current: { readonly root: unknown } }, component: unknown) =>
	childrenOf(s.current.root).filter((child) => child.component === component)

const layout = (name: string) => Locator.attr("data-section-layout", name)
const pageSlot = Locator.attr("data-foldkit-slot", "page")
const inLayout = (name: string, locator: Locator.Locator) => Locator.inside(layout(name), locator)

describe("settings layout", () => {
	test("the native sidebar in the dock, and the Foldkit page region inside the content column", () => {
		const s = frame(shellSignedIn("/hazel/settings/groups"))
			.expect(inLayout("settings", pageSlot))
			.toExist()
		const [sidebar] = childOf(s, ShellSectionSidebar)
		expect(sidebar?.props.kind).toBe("settings")
		const groups = sidebar?.props.groups as ReadonlyArray<{
			readonly rows: ReadonlyArray<{ readonly id: string; readonly selected: boolean }>
		}>
		const selected = groups.flatMap((group) =>
			group.rows.filter((row) => row.selected).map((row) => row.id),
		)
		expect(selected).toEqual(["settingsGroups"])
		// Docked, the frame draws the switcher and the account card around the rows.
		expect(childOf(s, ShellOrgSwitcher)).toHaveLength(1)
		expect(childOf(s, ShellAccountMenu)).toHaveLength(1)
		// The host's dock region stays out.
		s.expect(Locator.attr("data-foldkit-slot", "sidebar")).toBeAbsent()
	})

	test("my settings share it, and an integrations page gets the content column", () => {
		frame(shellSignedIn("/hazel/my-settings/keybinds")).expect(inLayout("settings", pageSlot)).toExist()
		frame(shellSignedIn("/hazel/settings/integrations")).expect(inLayout("settings", pageSlot)).toExist()
	})
})

describe("activity layout", () => {
	test("its sidebar carries the unread count for Mark all as read", () => {
		const s = frame(shellSignedIn("/hazel/notifications/unreads"))
			.expect(inLayout("activity", pageSlot))
			.toExist()
		const [sidebar] = childOf(s, ShellSectionSidebar)
		expect(sidebar?.props.kind).toBe("activity")
		expect(sidebar?.props.unreadCount).toBe(0)
	})
})

describe("channel settings layout", () => {
	test("the native header over the page; the chat sidebar stays the host's, with the native chrome in its holes", () => {
		const s = frame(
			shellSignedIn("/hazel/channels/00000005-0000-4000-8000-000000000001/settings/integrations"),
		)
			.expect(inLayout("channelSettings", pageSlot))
			.toExist()
			.expect(Locator.attr("data-foldkit-slot", "sidebar"))
			.toExist()
		const [header] = childOf(s, ShellChannelSettingsHeader)
		expect(header?.props.selected).toBe("integrations")
		expect(childOf(s, ShellSectionSidebar)).toHaveLength(0)
		expect(childOf(s, ShellOrgSwitcher)).toHaveLength(1)
	})
})

// A section page lane registers a native page; `sectionContent` draws the same column around it. The
// stand-in is a page with no services, as a registered page's own scene supplies its layers.
const NativePage = Hazel.component({
	name: "NativePage",
	props: Schema.Struct({}),
	model: Schema.Struct({}),
	message: Schema.Never,
}).make({ init: () => ({}), update: {}, view: (h) => h.text.children("A native page") })

const NativeInLayout = Html.component({
	name: "NativeInLayout",
	props: Schema.Struct({ path: Schema.String }),
	model: Schema.Struct({}),
	message: AppMessage,
}).make({
	init: () => ({}),
	update: ($) => $.model,
	view: (h) =>
		h.div.children(
			sectionContent(
				h,
				shellSignedIn(h.props.path),
				"settings",
				NativePage(h, { key: "native", props: {} }),
			),
		),
})

describe("a native page in a section layout", () => {
	test("sits in the content column where the Foldkit region would", () => {
		const s = HtmlScene.start(NativeInLayout, { path: "/hazel/settings" })
			.expect(layout("settings"))
			.toExist()
			.expect(pageSlot)
			.toBeAbsent()
		expect(childOf(s, NativePage)).toHaveLength(1)
	})
})

describe("the phone's section sheet", () => {
	const phone = (path: string) => shellSignedIn(path, owner, { isMobile: true })

	test("settings' top bar opens the shell's sheet, and a route change closes it", () => {
		const opened = update(phone("/hazel/settings"), AppMessage.PressedMobileMenu())
		expect(opened.model.isSectionSheetOpen).toBe(true)
		expect(hostRequestsOf(opened.commands)).toEqual([])
		const dismissed = update(opened.model, AppMessage.DismissedSectionSheet())
		expect(dismissed.model.isSectionSheetOpen).toBe(false)
	})

	test("customers' top bar still asks the host", () => {
		const result = update(phone("/hazel/customers"), AppMessage.PressedMobileMenu())
		expect(result.model.isSectionSheetOpen).toBe(false)
		expect(hostRequestsOf(result.commands)).toEqual([{ _tag: "PressedMobileMenu" }])
	})
})
