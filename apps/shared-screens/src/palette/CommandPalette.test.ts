// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { Component } from "@effect/ui"
import { Locator, Scene } from "@effect/ui/testing"
import { Theme } from "@hazel/domain/models"
import { ChannelId, MessageId, OrganizationId, UserId } from "@hazel/schema"
import { describe, expect, test } from "vitest"
import { Navigate, OpenModal, SetTheme, ShowToast } from "../app/requests"
import {
	CommandPaletteNoDeps,
	CreatePaletteChannel,
	PaletteEvents,
	PaletteMessage,
	SaveRecentSearches,
	SetPresenceStatus,
	TrackRecentChannel,
} from "./CommandPalette"
import type { PalettePage } from "../app/requests"
import type { PaletteProps, SearchResult } from "./model"

/** The palette's pages, its back stack, search with filters and recents, and what it asks the app for. */

const ORG = OrganizationId.make("00000001-0000-4000-8000-000000000001")
const ADA = UserId.make("00000002-0000-4000-8000-000000000001")
const GRACE = "00000002-0000-4000-8000-000000000002"
const general = ChannelId.make("00000005-0000-4000-8000-000000000001")
const design = ChannelId.make("00000005-0000-4000-8000-000000000005")
const NOW = Date.parse("2026-11-26T15:00:00Z")

const props = (page: PalettePage): PaletteProps => ({
	page,
	open: true,
	organizationId: ORG,
	userId: ADA,
	orgSlug: "hazel",
	theme: {
		mode: "system",
		customization: {
			primary: Theme.HexColor.make("#6938EF"),
			grayPalette: "gray-neutral",
			radius: "normal",
		},
	},
	destinations: [
		{
			id: "home",
			label: "Home",
			group: "Navigation",
			keywords: "dashboard",
			icon: "dashboard",
			href: "/hazel",
			pinned: true,
		},
		{
			id: "settingsTeam",
			label: "Team",
			group: "Workspace settings",
			keywords: "members people",
			icon: "users",
			href: "/hazel/settings/team",
			pinned: false,
		},
	],
	shortcuts: { search: "⇧⌘F", createChannel: "⌥⌘N", createDm: "⌥⌘D", invite: "⌥⌘I", aiPanel: "⌘J" },
	nowMs: NOW,
})

const start = (page: PalettePage = "home") => Scene.start(CommandPaletteNoDeps, props(page))

const paletteNode: Locator.Locator = {
	description: "<hz:commandPalette>",
	all: (root) => Locator.all(root, Locator.tag("hz:commandPalette")),
}

type Groups = ReadonlyArray<{
	readonly title?: string
	readonly items: ReadonlyArray<{ id: string; label: string }>
}>
type Steps = ReturnType<typeof start>

const groupsOf = (s: Steps): Groups => (s.get(paletteNode).props?.["groups"] ?? []) as Groups
const titlesOf = (s: Steps) => groupsOf(s).map((group) => group.title)
const labelsIn = (s: Steps, title: string) =>
	groupsOf(s)
		.find((group) => group.title === title)
		?.items.map((item) => item.label)
const propOf = (s: Steps, name: string) => s.get(paletteNode).props?.[name]

/** Typing in the field: the edit the palette reports, over the Model's latest revision. */
const typed = (s: Steps, text: string) =>
	s.fire(paletteNode, "change", { value: text, rev: 1 + Number(text.length), edit: 0 })
const select = (s: Steps, id: string) => s.fire(paletteNode, "select", { id })

const channels = PaletteMessage.UpdatedChannels({
	channels: [
		{ id: design, name: "design", type: "public", icon: null },
		{ id: general, name: "general", type: "public", icon: null },
	],
})

const result = (n: number, content: string): SearchResult => ({
	messageId: MessageId.make(`00000020-0000-4000-8000-00000000000${n}`),
	channelId: general,
	content,
	createdAtMs: NOW - n * 3_600_000,
	authorName: "Grace Hopper",
	authorAvatarUrl: null,
	channelName: "general",
	attachmentCount: 0,
})

