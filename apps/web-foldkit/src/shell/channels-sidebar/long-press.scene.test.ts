// @vitest-environment jsdom
import { ChannelId, ChannelMemberId, ChannelSectionId, OrganizationId } from "@hazel/schema"
import { Schema } from "effect"
import type { HtmlBuilder } from "foldkit/html"
import * as Scene from "foldkit/scene"
import { inertHtml } from "foldkit/html"
import { IconClose, IconGear, IconLeave, IconStar, IconVolumeMute } from "../../icons"
import { iconOf } from "../../platform/native-island"
import { describe, test } from "vitest"
import { AppRoute } from "../../route"
import * as Menu from "../../ui/menu"
import { FocusTriggerOnPress } from "../../ui/menu-view"
import type { ChannelEntry } from "./rows"
import type { Message, Model } from "./model"
import { sectionGroupContent } from "./view"

/** A sidebar row's "⋯" menu is also its long-press menu on iOS: the same entries, as words. */

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const general = Schema.decodeSync(ChannelId)(uuid(1))
const dmGrace = Schema.decodeSync(ChannelId)(uuid(2))
const member = (n: number) => ({
	id: Schema.decodeSync(ChannelMemberId)(uuid(200 + n)),
	isMuted: false,
	isFavorite: false,
	notificationCount: 0,
})
const generalEntry: ChannelEntry = {
	channel: { id: general, name: "general", type: "public", icon: null, sectionId: null },
	member: member(1),
}

const sidebar: Model = {
	organizationId: Schema.decodeSync(OrganizationId)(uuid(9)),
	currentUserId: null,
	membership: null,
	sections: [],
	sectionChannels: { default: [generalEntry] },
	favorites: [],
	channelCustomers: [],
	threads: [],
	dmChannelIds: [dmGrace],
	dmChannels: { [dmGrace]: { id: dmGrace, type: "single", members: [], currentUser: member(2) } },
	presence: [],
	unreadCounts: [],
	connectMounts: [],
	organizations: [],
	syncedChannels: [],
	memberChannelIds: [general, dmGrace],
	discoverableChannels: [],
	loaded: { sections: true, favorites: true, channelCustomers: true, dmChannelIds: true },
	isCreateChannelHintDismissed: true,
	openMenu: null,
}

const view = (model: Model, h: HtmlBuilder<Message>) =>
	h.div(
		[],
		sectionGroupContent(h, model, {
			orgSlug: "hazel",
			route: AppRoute.ChatIndex({ orgSlug: "hazel" }),
			activeChannelId: null,
			nowMs: 0,
			paletteKey: null,
			createChannelKey: null,
			onActiveMount: h.Attribute("data-active", ""),
			onBrowseChannels: h.Attribute("data-browse", ""),
			onDismissCreateChannelHint: h.Attribute("data-dismiss", ""),
			toParentMessage: (message) => message,
			sectionAction: () => h.empty,
		}),
	)

const update = (model: Model) => ({ model, commands: [] })
const triggerMounted = Scene.Mount.resolve(FocusTriggerOnPress, Menu.Message.CompletedFocusTriggerOnPress())

// What the host's `context_menu.rs` reads: the row's own entries as words, symbols, the icons the
// web's items draw, and danger.
const icon = (render: typeof IconGear) => iconOf([render(inertHtml)])
const toggles = [
	{ key: "mute", label: "Mute", symbol: "bell.slash", icon: icon(IconVolumeMute) },
	{ key: "favorite", label: "Favorite", symbol: "star", icon: icon(IconStar) },
	{ separator: true },
]
const channelMenu = JSON.stringify({
	items: [
		...toggles,
		{ key: "settings", label: "Settings", symbol: "gearshape", icon: icon(IconGear) },
		{ separator: true },
		{
			key: "leave",
			label: "Leave",
			symbol: "rectangle.portrait.and.arrow.right",
			icon: icon(IconLeave),
			destructive: true,
		},
	],
})
const dmMenu = JSON.stringify({
	items: [
		...toggles,
		{
			key: "hide",
			label: "Hide conversation",
			symbol: "eye.slash",
			icon: icon(IconClose),
			destructive: true,
		},
	],
})
// The long press's island, not the dots trigger's `menu` island, which carries the same items.
const rowsWith = (props: string) =>
	Scene.all.selector(`[data-native="context-menu"][data-native-props='${props}']`)
const dotsWith = (props: string) => Scene.all.selector(`[data-native="menu"][data-native-props='${props}']`)

describe("sidebar long-press menus", () => {
	test("a channel row and a DM row each carry their own menu as the system's long-press menu", () => {
		Scene.scene(
			{ update, view },
			Scene.given(sidebar),
			// Each row's dots trigger focuses itself on press.
			triggerMounted,
			triggerMounted,
			Scene.expectAll(Scene.all.selector('[data-native="context-menu"]')).toHaveCount(2),
			Scene.expectAll(rowsWith(channelMenu)).toHaveCount(1),
			Scene.expectAll(rowsWith(dmMenu)).toHaveCount(1),
			// One menu, two triggers: the dots carry exactly the same items.
			Scene.expectAll(dotsWith(channelMenu)).toHaveCount(1),
			Scene.expectAll(dotsWith(dmMenu)).toHaveCount(1),
		)
	})

	test("a customer channel is listed under Customers with its logo and lock, and cannot be moved", () => {
		const acme = Schema.decodeSync(ChannelId)(uuid(3))
		const logo = "https://img.clerk.com/acme.png"
		const acmeEntry: ChannelEntry = {
			channel: { id: acme, name: "acme", type: "private", icon: null, sectionId: null },
			member: member(3),
		}
		const withCustomer: Model = {
			...sidebar,
			// A custom section, so a row's menu has "Move to section" to leave out.
			sections: [{ id: Schema.decodeSync(ChannelSectionId)(uuid(10)), name: "Design" }],
			sectionChannels: { default: [generalEntry, acmeEntry] },
			channelCustomers: [{ channelId: acme, accountName: "Acme", accountLogoUrl: logo }],
		}
		const customerRow = `#sidebar-tree-customers [data-key="${acme}"]`
		Scene.scene(
			{ update, view },
			Scene.given(withCustomer),
			triggerMounted,
			triggerMounted,
			triggerMounted,
			Scene.expectAll(Scene.all.selector("#sidebar-tree-customers [data-key]")).toHaveCount(1),
			Scene.expect(Scene.selector(customerRow)).toExist(),
			// Out of the Channels section.
			Scene.expectAll(Scene.all.selector(`#sidebar-tree-default [data-key="${acme}"]`)).toHaveCount(0),
			Scene.expect(Scene.selector(`${customerRow} img[src="${logo}"]`)).toExist(),
			Scene.expect(Scene.selector(`${customerRow} [title="Private channel"]`)).toExist(),
			// #general's menu offers "Move to section"; #acme's is the plain channel menu (the customer
			// link places it), and it is the only one.
			Scene.expectAll(Scene.all.selector('[data-native="context-menu"]')).toHaveCount(3),
			Scene.expectAll(rowsWith(channelMenu)).toHaveCount(1),
			Scene.expect(Scene.selector(`${customerRow} [data-native="context-menu"]`)).toHaveAttr(
				"data-native-props",
				channelMenu,
			),
		)
	})
})
