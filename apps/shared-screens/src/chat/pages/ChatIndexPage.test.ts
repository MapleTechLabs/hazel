// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { Component } from "@effect/ui"
import { Locator, Scene } from "@effect/ui/testing"
import { ChannelId, OrganizationId, OrganizationMemberId, UserId } from "@hazel/schema"
import { describe, expect, test } from "vitest"
import { OpenModal } from "../../app/requests"
import type { Session } from "../../app/session"
import {
	type ChannelGroups,
	type ChannelSummary,
	EMPTY_GROUPS,
	groupChannels,
} from "../components/ChannelCards"
import { ChatIndexMessage, ChatIndexPage } from "./ChatIndexPage"
import { ChatDmsMessage, ChatDmsPage } from "./dms/ChatDmsPage"

/** The chat index (`/:org/chat`) and the wide DMs page (`/:org/chat/dms`). */

const ada = UserId.make("00000001-0000-4000-8000-000000000001")
const grace = UserId.make("00000001-0000-4000-8000-000000000002")
const alan = UserId.make("00000001-0000-4000-8000-000000000003")

const session = (role: "owner" | "member" = "owner"): Session => ({
	auth: "SignedIn",
	user: {
		id: ada,
		firstName: "Ada",
		lastName: "Lovelace",
		email: "ada@hazel.test",
		avatarUrl: null,
		isOnboarded: true,
	},
	organization: {
		id: OrganizationId.make("00000002-0000-4000-8000-000000000001"),
		name: "Hazel",
		slug: "hazel",
		logoUrl: null,
	},
	member: { id: OrganizationMemberId.make("00000003-0000-4000-8000-000000000001"), role },
	orgSlug: "hazel",
})

const person = (userId: UserId, firstName: string, lastName: string) => ({
	userId,
	firstName,
	lastName,
	avatarUrl: null,
})

const channel = (n: number, overrides: Partial<ChannelSummary> = {}): ChannelSummary => ({
	id: ChannelId.make(`00000005-0000-4000-8000-00000000000${n}`),
	name: `channel-${n}`,
	type: "public",
	icon: null,
	isMuted: false,
	isFavorite: false,
	notificationCount: 0,
	members: [person(ada, "Ada", "Lovelace"), person(grace, "Grace", "Hopper")],
	...overrides,
})

const groups: ChannelGroups = {
	publicChannels: [channel(1, { name: "general", isFavorite: true, notificationCount: 3 })],
	privateChannels: [channel(2, { name: "leadership", type: "private", isMuted: true })],
	dmChannels: [
		channel(3, { name: "", type: "single" }),
		channel(4, {
			name: "",
			type: "direct",
			members: [
				person(ada, "Ada", "Lovelace"),
				person(grace, "Grace", "Hopper"),
				person(alan, "Alan", "Turing"),
			],
		}),
	],
}

// Subscription keys, as the instance reports them (name, then its dependencies).
const CHANNELS = `channels:"00000002-0000-4000-8000-000000000001","${ada}"`
const PRESENCE = `presence:"${grace}"`

const byProp = (tag: string, name: string, value: string): Locator.Locator => ({
	description: `<hz:${tag} ${name}=${JSON.stringify(value)}>`,
	all: (root) => Locator.all(root, Locator.tag(`hz:${tag}`)).filter((node) => node.props?.[name] === value),
})
const item = (title: string) => byProp("item", "title", title)
const empty = (title: string) => byProp("emptyState", "title", title)

