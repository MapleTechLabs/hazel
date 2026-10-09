// @vitest-environment jsdom
import { ChannelId, MessageId } from "@hazel/schema"
import { Schema } from "effect"
import { Command, expectNoOutMessage, expectOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import { ada, hazelOrg, signedInShared } from "../../test/root-fixtures"
import * as CommandMenu from "../../ui/command-menu"
import { CreateChannel, FocusInput, JoinChannel, SetPresenceStatus, TrackRecentChannel } from "./commands"
import { Message, OutMessage } from "./message"
import type { Model } from "./model"
import { SaveRecentSearches } from "./search-mount"
import { CREATE_CHANNEL_INPUT_ID, init, JOIN_CHANNEL_INPUT_ID, MENU_ID, open, update } from "./update"
import { successToast } from "../../data/actions"

/** The palette's pages, back stack and actions (legacy `components/command-palette`). */

const shared = signedInShared()
const run = (model: Model, message: Message) => update(model, message, shared)
const opened = open(init(), "home", shared).model
const done = Message.CompletedFocusInput()
const item = (key: string) => Message.GotMenuMessage({ message: CommandMenu.Message.ClickedItem({ key }) })
const searched = (value: string) => Message.GotMenuMessage({ message: CommandMenu.Message.ChangedSearch({ value }) })
const escape = Message.GotMenuMessage({ message: CommandMenu.Message.PressedSearchKey({ key: "Escape" }) })
const channelId = Schema.decodeSync(ChannelId)("00000000-0000-4000-8000-0000000000c1")

describe("opening", () => {
	test("opens on a fresh home page and focuses the search field", () => {
		const result = open(init(), "home", shared)
		expect(result.model.isOpen).toBe(true)
		expect(result.model.page).toEqual({ _tag: "Home", inputValue: "" })
		expect(result.model.menu.isOpen).toBe(true)
		expect(result.commands?.map((command) => command.args)).toEqual([
			{ selector: `#${CommandMenu.searchId(MENU_ID)}` },
		])
	})
})

describe("back stack", () => {
	// B4: legacy `navigateTo` pushes the page with its typed search; the menu's `activated` resets it.
	test("a sub-page remembers the home search, and Back restores it", () => {
		story(
			run,
			given(opened),
			message(searched("jo")),
			message(item("action:join-channel")),
			Command.expectExact(FocusInput({ selector: `#${JOIN_CHANNEL_INPUT_ID}` })),
			Command.resolve(FocusInput, done),
			model((m) => {
				expect(m.page._tag).toBe("JoinChannel")
				expect(m.history).toEqual([{ _tag: "Home", inputValue: "jo" }])
			}),
			message(Message.ClickedBack()),
			Command.resolve(FocusInput, done),
			model((m) => {
				expect(m.page).toEqual({ _tag: "Home", inputValue: "jo" })
				expect(m.menu.inputValue).toBe("jo")
				expect(m.history).toEqual([])
			}),
		)
	})

	test("a sub-page pushes home onto the back stack, and Back pops it", () => {
		story(
			run,
			given(opened),
			message(item("action:join-channel")),
			Command.expectExact(FocusInput({ selector: `#${JOIN_CHANNEL_INPUT_ID}` })),
			Command.resolve(FocusInput, done),
			model((m) => {
				expect(m.page._tag).toBe("JoinChannel")
				expect(m.history.map((page) => page._tag)).toEqual(["Home"])
			}),
			message(Message.ClickedBack()),
			Command.resolve(FocusInput, done),
			model((m) => {
				expect(m.page._tag).toBe("Home")
				expect(m.history).toEqual([])
			}),
		)
	})

	test("Escape in an empty field goes back first, then closes", () => {
		story(
			run,
			given(opened),
			message(item("pref:status")),
			Command.resolve(FocusInput, done),
			message(escape),
			Command.resolve(FocusInput, done),
			model((m) => {
				expect(m.isOpen).toBe(true)
				expect(m.page._tag).toBe("Home")
			}),
			message(escape),
			Command.expectNone(),
			model((m) => expect(m.isOpen).toBe(false)),
		)
	})

	test("the Esc button closes from any depth and resets to home", () => {
		story(
			run,
			given(opened),
			message(item("action:create-channel")),
			Command.resolve(FocusInput, done),
			message(Message.ClickedEscButton()),
			model((m) => {
				expect(m.isOpen).toBe(false)
				expect(m.page._tag).toBe("Home")
				expect(m.history).toEqual([])
			}),
		)
	})
})

describe("create channel", () => {
	const onCreate = run(opened, item("action:create-channel")).model

	test("opening the page focuses the name field", () => {
		story(
			run,
			given(opened),
			message(item("action:create-channel")),
			Command.expectExact(FocusInput({ selector: `#${CREATE_CHANNEL_INPUT_ID}` })),
			Command.resolve(FocusInput, done),
		)
	})

	test("a short name shows the legacy error, and editing clears it", () => {
		story(
			run,
			given(onCreate),
			message(Message.ChangedChannelName({ value: "ab" })),
			message(Message.SubmittedCreateChannel()),
			Command.expectNone(),
			model((m) => expect(m.page).toMatchObject({ error: "Channel name must be at least 3 characters" })),
			message(Message.ChangedChannelName({ value: "abc" })),
			model((m) => expect(m.page).toMatchObject({ error: null })),
		)
	})

	test("submits once while the action runs, and a failure toasts and re-enables", () => {
		const failed = { intent: "error" as const, title: "Nope", description: null }
		story(
			run,
			given(onCreate),
			message(Message.ChangedChannelName({ value: "design" })),
			message(Message.ChangedChannelType({ value: "private" })),
			message(Message.SubmittedCreateChannel()),
			Command.expectExact(
				CreateChannel({
					name: "design",
					type: "private",
					organizationId: hazelOrg.id,
					currentUserId: ada.id,
				}),
			),
			model((m) => expect(m.page).toMatchObject({ isSubmitting: true })),
			Command.resolve(CreateChannel, Message.FailedCreateChannel({ toast: failed })),
			expectOutMessage(OutMessage.RequestedToast({ toast: failed })),
			model((m) => {
				expect(m.isOpen).toBe(true)
				expect(m.page).toMatchObject({ isSubmitting: false, name: "design" })
			}),
		)
	})

	test("success closes and reports the new channel's URL with a toast", () => {
		story(
			run,
			given(onCreate),
			message(Message.SucceededCreateChannel({ channelId })),
			expectOutMessage(
				OutMessage.Completed({
					href: `/hazel/chat/${channelId}`,
					toast: successToast("Channel created successfully"),
				}),
			),
			model((m) => expect(m.isOpen).toBe(false)),
		)
	})
})

describe("join channel", () => {
	test("joins as the current user, then closes with a toast and no navigation", () => {
		story(
			run,
			given(run(opened, item("action:join-channel")).model),
			message(Message.ClickedJoinChannel({ channelId })),
			Command.expectExact(JoinChannel({ channelId, userId: ada.id })),
			Command.resolve(JoinChannel, Message.SucceededJoinChannel()),
			expectOutMessage(OutMessage.Completed({ href: null, toast: successToast("Successfully joined channel") })),
		)
	})
})

describe("home actions", () => {
	test("a channel item navigates and records the visit", () => {
		story(
			run,
			given(opened),
			message(item(`channel:${channelId}`)),
			Command.expectExact(TrackRecentChannel({ channelId })),
			expectOutMessage(OutMessage.Completed({ href: `/hazel/chat/${channelId}`, toast: null })),
			Command.resolve(TrackRecentChannel, Message.CompletedTrackRecentChannel()),
		)
	})

	test("start conversation hands off to the root's modal", () => {
		story(
			run,
			given(opened),
			message(item("action:start-dm")),
			expectOutMessage(OutMessage.RequestedModal({ modal: { _tag: "CreateDm" } })),
			model((m) => expect(m.isOpen).toBe(false)),
		)
	})

	test("a theme keeps the current customization", () => {
		story(
			run,
			given(run(opened, item("pref:appearance")).model),
			message(item("theme:light")),
			expectOutMessage(
				OutMessage.RequestedTheme({ preference: { mode: "light", customization: shared.theme.customization } }),
			),
		)
	})

	test("a status is sent and handed to presence, which keeps it ahead of AFK", () => {
		story(
			run,
			given(opened),
			message(item("status:away")),
			Command.expectExact(SetPresenceStatus({ status: "away" })),
			expectOutMessage(OutMessage.RequestedPresenceStatus({ status: "away" })),
			Command.resolve(SetPresenceStatus, Message.SucceededSetPresenceStatus()),
			model((m) => expect(m.isOpen).toBe(false)),
		)
	})

	test("a failed status update closes quietly, like legacy", () => {
		story(
			run,
			given(opened),
			message(item("status:dnd")),
			Command.resolve(SetPresenceStatus, Message.FailedSetPresenceStatus({ reason: "offline" })),
			model((m) => expect(m.isOpen).toBe(false)),
		)
	})

	test("an unknown key is ignored", () => {
		story(run, given(opened), message(item("nope:1")), Command.expectNone(), expectNoOutMessage())
	})
})

describe("search page", () => {
	test("opening a result stamps the recent search with the root's clock", () => {
		const nowMs = 1_700_000_000_000
		const clocked = { ...shared, nowMs }
		const messageId = Schema.decodeSync(MessageId)("00000000-0000-4000-8000-0000000000d1")
		const searching: Model = {
			...opened,
			page: { _tag: "Search", query: "hello", rawInput: "hello", filters: [], selectedIndex: 0 },
			search: {
				isLoading: false,
				hasQuery: true,
				results: [
					{
						messageId,
						channelId,
						content: "hello there",
						createdAtMs: nowMs - 60_000,
						authorName: "Ada",
						authorAvatarUrl: null,
						channelName: "general",
						attachmentCount: 0,
					},
				],
			},
		}
		const recent = [{ query: "hello", filters: [], timestamp: nowMs }]
		story(
			(model: Model, msg: Message) => update(model, msg, clocked),
			given(searching),
			message(Message.ClickedSearchResult({ index: 0 })),
			Command.expectExact(SaveRecentSearches({ searches: recent })),
			expectOutMessage(
				OutMessage.Completed({ href: `/hazel/chat/${channelId}?messageId=${messageId}`, toast: null }),
			),
			Command.resolve(SaveRecentSearches, Message.CompletedSaveRecentSearches()),
			model((m) => expect(m.recentSearches).toEqual(recent)),
		)
	})
})