describe("home", () => {
	test("recent channels, actions, channels and the pinned pages; typing filters every group", () => {
		const s = start()
			.subscription("channels:true", channels)
			.subscription(
				"recentChannelIds:",
				PaletteMessage.LoadedRecentChannelIds({ channelIds: [design] }),
			)
			.subscription(
				`recentChannels:"${design}"`,
				PaletteMessage.UpdatedRecentChannels({
					channels: [{ id: design, name: "design", type: "public", icon: null }],
				}),
			)
		expect(titlesOf(s)).toEqual(["Recent", "Quick actions", "Channels", "Navigation", "Preferences"])
		expect(propOf(s, "placeholder")).toBe("Where would you like to go?")
		typed(s, "team members")
		// Every word in the item's text, in any order: a page by its label and keywords.
		expect(titlesOf(s)).toEqual(["Workspace settings"])
		typed(s, "gen")
		expect(labelsIn(s, "Channels")).toEqual(["general"])
	})

	test("a channel is remembered, opened, and the palette closes", () => {
		const s = start().subscription("channels:true", channels)
		select(s, `channel:${general}`)
			.expectExact(
				TrackRecentChannel.make({ channelId: general }),
				Navigate.make({ href: `/hazel/chat/${general}`, replace: false }),
			)
			.emitted(PaletteEvents.RequestedClose())
			.resolve(TrackRecentChannel, Component.noop)
			.resolve(Navigate, Component.noop)
	})

	test("actions open the app's modals and the AI panel", () => {
		select(start(), "action:invite")
			.expectExact(OpenModal.make({ modal: { _tag: "EmailInvite" } }))
			.emitted(PaletteEvents.RequestedClose())
			.resolve(OpenModal, Component.noop)
		select(start(), "action:ai-panel").emitted(
			PaletteEvents.RequestedAiPanel(),
			PaletteEvents.RequestedClose(),
		)
	})

	test("a page goes on the back stack with what was typed; Escape comes back, then closes", () => {
		const s = start()
		typed(s, "stat")
		select(s, "pref:status")
		expect(propOf(s, "placeholder")).toBe("Set your status...")
		s.fire(paletteNode, "dismiss")
		expect(propOf(s, "placeholder")).toBe("Where would you like to go?")
		expect((propOf(s, "query") as { text: string }).text).toBe("stat")
		s.fire(paletteNode, "dismiss").emitted(PaletteEvents.RequestedClose())
	})
})

describe("status and appearance", () => {
	test("the current status is marked; a pick sets it and tells the app", () => {
		const s = start("status").subscription(
			"presence:true",
			PaletteMessage.UpdatedPresenceStatus({ status: "away" }),
		)
		expect(labelsIn(s, "Set status")).toContain("Away (current)")
		select(s, "status:dnd")
			.expectExact(SetPresenceStatus.make({ status: "dnd" }))
			.emitted(PaletteEvents.PickedStatus({ status: "dnd" }), PaletteEvents.RequestedClose())
			.resolve(SetPresenceStatus, Component.noop)
	})

	test("a theme keeps the user's colours and changes the mode", () => {
		const s = start("appearance")
		expect(labelsIn(s, "Theme")).toEqual(["System (current)", "Light", "Dark"])
		select(s, "theme:dark")
			.expectExact(SetTheme.make({ preference: { ...props("appearance").theme, mode: "dark" } }))
			.emitted(PaletteEvents.RequestedClose())
			.resolve(SetTheme, Component.noop)
	})
})