describe("chat index page", () => {
	test("waits for its channels, then lists the public ones with counts on the tabs", () => {
		const s = Scene.start(ChatIndexPage, { session: session() })
		s.expect(byProp("progress", "label", "Loading...")).toExist()
		s.subscription(CHANNELS, ChatIndexMessage.UpdatedChannels({ groups }))
			.expect(Locator.text("All channels"))
			.toExist()
			.expect(item("general"))
			.toExist()
			.expect(item("leadership"))
			.toBeAbsent()
		expect(s.get(Locator.tag("hz:tabBar")).props?.["tabs"]).toEqual([
			{ id: "public", label: "Public", badge: 1 },
			{ id: "private", label: "Private", badge: 1 },
			{ id: "dms", label: "Direct messages", badge: 2 },
		])
		expect(s.get(item("general")).props).toMatchObject({
			href: "/hazel/chat/00000005-0000-4000-8000-000000000001",
			badge: 3,
		})
	})

	test("the private tab dims a muted channel; the DMs tab names partners and groups", () => {
		const s = Scene.start(ChatIndexPage, { session: session() })
			.subscription(CHANNELS, ChatIndexMessage.UpdatedChannels({ groups }))
			.fire(Locator.tag("hz:tabBar"), "change", { id: "private" })
		expect(s.get(item("leadership")).props).toMatchObject({ muted: true, subtitle: "2 members · Muted" })
		s.fire(Locator.tag("hz:tabBar"), "change", { id: "dms" })
			.subscription(PRESENCE, ChatIndexMessage.UpdatedPresence({ presence: { [grace]: "online" } }))
			.expect(item("Grace Hopper"))
			.toExist()
		expect(s.get(item("Grace Hopper")).props?.["subtitle"]).toBe("Active now")
		expect(s.get(item("Grace, Alan")).props?.["subtitle"]).toBe("2 participants")
	})

	test("an empty tab offers to create, when the member may", () => {
		const s = Scene.start(ChatIndexPage, { session: session() }).subscription(
			CHANNELS,
			ChatIndexMessage.UpdatedChannels({ groups: EMPTY_GROUPS }),
		)
		s.expect(empty("No public channels"))
			.toExist()
			.fire(byProp("button", "label", "Create a channel"), "press")
			.expectExact(OpenModal.make({ modal: { _tag: "NewChannel" } }))
			.resolve(OpenModal, Component.noop)
		Scene.start(ChatIndexPage, { session: session("member") })
			.subscription(CHANNELS, ChatIndexMessage.UpdatedChannels({ groups: EMPTY_GROUPS }))
			.expect(byProp("button", "label", "Create a channel"))
			.toBeAbsent()
	})

	test("groups rows by channel and keeps only the user's visible ones", () => {
		const row = (id: number, type: string, userId: UserId, isHidden = false) => ({
			channel: { id: ChannelId.make(`00000005-0000-4000-8000-00000000000${id}`), name: `c${id}`, type },
			member: { userId, isHidden, isMuted: false, isFavorite: false, notificationCount: null },
			user: { id: userId, firstName: "F", lastName: "L" },
		})
		const grouped = groupChannels(
			[
				row(1, "public", ada),
				row(1, "public", grace),
				row(2, "private", grace),
				row(3, "single", ada, true),
			],
			ada,
		)
		expect(grouped.publicChannels.map((c) => c.members.length)).toEqual([2])
		expect(grouped.privateChannels).toEqual([])
		expect(grouped.dmChannels).toEqual([])
	})
})

describe("wide DMs page", () => {
	test("lists the DMs and starts a new one", () => {
		Scene.start(ChatDmsPage, { session: session() })
			.subscription(CHANNELS, ChatDmsMessage.UpdatedChannels({ groups }))
			.expect(Locator.text("Direct messages"))
			.toExist()
			.expect(item("Grace Hopper"))
			.toExist()
			.fire(byProp("button", "label", "New message"), "press")
			.expectExact(OpenModal.make({ modal: { _tag: "CreateDm" } }))
			.resolve(OpenModal, Component.noop)
	})

	test("with none, it says so", () => {
		Scene.start(ChatDmsPage, { session: session() })
			.subscription(CHANNELS, ChatDmsMessage.UpdatedChannels({ groups: EMPTY_GROUPS }))
			.expect(empty("No direct messages"))
			.toExist()
	})
})
