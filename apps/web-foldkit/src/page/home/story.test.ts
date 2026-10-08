import { ChannelId, OrganizationId, UserId } from "@hazel/schema"
import { Option, Schema } from "effect"
import { Command, expectNoOutMessage, expectOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test, vi } from "vitest"
import * as Menu from "../../ui/menu"
import type { Shared } from "../contract"
import { PageOutMessage } from "../out-message"
import { CopyEmail, CreateDm, FocusSearch } from "./commands"
import { Message } from "./message"
import { type DirectoryMember, DmRequest, type DmRow, filterMembers, type Model } from "./model"
import { init, update } from "./update"
import { sharedDefaults } from "../test-shared"
import { failureToastFixture } from "../../test/pages-fixtures"

// `ui/aria/interaction` names `document` when its module loads; the update loop never touches it.
vi.hoisted(() => {
	Object.assign(globalThis, { document: globalThis.document ?? {} })
})

/** Update-loop tests for the org home directory: search, member menus, opening a DM, copying an email. */

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const ada = Schema.decodeSync(UserId)(uuid(1))
const grace = Schema.decodeSync(UserId)(uuid(2))
const organizationId = Schema.decodeSync(OrganizationId)(uuid(3))
const channelId = Schema.decodeSync(ChannelId)(uuid(4))

const shared: Shared = {
	auth: "SignedIn",
	orgSlug: "hazel",
	currentUser: {
		id: ada,
		firstName: "Ada",
		lastName: "Lovelace",
		email: "ada@hazel.test",
		avatarUrl: null,
		isOnboarded: true,
		organizationId,
	},
	organization: { id: organizationId, name: "Hazel", slug: "hazel", logoUrl: null },
	member: null,
	nowMs: 0,
	...sharedDefaults,
}

const member = (id: UserId, firstName: string, lastName: string): DirectoryMember => ({
	id,
	firstName,
	lastName,
	email: `${firstName.toLowerCase()}@hazel.test`,
	avatarUrl: null,
	role: "member",
	presenceStatus: null,
})
const members = [member(ada, "Ada", "Lovelace"), member(grace, "Grace", "Hopper")]

const pageUpdate = (current: Model, next: Message) => update(current, next, shared)
const dmWithGrace: ReadonlyArray<DmRow> = [ada, grace].map((userId) => ({
	channel: { id: channelId, type: "single", organizationId },
	member: { userId },
}))
const membersOnly = (): Model => update(init().model, Message.UpdatedMembers({ members }), shared).model
/** Members and DM rows loaded; `dmRows` defaults to no DMs at all. */
const loaded = (dmRows: ReadonlyArray<DmRow> = []): Model =>
	update(membersOnly(), Message.UpdatedDmChannels({ rows: dmRows }), shared).model
const withOpenMenu = (userId: UserId): Model => {
	const current = loaded()
	const menu = current.menus[userId]!
	const popup = {
		_tag: "Open",
		focusedKey: Option.none(),
		hoveredKey: Option.none(),
		modality: "Pointer",
		submenu: Option.none(),
		search: "",
		pointerOffset: Option.none(),
	} as const
	return { ...current, menus: { ...current.menus, [userId]: { ...menu, popup } } }
}
const menuMessage = (userId: UserId, child: Menu.Message) =>
	Message.GotMemberMenuMessage({ userId, message: child })

describe("org home directory", () => {
	test("filters by full name or email, case-insensitively", () => {
		expect(filterMembers(members, "GRACE H").map((row) => row.id)).toEqual([grace])
		expect(filterMembers(members, "ada@").map((row) => row.id)).toEqual([ada])
		expect(filterMembers(members, "")).toEqual(members)
	})

	test("keeps an open member menu across live-query updates", () => {
		const opened = pageUpdate(
			loaded(),
			menuMessage(grace, Menu.Message.PressedTrigger({ pointerType: "mouse" })),
		)
		const refreshed = pageUpdate(opened.model, Message.UpdatedMembers({ members })).model
		expect(refreshed.menus[grace]?.popup._tag).toBe("Open")
	})

	test("Copy email copies, then toasts", () => {
		story(
			pageUpdate,
			given(withOpenMenu(grace)),
			message(menuMessage(grace, Menu.Message.ClickedItem({ key: "copy-email" }))),
			model((current) => expect(current.menus[grace]?.popup._tag).toBe("Closed")),
			Command.resolve(CopyEmail, Message.SucceededCopyEmail({ email: "grace@hazel.test" })),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: {
						intent: "success",
						title: "Email copied",
						description: "grace@hazel.test copied to clipboard",
					},
				}),
			),
		)
	})

	test("Message opens an existing DM", () => {
		story(
			pageUpdate,
			given(loaded(dmWithGrace)),
			message(Message.PressedMessageMember({ userId: grace, name: "Grace Hopper" })),
			Command.expectNone(),
			expectOutMessage(
				PageOutMessage.RequestedNavigation({ href: `/hazel/chat/${channelId}`, replace: false }),
			),
			model((current) => expect(current.dmRequest).toEqual(DmRequest.Idle())),
		)
	})

	test("Message creates a DM with a loading toast, then a success toast and navigation", () => {
		story(
			pageUpdate,
			given(loaded()),
			message(Message.PressedMessageMember({ userId: grace, name: "Grace Hopper" })),
			Command.expectExact(CreateDm({ organizationId, userId: grace, name: "Grace Hopper" })),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: {
						intent: "loading",
						title: "Starting conversation with Grace Hopper...",
						description: null,
						id: "home-create-dm",
					},
				}),
			),
			Command.resolve(CreateDm, Message.SucceededCreateDm({ channelId, name: "Grace Hopper" })),
			expectOutMessage(
				PageOutMessage.RequestedNavigation({
					href: `/hazel/chat/${channelId}`,
					replace: false,
					toast: {
						intent: "success",
						title: "Started conversation with Grace Hopper",
						description: null,
						id: "home-create-dm",
					},
				}),
			),
		)
	})
})

