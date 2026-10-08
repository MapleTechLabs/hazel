// @vitest-environment jsdom
import { Command, expectNoOutMessage, expectOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import { errorToast, successToast } from "../../../data/actions"
import { makeShared, storyUpdate } from "../../../test/pages-fixtures"
import * as Menu from "../../../ui/menu"
import { PageOutMessage } from "../../out-message"
import { Message } from "./message"
import type { Invitation } from "./model"
import { FetchInvitations, init, REVOKE_KEY, RevokeInvitation, update } from "./update"

/** Pending invitations through update: fetch, the row menu revoke, and its result toasts. */

const run = storyUpdate(update, makeShared())
const ada: Invitation = { id: "inv_1", emailAddress: "ada@hazel.test", role: "org:member", createdAtMs: 0 }
const grace: Invitation = { id: "inv_2", emailAddress: "grace@hazel.test", role: "org:admin", createdAtMs: 0 }
const loaded = update(init().model, Message.CompletedFetchInvitations({ invitations: [ada, grace] })).model

const rowMenu = (invitationId: string, child: Menu.Message) => Message.GotRowMenuMessage({ invitationId, message: child })
const openMenu = (invitationId: string) => message(rowMenu(invitationId, Menu.Message.PressedTrigger({ pointerType: "mouse" })))
const pickRevoke = (invitationId: string) => message(rowMenu(invitationId, Menu.Message.ClickedItem({ key: REVOKE_KEY })))
const revokeDisabled = (invitationId: string) =>
	model<typeof loaded>((current) => {
		const row = current.menus.find((candidate) => candidate.invitationId === invitationId)
		expect(row?.menu.entries).toEqual([Menu.item(REVOKE_KEY, { intent: "Danger", isDisabled: true })])
	})

describe("fetch", () => {
	test("init fetches the pending invitations, and the result builds one closed menu per row", () => {
		story(
			run,
			given(init().model),
			message(Message.ClickedInviteUser()),
			expectOutMessage(PageOutMessage.RequestedModal({ modal: { _tag: "EmailInvite" } })),
			message(Message.CompletedFetchInvitations({ invitations: [ada, grace] })),
			model((current) => {
				expect(current.menus.map((row) => row.invitationId)).toEqual(["inv_1", "inv_2"])
				expect(current.menus.every((row) => row.menu.popup._tag === "Closed")).toBe(true)
			}),
		)
		expect(init().commands?.map((command) => command.name)).toEqual([FetchInvitations.name])
	})

	test("a refetch keeps the open menu of a row that stays and drops rows that left", () => {
		story(
			run,
			given(loaded),
			openMenu("inv_2"),
			message(Message.CompletedFetchInvitations({ invitations: [grace] })),
			model((current) => {
				expect(current.menus).toHaveLength(1)
				expect(current.menus[0]?.menu.popup._tag).toBe("Open")
			}),
		)
	})

	test("a menu message for an unknown row is ignored", () => {
		story(run, given(loaded), openMenu("inv_missing"), model((current) => expect(current).toEqual(loaded)), expectNoOutMessage())
	})
})

describe("revoke", () => {
	test("choosing Revoke dispatches the revoke for that row and disables its item", () => {
		story(
			run,
			given(loaded),
			openMenu("inv_1"),
			pickRevoke("inv_1"),
			Command.expectExact(RevokeInvitation({ invitationId: "inv_1" })),
			model((current) => expect(current.revokingId).toBe("inv_1")),
			revokeDisabled("inv_1"),
			Command.resolve(RevokeInvitation, Message.SucceededRevoke()),
			expectOutMessage(PageOutMessage.RequestedToast({ toast: successToast("Invitation revoked successfully") })),
			model((current) => expect(current.revokingId).toBeNull()),
			Command.resolve(FetchInvitations, Message.CompletedFetchInvitations({ invitations: [grace] })),
			model((current) => expect(current.invitations).toEqual([grace])),
		)
	})

	test("a failed revoke clears the busy row, toasts the error and refetches", () => {
		story(
			run,
			given(loaded),
			openMenu("inv_1"),
			pickRevoke("inv_1"),
			Command.resolve(RevokeInvitation, Message.FailedRevoke()),
			expectOutMessage(PageOutMessage.RequestedToast({ toast: errorToast("Failed to revoke invitation") })),
			model((current) => {
				expect(current.revokingId).toBeNull()
				expect(current.menus[0]?.menu.entries).toEqual([Menu.item(REVOKE_KEY, { intent: "Danger", isDisabled: false })])
			}),
			Command.resolve(FetchInvitations, Message.CompletedFetchInvitations({ invitations: [ada, grace] })),
		)
	})

	test("a second revoke while one is in flight sends nothing", () => {
		story(
			run,
			given({ ...loaded, revokingId: "inv_1" }),
			openMenu("inv_2"),
			pickRevoke("inv_2"),
			Command.expectNone(),
			model((current) => {
				expect(current.revokingId).toBe("inv_1")
				expect(current.menus[1]?.menu.popup._tag).toBe("Closed")
			}),
		)
	})
})
