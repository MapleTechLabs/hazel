// @vitest-environment jsdom
import { ChannelId, ChannelMemberId, OrganizationId } from "@hazel/schema"
import { Schema } from "effect"
import type { HtmlBuilder } from "foldkit/html"
import * as Scene from "foldkit/scene"
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
	loaded: { sections: true, favorites: true, dmChannelIds: true },
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

// What the host's `context_menu.rs` reads: the row's own entries as words, symbols and danger.
const toggles = [
	{ key: "mute", label: "Mute", symbol: "bell.slash" },
	{ key: "favorite", label: "Favorite", symbol: "star" },
	{ separator: true },
]
const channelMenu = JSON.stringify({
	items: [
		...toggles,
		{ key: "settings", label: "Settings", symbol: "gearshape" },
		{ separator: true },
		{ key: "leave", label: "Leave", symbol: "rectangle.portrait.and.arrow.right", destructive: true },
	],
})
const dmMenu = JSON.stringify({
	items: [...toggles, { key: "hide", label: "Hide conversation", symbol: "eye.slash", destructive: true }],
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
})
