import { ChannelId, OrganizationId, UserId } from "@hazel/schema"
import { Option, Schema } from "effect"
import { Command, expectOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test, vi } from "vitest"
import * as Menu from "../../ui/menu"
import type { Shared } from "../contract"
import { PageOutMessage } from "../out-message"
import { CopyEmail, CreateDm, FindDm } from "./commands"
import { Message } from "./message"
import { type DirectoryMember, filterMembers, type Model } from "./model"
import { init, update } from "./update"

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
const loaded = (): Model => update(init().model, Message.UpdatedMembers({ members }), shared).model
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
			given(loaded()),
			message(Message.PressedMessageMember({ userId: grace, name: "Grace Hopper" })),
			Command.resolve(FindDm, Message.FoundExistingDm({ channelId })),
			expectOutMessage(
				PageOutMessage.RequestedNavigation({ href: `/hazel/chat/${channelId}`, replace: false }),
			),
		)
	})

	test("Message creates a DM with a loading toast, then a success toast and navigation", () => {
		story(
			pageUpdate,
			given(loaded()),
			message(Message.PressedMessageMember({ userId: grace, name: "Grace Hopper" })),
			Command.resolve(FindDm, Message.FoundNoDm({ userId: grace, name: "Grace Hopper" })),
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
