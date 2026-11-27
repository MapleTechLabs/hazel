// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { Component } from "@effect/ui"
import { Locator, Scene } from "@effect/ui/testing"
import { ChannelId, ChannelMemberId, OrganizationId, UserId } from "@hazel/schema"
import { Option } from "effect"
import { describe, expect, test } from "vitest"
import { Navigate, ShowToast } from "../../app/requests"
import {
	ChannelHeader,
	ChannelHeaderMessage,
	type ChannelHeaderModel,
	FollowThread,
	UnhideConversation,
	WriteNotificationChoice,
} from "./ChannelHeader"
import { bellLabelOf, dmTitleOf, type HeaderChannel, type HeaderMember, inheritedLevelOf } from "./model"
import { bellEntries, choiceOfKey } from "./notifications"

/** The channel header: title, DM people, the bell's writes, unhide, follow, back. */

const NOW = Date.parse("2026-11-26T12:00:00.000Z")
const channelId = ChannelId.make("00000005-0000-4000-8000-000000000001")
const parentId = ChannelId.make("00000005-0000-4000-8000-000000000002")
const ada = UserId.make("00000001-0000-4000-8000-000000000001")
const grace = UserId.make("00000001-0000-4000-8000-000000000002")
const adaMember = ChannelMemberId.make("00000007-0000-4000-8000-000000000001")

const channel = (overrides: Partial<HeaderChannel> = {}): HeaderChannel => ({
	id: channelId,
	name: "general",
	icon: null,
	type: "public",
	parentChannelId: null,
	...overrides,
})

const member = (userId: UserId, overrides: Partial<HeaderMember> = {}): HeaderMember => ({
	id: userId === ada ? adaMember : ChannelMemberId.make("00000007-0000-4000-8000-000000000002"),
	userId,
	isHidden: false,
	isMuted: false,
	mutedUntilMs: null,
	notificationLevel: null,
	displayName: userId === ada ? "Ada Lovelace" : "Grace Hopper",
	avatarUrl: null,
	isBot: false,
	...overrides,
})

const model = (overrides: Partial<ChannelHeaderModel> = {}): ChannelHeaderModel => ({
	channel: channel(),
	parent: null,
	members: [member(ada), member(grace)],
	inheritedLevel: "mentions",
	presence: "offline",
	customer: null,
	ownerName: null,
	sync: "none",
	...overrides,
})

const start = (given: ChannelHeaderModel, isMobile = false) =>
	Scene.start(ChannelHeader, {
		channelId,
		organizationId: OrganizationId.make("00000002-0000-4000-8000-000000000001"),
		userId: ada,
		orgSlug: "hazel",
		isMobile,
		nowMs: NOW,
	}).given(given)

const byProp = (tag: string, name: string, value: unknown): Locator.Locator => ({
	description: `<hz:${tag} ${name}=${JSON.stringify(value)}>`,
	all: (root) => Locator.all(root, Locator.tag(`hz:${tag}`)).filter((node) => node.props?.[name] === value),
})
const screen = Locator.tag("hz:screen")
const button = (label: string) => byProp("button", "label", label)
const bell = byProp("menu", "label", "Notification settings")

