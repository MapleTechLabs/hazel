// @vitest-environment jsdom
import { ConnectInviteId, OrganizationId } from "@hazel/schema"
import { Schema } from "effect"
import * as Scene from "foldkit/scene"
import { describe, test } from "vitest"
import { reasonToast, successToast } from "../../../data/actions"
import { makeShared, organizationId, pageScene, uuid } from "../../../test/pages-fixtures"
import { PageOutMessage } from "../../out-message"
import { Message } from "./message"
import { type Invite, Invites } from "./model"
import { AcceptInvite, DeclineInvite, init, ListIncomingInvites, update } from "./update"
import { view } from "./view"

/** Connect invitations through the view: the list, host names, and the accept/decline buttons. */

const shared = makeShared()
const config = pageScene(update, view, shared)
const hostId = Schema.decodeSync(OrganizationId)(uuid(20))
const inviteId = Schema.decodeSync(ConnectInviteId)(uuid(21))
const acceptedId = Schema.decodeSync(ConnectInviteId)(uuid(22))
const pending: Invite = { id: inviteId, hostOrganizationId: hostId, status: "pending", createdAtMs: 0 }
const accepted: Invite = { id: acceptedId, hostOrganizationId: hostId, status: "accepted", createdAtMs: 0 }
const start = init(undefined, shared).model
const listed = (invites: ReadonlyArray<Invite>) => ({ ...start, invites: Invites.Success({ data: invites }) })
const listInvites = (version: number, invites: ReadonlyArray<Invite>) =>
	Scene.Command.resolve(
		ListIncomingInvites({ organizationId, version }),
		Message.SucceededListInvites({ organizationId, version, invites }),
	)

const accept = Scene.role("button", { name: "Accept" })
const decline = Scene.role("button", { name: "Decline" })

describe("list", () => {
	test("the empty state, then rows with the host name once the live query names it", () => {
		Scene.scene(
			config,
			Scene.given(listed([])),
			Scene.expect(Scene.role("heading", { name: "No connect invitations" })).toExist(),
		)
		Scene.scene(
			config,
			Scene.given(listed([accepted, pending])),
			Scene.expect(Scene.text("1 pending", { exact: false })).toExist(),
			Scene.expect(Scene.text(hostId)).toExist(),
			Scene.Subscription.emit(
				Message.UpdatedHostOrganizations({ organizations: [{ id: hostId, name: "Acme" }] }),
			),
			Scene.expect(Scene.text(hostId)).toBeAbsent(),
			Scene.expect(Scene.text("Acme")).toExist(),
			// Only the pending invite gets actions.
			Scene.expectAll(Scene.all.role("button", { name: "Accept" })).toHaveCount(1),
		)
	})
})

describe("loading", () => {
	test("the first load shows a loader; a failure shows the error and a retry, not the empty state", () => {
		Scene.scene(
			config,
			Scene.given(start),
			Scene.expect(Scene.text("Loading invitations...")).toExist(),
			Scene.expect(Scene.role("heading", { name: "No connect invitations" })).toBeAbsent(),
		)
		Scene.scene(
			config,
			Scene.given({ ...start, invites: Invites.Failure({ error: "Unavailable" }) }),
			Scene.expect(Scene.role("heading", { name: "Couldn't load connect invitations" })).toExist(),
			Scene.expect(Scene.role("heading", { name: "No connect invitations" })).toBeAbsent(),
			Scene.click(Scene.role("button", { name: "Try again" })),
			Scene.Command.expectExact(ListIncomingInvites({ organizationId, version: 2 })),
			listInvites(2, [pending]),
			Scene.expect(accept).toExist(),
		)
	})
})

describe("accept and decline", () => {
	test("Accept disables both buttons, toasts on success and refetches the list", () => {
		Scene.scene(
			config,
			Scene.given(listed([pending])),
			Scene.click(accept),
			Scene.Command.expectExact(AcceptInvite({ inviteId, guestOrganizationId: organizationId })),
			Scene.expect(Scene.role("button", { name: "Accepting..." })).toBeDisabled(),
			Scene.expect(decline).toBeDisabled(),
			Scene.Command.resolve(AcceptInvite, Message.SucceededAccept({ inviteId })),
			Scene.expectOutMessage(
				PageOutMessage.RequestedToast({ toast: successToast("Channel connected") }),
			),
			Scene.Command.expectExact(ListIncomingInvites({ organizationId, version: 2 })),
			listInvites(2, [{ ...pending, status: "accepted" }]),
			Scene.expect(accept).toBeAbsent(),
			Scene.expect(Scene.text("1 pending", { exact: false })).toBeAbsent(),
		)
	})

	test("a failed decline restores the buttons and shows the failure toast", () => {
		Scene.scene(
			config,
			Scene.given(listed([pending])),
			Scene.click(decline),
			Scene.Command.expectExact(DeclineInvite({ inviteId })),
			Scene.expect(Scene.role("button", { name: "Declining..." })).toBeDisabled(),
			Scene.Command.resolve(DeclineInvite, Message.FailedDecline({ inviteId, reason: "Unexpected" })),
			Scene.expectOutMessage(PageOutMessage.RequestedToast({ toast: reasonToast("Unexpected") })),
			Scene.expect(decline).toBeEnabled(),
			Scene.expect(accept).toBeEnabled(),
		)
	})
})
