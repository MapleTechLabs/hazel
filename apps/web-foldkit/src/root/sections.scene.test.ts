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
	ShellChannelSidebar,
	ShellChatSidebarSheet,
	ShellCustomersSidebar,
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
	test("the native header over the page, beside the channel list", () => {
		const s = frame(
			shellSignedIn("/hazel/channels/00000005-0000-4000-8000-000000000001/settings/integrations"),
		)
			.expect(inLayout("channelSettings", pageSlot))
			.toExist()
		const [header] = childOf(s, ShellChannelSettingsHeader)
		expect(header?.props.selected).toBe("integrations")
		expect(childOf(s, ShellSectionSidebar)).toHaveLength(0)
		expect(childOf(s, ShellChannelSidebar)).toHaveLength(1)
		expect(childOf(s, ShellOrgSwitcher)).toHaveLength(1)
	})
})

describe("the channel list in the dock", () => {
	const channel = "00000005-0000-4000-8000-000000000001"
	const waiting = Locator.attr("data-paint", "loading")

	test("chat: the list between the org switcher and the account card, its channel active", () => {
		const s = frame(shellSignedIn(`/hazel/chat/${channel}`))
		const [list] = childOf(s, ShellChannelSidebar)
		expect(list?.props.activeChannelId).toBe(channel)
		expect(list?.props.chrome).toBe(false)
		expect(childOf(s, ShellOrgSwitcher)).toHaveLength(1)
		expect(childOf(s, ShellAccountMenu)).toHaveLength(1)
		// No holes and no host dock region any more.
		s.expect(Locator.attr("data-hazel-hole"))
			.toBeAbsent()
			.expect(Locator.attr("data-foldkit-slot", "sidebar"))
			.toBeAbsent()
	})

	test("home: the Members row is current", () => {
		const [list] = childOf(frame(shellSignedIn("/hazel")), ShellChannelSidebar)
		expect(list?.props.membersActive).toBe(true)
	})

	test("the last screen's paint stays up until its list loads, then goes", () => {
		const model = shellSignedIn("/hazel/chat")
		frame(model).expect(waiting).toExist()
		const [list] = childOf(frame(model), ShellChannelSidebar)
		const key = `${String(list?.props.organizationId)}:${String(list?.props.userId)}`
		const loaded = update(model, AppMessage.LoadedChannelList({ key })).model
		frame(loaded).expect(waiting).toBeAbsent()
		// Another org's list waits again.
		frame({ ...loaded, channelListLoaded: "other:user" })
			.expect(waiting)
			.toExist()
	})
})

describe("customers layout", () => {
	test("the native sidebar in the dock, the page in a full-height column", () => {
		const s = frame(shellSignedIn("/hazel/customers/list?view=paying"))
			.expect(inLayout("customers", pageSlot))
			.toExist()
		const [sidebar] = childOf(s, ShellCustomersSidebar)
		expect(sidebar?.props.currentView).toBe("paying")
		expect(sidebar?.props.listHref).toBe("/hazel/customers/list")
		expect(sidebar?.props.sheet).toBeNull()
		expect(childOf(s, ShellAccountMenu)).toHaveLength(1)
		expect(childOf(s, ShellChannelSidebar)).toHaveLength(0)
	})

	test("its pages are current by route, the settings rows too", () => {
		const [sidebar] = childOf(
			frame(shellSignedIn("/hazel/customers/settings/sla")),
			ShellCustomersSidebar,
		)
		const rows = [
			...(sidebar?.props.pages as ReadonlyArray<{ id: string; selected: boolean }>),
			...(sidebar?.props.settings as ReadonlyArray<{ id: string; selected: boolean }>),
		]
		expect(rows.filter((row) => row.selected).map((row) => row.id)).toEqual(["customersSla"])
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

	test("every sidebar's top bar opens the shell's sheet: chat, customers", () => {
		for (const path of ["/hazel/chat/00000005-0000-4000-8000-000000000001", "/hazel/customers"]) {
			const result = update(phone(path), AppMessage.PressedMobileMenu())
			expect(result.model.isSectionSheetOpen).toBe(true)
			expect(hostRequestsOf(result.commands)).toEqual([])
		}
	})

	test("a chat route draws the channel list's sheet; customers its own", () => {
		const chat = update(
			phone("/hazel/chat/00000005-0000-4000-8000-000000000001"),
			AppMessage.PressedMobileMenu(),
		)
		const [sheet] = childOf(frame(chat.model), ShellChatSidebarSheet)
		expect(sheet?.props.open).toBe(true)
		const [customers] = childOf(frame(phone("/hazel/customers")), ShellCustomersSidebar)
		expect(customers?.props.sheet).toEqual({ open: false })
	})

	test("the Home tab's page is the channel list itself, with no sheet", () => {
		const s = frame(phone("/hazel/chat"))
		expect(childOf(s, ShellChannelSidebar)).toHaveLength(1)
		expect(childOf(s, ShellChatSidebarSheet)).toHaveLength(0)
	})

	test("Mod+Shift+D toggles a phone's sheet; a wide screen's dock is still the host's", () => {
		const opened = update(phone("/hazel/chat"), AppMessage.PressedHotkey({ actionId: "sidebar.toggle" }))
		expect(opened.model.isSectionSheetOpen).toBe(true)
		expect(hostRequestsOf(opened.commands)).toEqual([])
		const wide = update(
			shellSignedIn("/hazel/chat"),
			AppMessage.PressedHotkey({ actionId: "sidebar.toggle" }),
		)
		expect(hostRequestsOf(wide.commands)).toEqual([{ _tag: "PressedHotkey", actionId: "sidebar.toggle" }])
	})
})