describe("message search", () => {
	test("before typing it says what to do; the server's answer lists the messages", () => {
		const s = start("search")
		expect(propOf(s, "empty")).toBe("Start typing to search messages")
		typed(s, "release")
		expect(propOf(s, "loading")).toBe(true)
		s.loaded("serverResults", [result(1, "The **release** notes")])
		expect(propOf(s, "loading")).toBeUndefined()
		expect(labelsIn(s, "Messages")).toEqual(["The release notes"])
	})

	test("a failed search says so; nothing found says that", () => {
		const s = start("search")
		typed(s, "release")
		s.loadFailed("serverResults", "Failed")
		expect(propOf(s, "empty")).toBe("Couldn't search messages. Check your connection and try again.")
		const none = start("search")
		typed(none, "release")
		none.loaded("serverResults", [])
		expect(propOf(none, "empty")).toBe("No messages found")
	})

	test("a typed from: offers people; a pick becomes a filter and the text goes", () => {
		const s = start("search")
		// The words before the filter already search; the pick below changes the request.
		typed(s, "notes from:gr").loaded("serverResults", [])
		s.subscription(
			'suggestions:"from","gr"',
			PaletteMessage.UpdatedSuggestions({
				suggestions: [{ id: GRACE, label: "Grace Hopper", avatarUrl: null, kind: "user" }],
			}),
		)
		expect(titlesOf(s)).toEqual(["Select a user"])
		select(s, `suggestion:${GRACE}`)
		expect((propOf(s, "query") as { text: string }).text).toBe("notes ")
		expect(propOf(s, "placeholder")).toBe("Add more filters or search...")
		s.loaded("serverResults", [result(1, "Release notes")])
		expect(labelsIn(s, "Filters")).toEqual(["From: Grace Hopper"])
		select(s, "filter:0")
		expect(titlesOf(s)).not.toContain("Filters")
	})

	test("opening a result remembers the search, opens the message and closes", () => {
		const s = start("search")
		typed(s, "release")
		s.loaded("serverResults", [result(1, "Release notes")])
		const messageId = result(1, "").messageId
		const searches = [{ query: "release", filters: [], timestamp: NOW }]
		select(s, "result:0")
			.expectExact(
				SaveRecentSearches.make({ searches }),
				Navigate.make({ href: `/hazel/chat/${general}?messageId=${messageId}`, replace: false }),
			)
			.emitted(PaletteEvents.RequestedClose())
			.resolve(SaveRecentSearches, Component.noop)
			.resolve(Navigate, Component.noop)
	})

	test("recent searches show before typing; one restores its text and filters, Clear all empties them", () => {
		const recent = {
			query: "notes",
			filters: [
				{ type: "from" as const, value: "Grace Hopper", displayValue: "Grace Hopper", id: GRACE },
			],
			timestamp: NOW - 60_000,
		}
		const s = start("search").subscription(
			"recentSearches:true",
			PaletteMessage.LoadedRecentSearches({ searches: [recent] }),
		)
		expect(labelsIn(s, "Recent searches")).toEqual(['from:"Grace Hopper" notes', "Clear all"])
		select(s, "recent-search:0")
		expect((propOf(s, "query") as { text: string }).text).toBe("notes")
		const cleared = start("search").subscription(
			"recentSearches:true",
			PaletteMessage.LoadedRecentSearches({ searches: [recent] }),
		)
		select(cleared, "recent-search:clear")
			.expectExact(SaveRecentSearches.make({ searches: [] }))
			.resolve(SaveRecentSearches, Component.noop)
		expect(titlesOf(cleared)).toEqual([])
	})
})

describe("create channel", () => {
	const nameField: Locator.Locator = {
		description: "<hz:textField label=Channel name>",
		all: (root) =>
			Locator.all(root, Locator.tag("hz:textField")).filter(
				(node) => node.props?.["label"] === "Channel name",
			),
	}

	test("a short name is refused; a good one is created, opened and toasted", () => {
		const channelId = ChannelId.make("00000005-0000-4000-8000-0000000000c1")
		const s = start("create-channel")
		expect(propOf(s, "title")).toBe("Create channel")
		s.fire(nameField, "change", { value: "ab", rev: 1, edit: 0 }).fire(nameField, "submit", {
			value: "ab",
			rev: 1,
			edit: 0,
		})
		expect(s.get(nameField).props?.["error"]).toBe("Channel name must be at least 3 characters")
		s.fire(nameField, "change", { value: "design", rev: 2, edit: 0 })
			.fire(nameField, "submit", { value: "design", rev: 2, edit: 0 })
			.expectExact(
				CreatePaletteChannel.make({
					name: "design",
					type: "public",
					organizationId: ORG,
					currentUserId: ADA,
				}),
			)
			.resolve(CreatePaletteChannel, PaletteMessage.SucceededCreateChannel({ channelId }))
			.expectExact(
				Navigate.make({
					href: `/hazel/chat/${channelId}`,
					replace: false,
					toast: { intent: "success", title: "Channel created successfully", description: null },
				}),
			)
			.emitted(PaletteEvents.RequestedClose())
			.resolve(Navigate, Component.noop)
	})

	test("a failure toasts and lets the user try again", () => {
		const s = start("create-channel")
		s.fire(nameField, "change", { value: "design", rev: 1, edit: 0 })
			.fire(nameField, "submit", { value: "design", rev: 1, edit: 0 })
			.resolve(CreatePaletteChannel, PaletteMessage.FailedCreateChannel())
			.expectExact(
				ShowToast.make({
					toast: {
						intent: "error",
						title: "Failed to create channel",
						description: "Something went wrong. Please try again.",
					},
				}),
			)
			.resolve(ShowToast, Component.noop)
	})
})
