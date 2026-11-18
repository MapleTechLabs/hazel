// @vitest-environment jsdom
import { ChannelId, ChannelMemberId, ChannelSectionId } from "@hazel/schema"
import { Effect } from "effect"
import { Command, expectNoOutMessage, expectOutMessage, given, message, model, story } from "foldkit/story"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { errorToast, successToast } from "../../data/actions"
import { PageOutMessage } from "../../page/out-message"
import { AppRoute } from "../../route"
import * as Menu from "../../ui/menu"
import {
	init,
	loadIsCreateChannelHintDismissed,
	Message,
	type Model,
	OpenMenu,
	update,
} from "../channels-sidebar"
import { UpdateChannelMember } from "./actions"
import { PersistDismissedHint } from "./hints"
import { dmMenuEntries, rowMenuEntries, sectionMenuEntries } from "./menus"

/** The sidebar's menus, hint and action toasts: typed menu identity, outcomes and reasons. */

const channelId = ChannelId.make("00000000-0000-4000-8000-000000000001")
const memberId = ChannelMemberId.make("00000000-0000-4000-8000-000000000002")
const sectionId = ChannelSectionId.make("00000000-0000-4000-8000-000000000003")

const entry = {
	channel: { id: channelId, name: "general", type: "public", icon: null, sectionId: null },
	member: { id: memberId, isMuted: false, isFavorite: false, notificationCount: 0 },
}

const loaded: Model = {
	...init({ isCreateChannelHintDismissed: false }),
	sections: [{ id: sectionId, name: "Projects" }],
	sectionChannels: { default: [entry] },
}

const rowMenu = (state: Model, menuMessage: Menu.Message) =>
	update(state, Message.GotRowMenuMessage({ channelId, orgSlug: "acme", message: menuMessage }))

const sectionMenu = (state: Model, menuMessage: Menu.Message) =>
	update(state, Message.GotSectionMenuMessage({ sectionId, message: menuMessage }))

const pressed = Menu.Message.PressedTrigger({ pointerType: "mouse" })
const rowClicked = (key: string) =>
	Menu.Message.ClickedItem({ key, entries: rowMenuEntries(loaded.sections, false) })
const sectionClicked = (key: string) =>
	Menu.Message.ClickedItem({ key, entries: sectionMenuEntries(["create-channel", "join-channel"], true) })

describe("open menu", () => {
	test("opening a row menu keeps it as a Row, keyed by channel", () => {
		const { model: next } = rowMenu(loaded, pressed)
		expect(next.openMenu?._tag).toBe("Row")
		expect(next.openMenu).toMatchObject({ _tag: "Row", channelId, orgSlug: "acme" })
	})

	test("opening a section menu replaces the open row menu", () => {
		const withRow = rowMenu(loaded, pressed).model
		const { model: next } = sectionMenu(withRow, pressed)
		expect(next.openMenu).toMatchObject({ _tag: "Section", sectionKey: sectionId })
	})

	test("a section menu step never closes another target's open row menu", () => {
		const withRow = rowMenu(loaded, pressed).model
		const { model: next } = sectionMenu(withRow, Menu.Message.PressedOutside())
		expect(next.openMenu).toBe(withRow.openMenu)
	})

	test("selecting mute closes the menu and mutes the member", () => {
		const open = rowMenu(loaded, pressed).model
		const { model: next, commands } = rowMenu(open, rowClicked("mute"))
		expect(next.openMenu).toBeNull()
		expect(commands?.find((command) => command.name === UpdateChannelMember.name)?.args).toEqual({
			memberId,
			field: "isMuted",
			value: true,
		})
	})

	test("settings navigates to the channel's settings route", () => {
		const open = rowMenu(loaded, pressed).model
		const { outMessage } = rowMenu(open, rowClicked("settings"))
		expect(outMessage).toEqual(
			PageOutMessage.RequestedNavigation({
				route: AppRoute.ChannelSettings({ orgSlug: "acme", channelId }),
				replace: false,
			}),
		)
	})

	test("a section-menu action asks for its modal", () => {
		const open = sectionMenu(loaded, pressed).model
		const { outMessage } = sectionMenu(open, sectionClicked("join-channel"))
		expect(outMessage).toEqual(PageOutMessage.RequestedModal({ modal: { _tag: "JoinChannel" } }))
	})

	test("OpenMenu is a tagged union", () => {
		const menu = Menu.init({ id: "x" })
		expect(OpenMenu.Section({ sectionKey: "dms", menu })._tag).toBe("Section")
	})
})

