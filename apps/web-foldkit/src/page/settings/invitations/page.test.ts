// @vitest-environment jsdom
import { describe, expect, test } from "vitest"
import * as Menu from "../../../ui/menu"
import { Message } from "./message"
import { init, REVOKE_KEY, update } from "./update"

/** Update-loop tests for pending invitations: row menus and the revoke lifecycle. */

const invitation = { id: "inv_1", emailAddress: "ada@example.com", role: "org:member", createdAtMs: 0 }
const loaded = () =>
	update(init().model, Message.CompletedFetchInvitations({ version: 1, invitations: [invitation] })).model

describe("pending invitations", () => {
	test("every invitation gets a row menu with a revoke item", () => {
		const model = loaded()
		expect(model.menus).toHaveLength(1)
		expect(model.menus[0]?.menu.entries).toEqual([
			Menu.item(REVOKE_KEY, { intent: "Danger", isDisabled: false }),
		])
	})

	test("revoking disables the item, then refetches with a toast", () => {
		const revoking = { ...loaded(), revokingId: invitation.id }
		const done = update(revoking, Message.SucceededRevokeInvitation())
		expect(done.model.revokingId).toBeNull()
		expect(done.commands?.map((command) => command.name)).toEqual(["FetchInvitations"])
		expect(done.outMessage).toMatchObject({ toast: { title: "Invitation revoked successfully" } })
		const failed = update(revoking, Message.FailedRevokeInvitation())
		expect(failed.outMessage).toMatchObject({
			toast: { intent: "error", title: "Failed to revoke invitation" },
		})
	})

	test("invite buttons request the email invite modal", () => {
		expect(update(loaded(), Message.ClickedInviteUser()).outMessage).toMatchObject({
			_tag: "RequestedModal",
			modal: { _tag: "EmailInvite" },
		})
	})
})
