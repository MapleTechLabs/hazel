// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { Component } from "@effect/ui"
import { Locator, Scene } from "@effect/ui/testing"
import { ChannelId, ChannelMemberId, UserId } from "@hazel/schema"
import { describe, expect, test } from "vitest"
import { Navigate, ShowToast } from "../app/requests"
import { ChannelMenu, notificationValueOf } from "./ChannelMenu"
import { ChannelHeaderMessage, WriteNotificationChoice } from "./header/ChannelHeader"
import type { HeaderMember } from "./header/model"

/** The phone's channel menu: the bubble opens a card; its rows lead to pages or write the member. */

const NOW = Date.parse("2026-11-28T12:00:00.000Z")
const channelId = ChannelId.make("00000005-0000-4000-8000-000000000001")
const ada = UserId.make("00000001-0000-4000-8000-000000000001")
const adaMember = ChannelMemberId.make("00000007-0000-4000-8000-000000000001")

const member = (overrides: Partial<HeaderMember> = {}): HeaderMember => ({
	id: adaMember,
	userId: ada,
	isHidden: false,
	isMuted: false,
	mutedUntilMs: null,
	notificationLevel: null,
	displayName: "Ada Lovelace",
	avatarUrl: null,
	isBot: false,
	...overrides,
})

const start = (members: ReadonlyArray<HeaderMember> = [member()]) =>
	Scene.start(ChannelMenu, {
		orgSlug: "hazel",
		channelId,
		userId: ada,
		name: "ext-adjust",
		kind: "public",
		icon: null,
		members: 11,
		nowMs: NOW,
	}).given({ open: false, page: "main", members, inheritedLevel: "mentions" })

const byProp = (tag: string, name: string, value: unknown): Locator.Locator => ({
	description: `<hz:${tag} ${name}=${JSON.stringify(value)}>`,
	all: (root) => Locator.all(root, Locator.tag(`hz:${tag}`)).filter((node) => node.props?.[name] === value),
})
const popover = Locator.tag("hz:popover")
const bubble = byProp("item", "title", "ext-adjust")
const row = (title: string) => byProp("item", "title", title)
const button = (label: string) => byProp("button", "label", label)

describe("channel menu", () => {
	test("the bubble opens the card, and Close shuts it", () => {
		const s = start()
		expect(s.get(popover).props?.["open"]).not.toBe(true)
		expect(s.get(bubble).props?.["subtitle"]).toBe("11 members")
		s.fire(bubble, "press")
		expect(s.get(popover).props?.["open"]).toBe(true)
		s.fire(button("Close"), "press")
		expect(s.get(popover).props?.["open"]).not.toBe(true)
	})

	test("Settings & Details closes the card and pushes the details list", () => {
		const s = start()
		s.fire(bubble, "press")
			.fire(row("Settings & Details"), "press")
			.expectExact(Navigate.make({ href: `/hazel/channels/${channelId}/settings`, replace: false }))
			.resolve(Navigate, Component.noop)
		expect(s.get(popover).props?.["open"]).not.toBe(true)
	})

	test("Files & Links opens the channel's files", () => {
		start()
			.fire(row("Files & Links"), "press")
			.expectExact(Navigate.make({ href: `/hazel/chat/${channelId}/files`, replace: false }))
			.resolve(Navigate, Component.noop)
	})

	test("Mute mutes until turned back on, with today's toast", () => {
		start()
			.fire(button("Mute"), "press")
			.expectExact(
				WriteNotificationChoice.make({
					memberId: adaMember,
					choice: { _tag: "Mute", minutes: null },
				}),
			)
			.resolve(
				WriteNotificationChoice,
				ChannelHeaderMessage.SucceededNotificationChoice({ choice: { _tag: "Mute", minutes: null } }),
			)
			.expectExact(
				ShowToast.make({ toast: { intent: "success", title: "Channel muted", description: null } }),
			)
	})

	test("a muted member sees Unmute, and the notifications row says Muted", () => {
		const s = start([member({ isMuted: true })])
		s.expect(button("Unmute")).toExist()
		expect(notificationValueOf(member({ isMuted: true }), "mentions", NOW)).toBe("Muted")
		expect(notificationValueOf(member(), "mentions", NOW)).toBe("Mentions")
		expect(notificationValueOf(member({ notificationLevel: "all" }), "mentions", NOW)).toBe("All")
	})

	test("Notifications opens its page in the card; a level chosen there writes it", () => {
		const s = start()
		s.fire(bubble, "press").fire(row("Notifications"), "press")
		s.expect(row("Default (Only @mentions)")).toExist()
		s.expect(row("Mute for 1 hour")).toExist()
		s.fire(row("All messages"), "press").expectExact(
			WriteNotificationChoice.make({ memberId: adaMember, choice: { _tag: "SetLevel", level: "all" } }),
		)
		s.expect(row("Settings & Details")).toExist()
	})

	test("Back on the notifications page returns to the card", () => {
		const s = start()
		s.fire(row("Notifications"), "press").fire(button("Back"), "press")
		s.expect(row("Files & Links")).toExist()
	})

	test("someone not in the channel gets no mute or notifications", () => {
		const s = start([])
		s.expect(button("Mute")).toHaveCount(0)
		s.expect(row("Notifications")).toHaveCount(0)
		s.expect(row("Settings & Details")).toExist()
	})
})