describe("channel header", () => {
	test("a channel's title, its bell and pins; a phone gets a back button to the chat list", () => {
		const s = start(model(), true)
		expect(s.get(screen).props).toMatchObject({ title: "general", back: true })
		s.expect(bell).toExist()
		s.fire(screen, "back")
			.expectExact(Navigate.make({ href: "/hazel/chat", replace: false }))
			.resolve(Navigate, Component.noop)
	})

	test("a thread names its parent as a crumb on desktop, and the crumb leads there", () => {
		const s = start(
			model({
				channel: channel({ name: "Benchmarks", type: "thread", parentChannelId: parentId }),
				parent: channel({ id: parentId, name: "engineering" }),
			}),
		)
		expect(s.get(screen).props).toMatchObject({
			title: "Benchmarks",
			crumbs: [{ label: "engineering", href: `/hazel/chat/${parentId}` }],
		})
		s.fire(screen, "crumb", { index: 0 })
			.expectExact(Navigate.make({ href: `/hazel/chat/${parentId}`, replace: false }))
			.resolve(Navigate, Component.noop)
	})

	test("a DM is titled by its people and offers Unhide while hidden", () => {
		const s = start(
			model({
				channel: channel({ type: "single" }),
				members: [member(ada, { isHidden: true }), member(grace)],
			}),
		)
		expect(s.get(screen).props?.["title"]).toBe("Grace Hopper")
		s.fire(button("Unhide conversation"), "press")
			.expectExact(UnhideConversation.make({ memberId: adaMember }))
			.resolve(UnhideConversation, ChannelHeaderMessage.SucceededUnhide())
			.expectExact(
				ShowToast.make({
					toast: { intent: "success", title: "Conversation unhidden", description: null },
				}),
			)
			.resolve(ShowToast, Component.noop)
	})

	test("the bell's choice is written, then toasted; a failure says why", () => {
		start(model())
			.fire(bell, "select", { id: "mute:60" })
			.expectExact(
				WriteNotificationChoice.make({ memberId: adaMember, choice: { _tag: "Mute", minutes: 60 } }),
			)
			.resolve(
				WriteNotificationChoice,
				ChannelHeaderMessage.FailedNotificationChoice({ reason: "MemberNotFound" }),
			)
			.expectExact(
				ShowToast.make({
					toast: {
						intent: "error",
						title: "Couldn't update notifications",
						description: "You are no longer in this channel.",
					},
				}),
			)
			.resolve(ShowToast, Component.noop)
	})

	test("a thread the user does not follow offers Follow, and no bell", () => {
		const s = start(
			model({
				channel: channel({ name: "Benchmarks", type: "thread", parentChannelId: parentId }),
				members: [member(grace)],
			}),
		)
		s.expect(Locator.tag("hz:menu")).toBeAbsent()
		s.fire(button("Follow thread"), "press")
			.expectExact(FollowThread.make({ channelId }))
			.resolve(FollowThread, ChannelHeaderMessage.SucceededFollowThread())
			.expectExact(
				ShowToast.make({
					toast: { intent: "success", title: "Following thread", description: null },
				}),
			)
			.resolve(ShowToast, Component.noop)
	})
})

describe("header rules", () => {
	test("a DM's title names three people, then how many more", () => {
		const people = ["A", "B", "C", "D", "E"].map((name) => member(grace, { displayName: name }))
		expect(dmTitleOf(people)).toBe("A, B, C +2 more")
		expect(dmTitleOf([])).toBe("Direct message")
	})

	test("the bell's label names the level and a mute in force", () => {
		expect(bellLabelOf(member(ada), "public", NOW)).toBe("Notification settings")
		expect(bellLabelOf(member(ada, { notificationLevel: "nothing", isMuted: true }), "public", NOW)).toBe(
			"Notification settings: Nothing, Muted",
		)
		// A DM has no level of its own.
		expect(bellLabelOf(member(ada, { notificationLevel: "all" }), "single", NOW)).toBe(
			"Notification settings",
		)
	})

	test("Default inherits the section, then the organization; DMs and threads take their type's", () => {
		expect(inheritedLevelOf("public", { sectionLevel: "nothing", organizationLevel: "all" })).toBe(
			"nothing",
		)
		expect(inheritedLevelOf("private", { sectionLevel: null, organizationLevel: "all" })).toBe("all")
		expect(inheritedLevelOf("public", { sectionLevel: null, organizationLevel: null })).toBe("mentions")
		expect(inheritedLevelOf("thread", { sectionLevel: "nothing", organizationLevel: null })).toBe("all")
	})

	test("the menu: Unmute while muted, the level in force checked, Unfollow on a thread", () => {
		const [first, second] = bellEntries({
			isMuted: true,
			level: "all",
			inheritedLevel: "mentions",
			channelType: "thread",
		})
		expect(first?.entries[0]).toEqual({ id: "mute", label: "Unmute", icon: "volume" })
		expect(first?.entries[1]?.entries?.find((entry) => entry.checked === true)?.id).toBe("level:all")
		expect(second?.entries[0]?.id).toBe("unfollow")
		expect(
			bellEntries({ isMuted: false, level: null, inheritedLevel: "all", channelType: "single" }),
		).toHaveLength(1)
	})

	test("keys make choices: mute for good, a duration, a level, unmute", () => {
		expect(choiceOfKey("mute", false)).toEqual(Option.some({ _tag: "Mute", minutes: null }))
		expect(choiceOfKey("mute", true)).toEqual(Option.some({ _tag: "Unmute" }))
		expect(choiceOfKey("mute:15", false)).toEqual(Option.some({ _tag: "Mute", minutes: 15 }))
		expect(choiceOfKey("mute:forever", false)).toEqual(Option.some({ _tag: "Mute", minutes: null }))
		expect(choiceOfKey("level:default", false)).toEqual(Option.some({ _tag: "SetLevel", level: null }))
		expect(choiceOfKey("level:nothing", false)).toEqual(
			Option.some({ _tag: "SetLevel", level: "nothing" }),
		)
		expect(choiceOfKey("notifications", false)).toEqual(Option.none())
	})
})
