// @vitest-environment jsdom
import { InvitationId } from "@hazel/schema"
import { Schema } from "effect"
import { Command, expectNoOutMessage, expectOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import { errorToast, successToast } from "../../../data/actions"
import { makeShared, storyUpdate, uuid } from "../../../test/pages-fixtures"
import * as Menu from "../../../ui/menu"
import { PageOutMessage } from "../../out-message"
import { Message } from "./message"
import type { Invitation } from "./model"
import {
	FetchInvitations,
	init,
	invitationsOf,
	REVOKE_KEY,
	RevokeInvitation,
	rowMenuEntries,
	sharedChanged,
	update,
} from "./update"

const inv1 = Schema.decodeSync(InvitationId)(uuid(11))
const inv2 = Schema.decodeSync(InvitationId)(uuid(12))

/** Pending invitations through update: fetch, the row menu revoke, and its result toasts. */

const run = storyUpdate(update, makeShared())
const ada: Invitation = { id: inv1, emailAddress: "ada@hazel.test", role: "member", createdAtMs: 0 }
const grace: Invitation = { id: inv2, emailAddress: "grace@hazel.test", role: "admin", createdAtMs: 0 }
const loaded = update(
	init(undefined, makeShared()).model,
	Message.SucceededFetchInvitations({ version: 1, invitations: [ada, grace] }),
).model

const rowMenu = (invitationId: InvitationId, child: Menu.Message) =>
	Message.GotRowMenuMessage({ invitationId, message: child })
const openMenu = (invitationId: InvitationId) =>
	message(rowMenu(invitationId, Menu.Message.PressedTrigger({ pointerType: "mouse" })))
const pickRevoke = (invitationId: InvitationId) =>
	message(
		rowMenu(invitationId, Menu.Message.ClickedItem({ key: REVOKE_KEY, entries: rowMenuEntries(false) })),
	)
const revokeDisabled = (invitationId: InvitationId) =>
	model<typeof loaded>((current) => {
		expect(current.revokingId).toBe(invitationId)
		expect(rowMenuEntries(current.revokingId === invitationId)).toEqual([
			Menu.item(REVOKE_KEY, { intent: "Danger", isDisabled: true }),
		])
	})

describe("fetch", () => {
	test("an older fetch result is dropped once a newer fetch is out", () => {
		const refetching = { ...loaded, fetchVersion: 2 }
		const stale = update(refetching, Message.SucceededFetchInvitations({ version: 1, invitations: [] }))
		expect(invitationsOf(stale.model)).toEqual([ada, grace])
		const fresh = update(
			refetching,
			Message.SucceededFetchInvitations({ version: 2, invitations: [grace] }),
		)
		expect(invitationsOf(fresh.model)).toEqual([grace])
	})

	test("init fetches the pending invitations, and the result builds one closed menu per row", () => {
		story(
			run,
			given(init(undefined, makeShared()).model),
			message(Message.ClickedInviteUser()),
			expectOutMessage(PageOutMessage.RequestedModal({ modal: { _tag: "EmailInvite" } })),
			message(Message.SucceededFetchInvitations({ version: 1, invitations: [ada, grace] })),
			model((current) => {
				expect(current.menus.map((row) => row.invitationId)).toEqual([inv1, inv2])
				expect(current.menus.every((row) => row.menu.popup._tag === "Closed")).toBe(true)
			}),
		)
		expect(init(undefined, makeShared()).commands?.map((command) => command.name)).toEqual([
			FetchInvitations.name,
		])
	})

	test("a refetch keeps the open menu of a row that stays and drops rows that left", () => {
		story(
			run,
			given(loaded),
			openMenu(inv2),
			message(Message.SucceededFetchInvitations({ version: 1, invitations: [grace] })),
			model((current) => {
				expect(current.menus).toHaveLength(1)
				expect(current.menus[0]?.menu.popup._tag).toBe("Open")
			}),
		)
	})

	test("a menu message for an unknown row is ignored", () => {
		story(
			run,
			given(loaded),
			openMenu(Schema.decodeSync(InvitationId)(uuid(99))),
			model((current) => expect(current).toEqual(loaded)),
			expectNoOutMessage(),
		)
	})
})

describe("revoke", () => {
	test("choosing Revoke dispatches the revoke for that row and disables its item", () => {
		story(
			run,
			given(loaded),
			openMenu(inv1),
			pickRevoke(inv1),
			Command.expectExact(RevokeInvitation({ invitationId: inv1 })),
			model((current) => expect(current.revokingId).toBe(inv1)),
			revokeDisabled(inv1),
			Command.resolve(RevokeInvitation, Message.SucceededRevokeInvitation()),
			expectOutMessage(
				PageOutMessage.RequestedToast({ toast: successToast("Invitation revoked successfully") }),
			),
			model((current) => expect(current.revokingId).toBeNull()),
			Command.resolve(
				FetchInvitations,
				Message.SucceededFetchInvitations({ version: 2, invitations: [grace] }),
			),
			model((current) => expect(invitationsOf(current)).toEqual([grace])),
		)
	})

	test("a failed revoke clears the busy row, toasts the error and refetches", () => {
		story(
			run,
			given(loaded),
			openMenu(inv1),
			pickRevoke(inv1),
			Command.resolve(RevokeInvitation, Message.FailedRevokeInvitation({ reason: "Unexpected" })),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: errorToast("Something went wrong", "Please try again."),
				}),
			),
			model((current) => {
				expect(current.revokingId).toBeNull()
				expect(rowMenuEntries(current.revokingId !== null)).toEqual([
					Menu.item(REVOKE_KEY, { intent: "Danger", isDisabled: false }),
				])
			}),
			Command.resolve(
				FetchInvitations,
				Message.SucceededFetchInvitations({ version: 2, invitations: [ada, grace] }),
			),
		)
	})

	test("a second revoke while one is in flight sends nothing", () => {
		story(
			run,
			given({ ...loaded, revokingId: inv1 }),
			openMenu(inv2),
			pickRevoke(inv2),
			Command.expectNone(),
			model((current) => {
				expect(current.revokingId).toBe(inv1)
				expect(current.menus[1]?.menu.popup._tag).toBe("Closed")
			}),
		)
	})
})

describe("organization arriving after the page", () => {
	test("a direct load fetches once the organization synced, and only once", () => {
		const waiting = init(undefined, makeShared({ organization: null }))
		expect(waiting.commands ?? []).toEqual([])
		const fetched = sharedChanged(waiting.model, makeShared())
		expect(fetched.commands?.[0]).toMatchObject({ name: "FetchInvitations" })
		expect(sharedChanged(fetched.model, makeShared()).commands ?? []).toEqual([])
	})
})
