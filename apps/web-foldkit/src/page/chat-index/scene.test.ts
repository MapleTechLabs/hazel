// @vitest-environment jsdom
import { ChannelId, OrganizationMemberId, UserId } from "@hazel/schema"
import { Schema } from "effect"
import * as Scene from "foldkit/scene"
import { describe, test } from "vitest"
import { shared as memberShared } from "../chat/channel/fixtures.test-support"
import type { Shared } from "../contract"
import { AppRoute } from "../../route"
import * as Tabs from "../../ui/tabs"
import { PageOutMessage } from "../out-message"
import { Message } from "./message"
import type { ChannelGroups, ChannelSummary, Model } from "./model"
import { init, update } from "./update"
import { view } from "./view"

/** The channel browser through its view: loading, tabs with counts, cards and the empty states. */

const admin: Shared = {
	...memberShared,
	member: {
		id: Schema.decodeSync(OrganizationMemberId)("00000000-0000-4000-8000-000000000099"),
		role: "admin",
	},
}

const sceneFor = (shared: Shared) => ({
	update: (model: Model, message: Message) => update(model, message),
	view: Scene.withViewInputs(view, { shared })(),
})

/** A signed-in user without an organization role (`member: null`). */
const config = sceneFor(memberShared)

const channel = (n: number, name: string, type: string): ChannelSummary => ({
	id: Schema.decodeSync(ChannelId)(`00000000-0000-4000-8000-${String(200 + n).padStart(12, "0")}`),
	name,
	type,
	icon: null,
	isMuted: false,
	isFavorite: false,
	notificationCount: 0,
	memberCount: 3,
	lastMessageAtMs: null,
	lastMessageAuthorId: null,
	lastMessagePreview: null,
	members: [],
})

const groups: ChannelGroups = {
	publicChannels: [channel(1, "general", "public"), channel(2, "random", "public")],
	privateChannels: [],
	dmChannels: [],
}