describe("org home failures and guards", () => {
	test("a failed DM creation replaces the loading toast with the error", () => {
		story(
			pageUpdate,
			given(loaded()),
			message(Message.PressedMessageMember({ userId: grace, name: "Grace Hopper" })),
			Command.resolve(CreateDm, Message.FailedCreateDm({ toast: failureToastFixture })),
			expectOutMessage(PageOutMessage.RequestedToast({ toast: { ...failureToastFixture, id: "home-create-dm" } })),
			model((current) => expect(current.dmRequest).toEqual(DmRequest.Idle())),
		)
	})

	test("a failed copy toasts an error", () => {
		story(
			pageUpdate,
			given(withOpenMenu(grace)),
			message(menuMessage(grace, Menu.Message.ClickedItem({ key: "copy-email" }))),
			Command.resolve(CopyEmail({ email: "grace@hazel.test" }), Message.FailedCopyEmail()),
			expectOutMessage(
				PageOutMessage.RequestedToast({ toast: { intent: "error", title: "Failed to copy email", description: "Please try again" } }),
			),
		)
	})

	test("the menu's Message item creates the DM with the member's full name", () => {
		story(
			pageUpdate,
			given(withOpenMenu(grace)),
			message(menuMessage(grace, Menu.Message.ClickedItem({ key: "message" }))),
			Command.expectHas(CreateDm({ organizationId, userId: grace, name: "Grace Hopper" })),
			Command.resolve(CreateDm, Message.SucceededCreateDm({ channelId, name: "Grace Hopper" })),
		)
	})

	test("a press before the DM rows load waits for them, then opens the DM", () => {
		story(
			pageUpdate,
			given(membersOnly()),
			message(Message.PressedMessageMember({ userId: grace, name: "Grace Hopper" })),
			Command.expectNone(),
			expectNoOutMessage(),
			model((current) => expect(current.dmRequest).toEqual(DmRequest.AwaitingChannels({ userId: grace }))),
			message(Message.UpdatedDmChannels({ rows: dmWithGrace })),
			expectOutMessage(PageOutMessage.RequestedNavigation({ href: `/hazel/chat/${channelId}`, replace: false })),
			model((current) => expect(current.dmRequest).toEqual(DmRequest.Idle())),
		)
	})

	test("a DM row update while the DM is being created does not open it a second time", () => {
		const creating = pageUpdate(loaded(), Message.PressedMessageMember({ userId: grace, name: "Grace Hopper" })).model
		const synced = pageUpdate(creating, Message.UpdatedDmChannels({ rows: dmWithGrace }))
		expect(synced.outMessage).toBeUndefined()
		expect(synced.model.dmRequest).toEqual(DmRequest.Creating({ userId: grace }))
	})

	test("without an organization, or for an unknown member, Message does nothing", () => {
		const noOrg = (current: Model, next: Message) => update(current, next, { ...shared, organization: null })
		story(noOrg, given(loaded()), message(Message.PressedMessageMember({ userId: grace, name: "Grace Hopper" })), Command.expectNone())
		story(pageUpdate, given(init().model), message(Message.PressedMessageMember({ userId: grace, name: "Grace Hopper" })), Command.expectNone())
	})

	test("clearing the search empties it and refocuses the field", () => {
		story(
			pageUpdate,
			given(loaded()),
			message(Message.ChangedSearch({ value: "grace" })),
			message(Message.PressedClearSearch()),
			Command.resolve(FocusSearch, Message.CompletedFocusSearch()),
			message(Message.ClearedSearch()),
			model((current) => expect(current.searchQuery).toBe("")),
		)
	})

	// dmRequest marks a DM as opening, so pressing Message again cannot create a second DM.
	test("a second Message press while a DM is opening sends nothing", () => {
		const first = pageUpdate(loaded(), Message.PressedMessageMember({ userId: grace, name: "Grace Hopper" }))
		const second = pageUpdate(first.model, Message.PressedMessageMember({ userId: grace, name: "Grace Hopper" }))
		expect(second.commands ?? []).toEqual([])
	})
})
