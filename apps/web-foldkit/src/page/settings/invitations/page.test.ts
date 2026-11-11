// @vitest-environment jsdom
import { InvitationId } from "@hazel/schema"
import { Schema } from "effect"
import { describe, expect, test } from "vitest"
import * as Menu from "../../../ui/menu"
import { makeShared, uuid } from "../../../test/pages-fixtures"
import { Message } from "./message"
import type { Invitation } from "./model"
import { init, REVOKE_KEY, update } from "./update"
import { rowMenuEntries } from "./update"

const inv1 = Schema.decodeSync(InvitationId)(uuid(11))

/** Update-loop tests for pending invitations: row menus and the revoke lifecycle. */

const invitation: Invitation = { id: inv1, emailAddress: "ada@example.com", role: "member", createdAtMs: 0 }
const loaded = () =>
	update(
		init(undefined, makeShared()).model,
		Message.SucceededFetchInvitations({ version: 1, invitations: [invitation] }),
	).model

describe("pending invitations", () => {
	test("every invitation gets a row menu with a revoke item", () => {
		const model = loaded()
		expect(model.menus).toHaveLength(1)
		expect(rowMenuEntries(model.revokingId === invitation.id)).toEqual([
			Menu.item(REVOKE_KEY, { intent: "Danger", isDisabled: false }),
		])
	})

	test("revoking disables the item, then refetches with a toast", () => {
		const revoking = { ...loaded(), revokingId: invitation.id }
		const done = update(revoking, Message.SucceededRevokeInvitation())
		expect(done.model.revokingId).toBeNull()
		expect(done.commands?.map((command) => command.name)).toEqual(["FetchInvitations"])
		expect(done.outMessage).toMatchObject({ toast: { title: "Invitation revoked successfully" } })
		const failed = update(revoking, Message.FailedRevokeInvitation({ reason: "Unexpected" }))
		expect(failed.outMessage).toMatchObject({
			toast: { intent: "error", title: "Something went wrong" },
		})
	})

	test("invite buttons request the email invite modal", () => {
		expect(update(loaded(), Message.ClickedInviteUser()).outMessage).toMatchObject({
			_tag: "RequestedModal",
			modal: { _tag: "EmailInvite" },
		})
	})
})