describe("chat index scene", () => {
	test("shows a loader until the channels arrive, then the public tab's channels", () => {
		Scene.scene(
			config,
			Scene.given(init(AppRoute.ChatIndex({ orgSlug: "hazel" })).model),
			Scene.expect(Scene.role("heading", { name: "All channels" })).toBeAbsent(),
			Scene.Subscription.emit(Message.UpdatedChannels({ groups })),
			Scene.expect(Scene.role("heading", { name: "All channels" })).toExist(),
			Scene.expect(Scene.text("general")).toExist(),
			Scene.expect(Scene.text("random")).toExist(),
		)
	})

	test("an empty tab offers its action to admins, which asks the root for the legacy modal", () => {
		Scene.scene(
			sceneFor(admin),
			Scene.given(init(AppRoute.ChatIndex({ orgSlug: "hazel" })).model),
			Scene.Subscription.emit(Message.UpdatedChannels({ groups })),
			Scene.click(Scene.role("tab", { name: /Private/ })),
			Scene.Command.resolve(Tabs.FocusTab, Tabs.Message.CompletedFocusTab()),
			Scene.expect(Scene.text("No private channels")).toExist(),
			Scene.click(Scene.role("button", { name: /Create a private channel$/ })),
			Scene.expectOutMessage(PageOutMessage.RequestedModal({ modal: { _tag: "NewChannel" } })),
		)
	})

	test("without channel.create permission the empty state has no action", () => {
		Scene.scene(
			config,
			Scene.given(init(AppRoute.ChatIndex({ orgSlug: "hazel" })).model),
			Scene.Subscription.emit(Message.UpdatedChannels({ groups })),
			Scene.click(Scene.role("tab", { name: /Private/ })),
			Scene.Command.resolve(Tabs.FocusTab, Tabs.Message.CompletedFocusTab()),
			Scene.expect(Scene.text("No private channels")).toExist(),
			Scene.expect(Scene.role("button", { name: /Create a private channel$/ })).toBeAbsent(),
		)
	})

	test("ChatDms shows only the direct messages, with New message and no channel tabs", () => {
		const dm: ChannelSummary = {
			...channel(3, "dm", "single"),
			memberCount: 2,
			members: [
				{
					userId: memberShared.currentUser!.id,
					firstName: "Me",
					lastName: "Self",
					avatarUrl: null,
				},
				{
					userId: Schema.decodeSync(UserId)("00000000-0000-4000-8000-000000000301"),
					firstName: "Grace",
					lastName: "Hopper",
					avatarUrl: null,
				},
			],
		}
		Scene.scene(
			config,
			Scene.given(init(AppRoute.ChatDms({ orgSlug: "hazel" })).model),
			Scene.Subscription.emit(Message.UpdatedChannels({ groups: { ...groups, dmChannels: [dm] } })),
			Scene.expect(Scene.role("heading", { name: "Direct messages" })).toExist(),
			Scene.expect(Scene.text("Grace Hopper")).toExist(),
			Scene.expect(Scene.text("general")).toBeAbsent(),
			Scene.expect(Scene.role("tab", { name: /Public/ })).toBeAbsent(),
			Scene.click(Scene.role("button", { name: /New message$/ })),
			Scene.expectOutMessage(PageOutMessage.RequestedModal({ modal: { _tag: "CreateDm" } })),
		)
	})

	test("on a phone, ChatDms is Slack's DMs tab: people strip, filter chips, compose button", () => {
		const dm: ChannelSummary = {
			...channel(3, "dm", "single"),
			memberCount: 2,
			members: [
				{
					userId: memberShared.currentUser!.id,
					firstName: "Me",
					lastName: "Self",
					avatarUrl: null,
				},
				{
					userId: Schema.decodeSync(UserId)("00000000-0000-4000-8000-000000000301"),
					firstName: "Grace",
					lastName: "Hopper",
					avatarUrl: null,
				},
			],
		}
		Scene.scene(
			sceneFor({ ...memberShared, isMobile: true }),
			Scene.given(init(AppRoute.ChatDms({ orgSlug: "hazel" })).model),
			Scene.Subscription.emit(Message.UpdatedChannels({ groups: { ...groups, dmChannels: [dm] } })),
			Scene.expect(Scene.role("banner")).toExist(),
			Scene.expect(Scene.role("heading", { name: "DMs", level: 1 })).toExist(),
			Scene.expect(Scene.role("navigation", { name: "People" })).toExist(),
			// The round compose button, not the desktop header's labelled pill.
			Scene.expect(Scene.text("New message")).toBeAbsent(),
			Scene.expect(Scene.text("Grace Hopper")).toExist(),
			Scene.expect(Scene.text("general")).toBeAbsent(),
			Scene.expect(Scene.role("tab", { name: /Public/ })).toBeAbsent(),
			Scene.click(Scene.role("button", { name: "New message" })),
			Scene.expectOutMessage(PageOutMessage.RequestedModal({ modal: { _tag: "CreateDm" } })),
		)
	})

	test("on a phone, unread DMs come first under their own heading, and Unreads keeps only them", () => {
		const person = (n: number, firstName: string) => ({
			userId: Schema.decodeSync(UserId)(`00000000-0000-4000-8000-${String(300 + n).padStart(12, "0")}`),
			firstName,
			lastName: "Last",
			avatarUrl: null,
		})
		const me = {
			userId: memberShared.currentUser!.id,
			firstName: "Me",
			lastName: "Self",
			avatarUrl: null,
		}
		const read: ChannelSummary = {
			...channel(4, "dm-read", "single"),
			members: [me, person(1, "Ada")],
			lastMessageAtMs: memberShared.nowMs - 5 * 60_000,
			lastMessageAuthorId: me.userId,
			lastMessagePreview: "see you tomorrow",
		}
		const unread: ChannelSummary = {
			...channel(5, "dm-unread", "single"),
			notificationCount: 2,
			members: [me, person(2, "Linus")],
		}
		Scene.scene(
			sceneFor({ ...memberShared, isMobile: true }),
			Scene.given(init(AppRoute.ChatDms({ orgSlug: "hazel" })).model),
			Scene.Subscription.emit(
				Message.UpdatedChannels({ groups: { ...groups, dmChannels: [read, unread] } }),
			),
			Scene.expect(Scene.role("heading", { name: "Unreads" })).toExist(),
			Scene.expect(Scene.role("heading", { name: "Everything else" })).toExist(),
			Scene.expect(Scene.text("Ada Last")).toExist(),
			// Its last message, the user's own, and how long ago.
			Scene.expect(Scene.text("You: see you tomorrow")).toExist(),
			Scene.expect(Scene.text("5m")).toExist(),
			Scene.click(Scene.role("button", { name: /^Unreads/ })),
			Scene.expect(Scene.text("Linus Last")).toExist(),
			Scene.expect(Scene.text("Ada Last")).toBeAbsent(),
		)
	})
})
