// @vitest-environment jsdom
import { ChannelId, ChannelMemberId, ChannelSectionId, OrganizationId } from "@hazel/schema"
import { Schema } from "effect"
import type { HtmlBuilder } from "foldkit/html"
import * as Scene from "foldkit/scene"
import { inertHtml } from "foldkit/html"
import { IconBell, IconCheck, IconClose, IconGear, IconLeave, IconStar } from "../../icons"
import { muteDurations, muteKeyOf } from "~/lib/notification-settings"
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
	mutedUntilMs: null,
	notificationLevel: null,
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
	unreadChannels: [],
	sectionSettings: [],
	organizationSetting: null,
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
// "Mute" opens how long for; the system's menu takes it as a submenu.
const mute = {
	label: "Mute",
	items: muteDurations.map((duration) => ({ key: muteKeyOf(duration.minutes), label: duration.label })),
}
const favorite = { key: "favorite", label: "Favorite", symbol: "star", icon: icon(IconStar) }
const notifications = {
	label: "Notifications",
	items: [
		// The level in force (the default here) carries the check.
		{ key: "level:default", label: "Default (Only @mentions)", icon: icon(IconCheck) },
		{ key: "level:all", label: "All messages" },
		{ key: "level:mentions", label: "Only @mentions" },
		{ key: "level:nothing", label: "Nothing" },
	],
}
const channelMenu = JSON.stringify({
	items: [
		mute,
		notifications,
		favorite,
		{ separator: true },
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
		mute,
		favorite,
		{ separator: true },
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

	test("a channel muted only through its section dims and hides its threads' unread, its menu still offers Mute", () => {
		const design = Schema.decodeSync(ChannelSectionId)(uuid(10))
		const thread = Schema.decodeSync(ChannelId)(uuid(4))
		const designEntry: ChannelEntry = {
			channel: { ...generalEntry.channel, sectionId: design },
			member: member(1),
		}
		const inMutedSection: Model = {
			...sidebar,
			sections: [{ id: design, name: "Design" }],
			sectionChannels: { [design]: [designEntry] },
			threads: [
				{
					id: thread,
					name: "a thread",
					parentChannelId: general,
					createdAtMs: 0,
					notificationCount: 0,
				},
			],
			unreadChannels: [
				{ channelId: general, mutedUntilMs: null },
				{ channelId: thread, mutedUntilMs: null },
			],
			sectionSettings: [
				{ sectionId: design, isMuted: true, mutedUntilMs: null, notificationLevel: null },
			],
		}
		const row = `[data-key="${general}"]`
		const [own, ...rest] = JSON.parse(channelMenu).items
		const [levels, favoriteItem, ...after] = rest
		const moveTo = {
			label: "Move to section",
			items: [
				{ key: "section:default", label: "Channels (Default)" },
				{ key: `section:${design}`, label: "Design" },
			],
		}
		const withMoveToSection = JSON.stringify({ items: [own, levels, favoriteItem, moveTo, ...after] })
		Scene.scene(
			{ update, view },
			Scene.given(inMutedSection),
			triggerMounted,
			triggerMounted,
			// The channel's own mute is off, so "Unmute" would write a mute it does not have.
			Scene.expect(Scene.selector(`${row} [data-native="context-menu"]`)).toHaveAttr(
				"data-native-props",
				withMoveToSection,
			),
			Scene.expectAll(Scene.all.selector(`${row} .opacity-60`)).toHaveCount(1),
			Scene.expect(Scene.selector('[aria-label="Threads"] a')).toExist(),
			Scene.expectAll(Scene.all.selector('[aria-label="Threads"] a.font-medium')).toHaveCount(0),
		)
	})
	test("a muted organization dims its channel rows but keeps their mentions badge; DMs stay as they are", () => {
		const mentioned: ChannelEntry = { ...generalEntry, member: { ...member(1), notificationCount: 2 } }
		const orgMuted: Model = {
			...sidebar,
			sectionChannels: { default: [mentioned] },
			unreadChannels: [{ channelId: general, mutedUntilMs: null }],
			organizationSetting: { isMuted: true, mutedUntilMs: null, notificationLevel: null },
		}
		Scene.scene(
			{ update, view },
			Scene.given(orgMuted),
			triggerMounted,
			triggerMounted,
			Scene.expectAll(Scene.all.selector(`[data-key="${general}"] .opacity-60`)).toHaveCount(0),
			Scene.expect(Scene.selector(`[data-key="${general}"] [data-slot="sidebar-badge"]`)).toExist(),
			Scene.expectAll(Scene.all.selector(`[data-key="${dmGrace}"] .opacity-60`)).toHaveCount(0),
		)
		const quiet: Model = { ...orgMuted, sectionChannels: { default: [generalEntry] } }
		Scene.scene(
			{ update, view },
			Scene.given(quiet),
			triggerMounted,
			triggerMounted,
			Scene.expectAll(Scene.all.selector(`[data-key="${general}"] .opacity-60`)).toHaveCount(1),
			Scene.expectAll(Scene.all.selector(`[data-key="${dmGrace}"] .opacity-60`)).toHaveCount(0),
		)
	})

	test("a row's Default names its section's level, else the organization's", () => {
		const design = Schema.decodeSync(ChannelSectionId)(uuid(10))
		const designEntry: ChannelEntry = {
			channel: { ...generalEntry.channel, sectionId: design },
			member: member(1),
		}
		// The channel menu with its "Default" naming `label`.
		const withDefault = (label: string, menu = channelMenu) =>
			rowsWith(menu.replace('"Default (Only @mentions)"', JSON.stringify(label)))
		const [own, levels, ...rest] = JSON.parse(channelMenu).items
		const [favoriteItem, ...after] = rest
		const moveTo = {
			label: "Move to section",
			items: [
				{ key: "section:default", label: "Channels (Default)" },
				{ key: `section:${design}`, label: "Design" },
			],
		}
		const withMoveToSection = JSON.stringify({ items: [own, levels, favoriteItem, moveTo, ...after] })
		const orgOnAll: Model = {
			...sidebar,
			organizationSetting: { isMuted: false, mutedUntilMs: null, notificationLevel: "all" },
		}
		Scene.scene(
			{ update, view },
			Scene.given(orgOnAll),
			triggerMounted,
			triggerMounted,
			Scene.expectAll(withDefault("Default (All messages)")).toHaveCount(1),
		)
		Scene.scene(
			{ update, view },
			Scene.given({
				...orgOnAll,
				sections: [{ id: design, name: "Design" }],
				sectionChannels: { default: [], [design]: [designEntry] },
				sectionSettings: [
					{ sectionId: design, isMuted: false, mutedUntilMs: null, notificationLevel: "nothing" },
				],
			}),
			triggerMounted,
			triggerMounted,
			Scene.expectAll(withDefault("Default (Nothing)", withMoveToSection)).toHaveCount(1),
		)
	})
})