describe("DM row menu", () => {
	const dmId = ChannelId.make("00000000-0000-4000-8000-000000000011")
	const dmMemberId = ChannelMemberId.make("00000000-0000-4000-8000-000000000012")
	const withDm: Model = {
		...loaded,
		dmChannelIds: [dmId],
		dmChannels: {
			[dmId]: {
				id: dmId,
				type: "single",
				members: [],
				currentUser: { id: dmMemberId, isMuted: false, isFavorite: true, notificationCount: 0 },
			},
		},
	}
	const dmMenu = (state: Model, menuMessage: Menu.Message) =>
		update(state, Message.GotRowMenuMessage({ channelId: dmId, orgSlug: "acme", message: menuMessage }))
	const dmClicked = (key: string) => Menu.Message.ClickedItem({ key, entries: dmMenuEntries() })
	const memberWrite = (key: string) => {
		const open = dmMenu(withDm, pressed).model
		expect(open.openMenu).toMatchObject({ _tag: "Row", channelId: dmId })
		const { model: next, commands } = dmMenu(open, dmClicked(key))
		expect(next.openMenu).toBeNull()
		return commands?.find((command) => command.name === UpdateChannelMember.name)?.args
	}

	test("the dots open a menu whose items write the DM's own membership", () => {
		expect(memberWrite("mute")).toEqual({ memberId: dmMemberId, field: "isMuted", value: true })
		expect(memberWrite("favorite")).toEqual({ memberId: dmMemberId, field: "isFavorite", value: false })
		expect(memberWrite("hide")).toEqual({ memberId: dmMemberId, field: "isHidden", value: true })
	})

	test("hiding a conversation succeeds silently", () => {
		story(
			update,
			given(withDm),
			message(Message.SucceededSidebarAction({ outcome: "Hidden" })),
			expectNoOutMessage(),
		)
	})
})

describe("sidebar action toasts", () => {
	test("each outcome keeps its legacy success copy", () => {
		story(
			update,
			given(loaded),
			message(Message.SucceededSidebarAction({ outcome: "Muted" })),
			expectOutMessage(PageOutMessage.RequestedToast({ toast: successToast("Channel muted") })),
			message(Message.SucceededSidebarAction({ outcome: "Unfavorited" })),
			expectOutMessage(
				PageOutMessage.RequestedToast({ toast: successToast("Removed from favorites") }),
			),
			message(Message.SucceededSidebarAction({ outcome: "MovedToDefault" })),
			expectOutMessage(
				PageOutMessage.RequestedToast({ toast: successToast("Channel moved to default") }),
			),
		)
	})

	test("feature reasons get their own copy, common reasons the shared copy", () => {
		story(
			update,
			given(loaded),
			message(Message.FailedSidebarAction({ reason: "SectionAlreadyDeleted" })),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: errorToast("Section not found", "This section may have already been deleted."),
				}),
			),
			message(Message.FailedSidebarAction({ reason: "MemberNotFound" })),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: errorToast("Membership not found", "You may no longer be a member of this item."),
				}),
			),
			message(Message.FailedSidebarAction({ reason: "Offline" })),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: errorToast("Connection lost", "Check your internet connection and try again."),
				}),
			),
		)
	})
})

describe("create-channel hint", () => {
	beforeEach(() => localStorage.clear())
	afterEach(() => vi.restoreAllMocks())

	test("dismissing hides it and persists; a failed write is ignored", () => {
		story(
			update,
			given(loaded),
			message(Message.ClickedDismissCreateChannelHint()),
			Command.expectExact(PersistDismissedHint({ hintId: "create-channel" })),
			model((next) => expect(next.isCreateChannelHintDismissed).toBe(true)),
			Command.resolve(PersistDismissedHint, Message.FailedPersistDismissedHint()),
			expectNoOutMessage(),
			model((next) => expect(next.isCreateChannelHintDismissed).toBe(true)),
		)
	})

	test("persisting merges into the stored hints, which load at boot", async () => {
		localStorage.setItem("hazel-dismissed-hints", JSON.stringify({ other: true }))
		expect(await Effect.runPromise(loadIsCreateChannelHintDismissed)).toBe(false)
		const result = await Effect.runPromise(PersistDismissedHint({ hintId: "create-channel" }).effect)
		expect(result).toEqual(Message.CompletedPersistDismissedHint())
		expect(JSON.parse(localStorage.getItem("hazel-dismissed-hints") ?? "")).toEqual({
			other: true,
			"create-channel": true,
		})
		expect(await Effect.runPromise(loadIsCreateChannelHintDismissed)).toBe(true)
	})

	test("a blocked storage write settles as FailedPersistDismissedHint, not a defect", async () => {
		vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
			throw new DOMException("quota", "QuotaExceededError")
		})
		const result = await Effect.runPromise(PersistDismissedHint({ hintId: "create-channel" }).effect)
		expect(result).toEqual(Message.FailedPersistDismissedHint())
	})

	test("undecodable storage reads as not dismissed", async () => {
		localStorage.setItem("hazel-dismissed-hints", "not json")
		expect(await Effect.runPromise(loadIsCreateChannelHintDismissed)).toBe(false)
	})
})
