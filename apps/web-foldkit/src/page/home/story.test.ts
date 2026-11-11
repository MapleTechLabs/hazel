import { routeOfPath } from "../../route"
import { ChannelId, OrganizationId, UserId } from "@hazel/schema"
import { Option, Schema } from "effect"
import { Command, expectNoOutMessage, expectOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test, vi } from "vitest"
import * as Menu from "../../ui/menu"
import type { Shared } from "../contract"
import { PageOutMessage } from "../out-message"
import { CopyEmail, FocusSearch } from "./commands"
import { Message } from "./message"
import { type DirectoryMember, DmRequest, type DmRow, filterMembers, type Model } from "./model"
import { init, update } from "./update"
import { sharedDefaults } from "../test-shared"
import { menuEntries } from "./model"

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
const createDmWithGrace = PageOutMessage.RequestedDmCreation({
	organizationId,
	orgSlug: "hazel",
	userId: grace,
	name: "Grace Hopper",
})
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
			message(
				menuMessage(grace, Menu.Message.ClickedItem({ key: "copy-email", entries: menuEntries })),
			),
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
				PageOutMessage.RequestedNavigation({
					route: routeOfPath(`/hazel/chat/${channelId}`),
					replace: false,
				}),
			),
			model((current) => expect(current.dmRequest).toEqual(DmRequest.Idle())),
		)
	})

	test("Message without an existing DM asks the root to create one", () => {
		story(
			pageUpdate,
			given(loaded()),
			message(Message.PressedMessageMember({ userId: grace, name: "Grace Hopper" })),
			Command.expectNone(),
			expectOutMessage(createDmWithGrace),
			model((current) => expect(current.dmRequest).toEqual(DmRequest.Idle())),
		)
	})
})

describe("org home failures and guards", () => {
	test("a failed copy toasts an error", () => {
		story(
			pageUpdate,
			given(withOpenMenu(grace)),
			message(
				menuMessage(grace, Menu.Message.ClickedItem({ key: "copy-email", entries: menuEntries })),
			),
			Command.resolve(CopyEmail({ email: "grace@hazel.test" }), Message.FailedCopyEmail()),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: {
						intent: "error",
						title: "Failed to copy email",
						description: "Please try again",
					},
				}),
			),
		)
	})

	test("the menu's Message item creates the DM with the member's full name", () => {
		story(
			pageUpdate,
			given(withOpenMenu(grace)),
			message(menuMessage(grace, Menu.Message.ClickedItem({ key: "message", entries: menuEntries }))),
			expectOutMessage(createDmWithGrace),
		)
	})

	test("a press before the DM rows load waits for them, then opens the DM", () => {
		story(
			pageUpdate,
			given(membersOnly()),
			message(Message.PressedMessageMember({ userId: grace, name: "Grace Hopper" })),
			Command.expectNone(),
			expectNoOutMessage(),
			model((current) =>
				expect(current.dmRequest).toEqual(DmRequest.AwaitingChannels({ userId: grace })),
			),
			message(Message.UpdatedDmChannels({ rows: dmWithGrace })),
			expectOutMessage(
				PageOutMessage.RequestedNavigation({
					route: routeOfPath(`/hazel/chat/${channelId}`),
					replace: false,
				}),
			),
			model((current) => expect(current.dmRequest).toEqual(DmRequest.Idle())),
		)
	})

	test("without an organization, or for an unknown member, Message does nothing", () => {
		const noOrg = (current: Model, next: Message) =>
			update(current, next, { ...shared, organization: null })
		story(
			noOrg,
			given(loaded()),
			message(Message.PressedMessageMember({ userId: grace, name: "Grace Hopper" })),
			Command.expectNone(),
		)
		story(
			pageUpdate,
			given(init().model),
			message(Message.PressedMessageMember({ userId: grace, name: "Grace Hopper" })),
			Command.expectNone(),
		)
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
	// The root ignores a repeat of a request in flight (`app/out-messages.story.test.ts`); the page
	// only guards the wait for the DM rows.
	test("a second press while waiting for the DM rows is ignored", () => {
		const first = pageUpdate(
			membersOnly(),
			Message.PressedMessageMember({ userId: grace, name: "Grace Hopper" }),
		)
		const second = pageUpdate(
			first.model,
			Message.PressedMessageMember({ userId: grace, name: "Grace Hopper" }),
		)
		expect(second.outMessage).toBeUndefined()
		expect(second.model.dmRequest).toEqual(DmRequest.AwaitingChannels({ userId: grace }))
	})
})
