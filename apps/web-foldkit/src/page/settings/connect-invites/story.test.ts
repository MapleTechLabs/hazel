// @vitest-environment jsdom
import { ConnectInviteId, OrganizationId } from "@hazel/schema"
import { Schema } from "effect"
import { Command, expectNoOutMessage, expectOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import { PageOutMessage } from "../../out-message"
import type { Shared } from "../../contract"
import { Message } from "./message"
import { Invites } from "./model"
import {
	AcceptInvite,
	DeclineInvite,
	init,
	invitesOf,
	ListIncomingInvites,
	sharedChanged,
	update,
} from "./update"
import { errorToast, reasonToast, successToast } from "../../../data/actions"
import { sharedDefaults } from "../../test-shared"

/** Update-loop tests for connect invitations: list requests and the accept/decline lifecycle. */

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const hazel = Schema.decodeSync(OrganizationId)(uuid(1))
const inviteId = Schema.decodeSync(ConnectInviteId)(uuid(2))
const shared = (organizationId: OrganizationId | null): Shared => ({
	auth: "SignedIn",
	orgSlug: "hazel",
	currentUser: null,
	organization:
		organizationId === null ? null : { id: organizationId, name: "Hazel", slug: "hazel", logoUrl: null },
	member: null,
	nowMs: 0,
	...sharedDefaults,
})

describe("connect invitations", () => {
	test("lists once the organization is known, once per organization", () => {
		const waiting = init(undefined, shared(null))
		expect(waiting.commands ?? []).toEqual([])
		const requested = sharedChanged(waiting.model, shared(hazel))
		expect(requested.commands?.[0]).toMatchObject({
			name: "ListIncomingInvites",
			args: { organizationId: hazel },
		})
		expect(sharedChanged(requested.model, shared(hazel)).commands ?? []).toEqual([])
	})

	test("accepting marks the row busy, then refetches and toasts", () => {
		const loaded = init(undefined, shared(hazel)).model
		const accepting = update(loaded, Message.ClickedAccept({ inviteId }), shared(hazel))
		expect(accepting.model.acceptingIds).toEqual([inviteId])
		expect(accepting.commands?.[0]).toMatchObject({
			name: "AcceptInvite",
			args: { inviteId, guestOrganizationId: hazel },
		})
		const accepted = update(accepting.model, Message.SucceededAccept({ inviteId }), shared(hazel))
		expect(accepted.model.acceptingIds).toEqual([])
		expect(accepted.commands?.map((command) => command.name)).toEqual(["ListIncomingInvites"])
		expect(accepted.outMessage).toMatchObject({ toast: { title: "Channel connected" } })
	})

	test("a failed decline keeps the list and reports the error", () => {
		const loaded = init(undefined, shared(hazel)).model
		const declining = update(loaded, Message.ClickedDecline({ inviteId }), shared(hazel)).model
		const toast = errorToast("Cannot decline", "This invite is no longer in a declinable state.")
		const failed = update(
			declining,
			Message.FailedDecline({ inviteId, reason: "InvalidState" }),
			shared(hazel),
		)
		expect(failed.model.decliningIds).toEqual([])
		expect(failed.commands ?? []).toEqual([])
		expect(failed.outMessage).toMatchObject({ toast })
	})
})

describe("accept failure", () => {
	test("Accept sends connectShare.invite.accept for this organization and toasts the failure", () => {
		const toast = errorToast("Cannot accept", "This invite is no longer in an acceptable state.")
		story(
			(current: Parameters<typeof update>[0], next: Message) => update(current, next, shared(hazel)),
			given(init(undefined, shared(hazel)).model),
			message(Message.ClickedAccept({ inviteId })),
			Command.expectExact(AcceptInvite({ inviteId, guestOrganizationId: hazel })),
			Command.resolve(AcceptInvite, Message.FailedAccept({ inviteId, reason: "InvalidState" })),
			expectOutMessage(PageOutMessage.RequestedToast({ toast })),
			model((current) => expect(current.acceptingIds).toEqual([])),
		)
	})
})

const run = (current: Parameters<typeof update>[0], next: Message) => update(current, next, shared(hazel))
const pending = { id: inviteId, hostOrganizationId: hazel, status: "pending", createdAtMs: 0 }
const listed = run(
	init(undefined, shared(hazel)).model,
	Message.SucceededListInvites({ organizationId: hazel, version: 1, invites: [pending] }),
).model

describe("list", () => {
	test("a failed first list is a Failure, not an empty list, and toasts nothing", () => {
		story(
			run,
			given(init(undefined, shared(hazel)).model),
			model((current) => expect(current.invites).toEqual(Invites.Loading())),
			message(Message.FailedListInvites({ organizationId: hazel, version: 1, reason: "Offline" })),
			expectNoOutMessage(),
			model((current) => expect(current.invites).toEqual(Invites.Failure({ error: "Offline" }))),
			message(Message.ClickedRetryListInvites()),
			Command.expectExact(ListIncomingInvites({ organizationId: hazel, version: 2 })),
			model((current) => expect(current.invites).toEqual(Invites.Loading())),
			Command.resolve(
				ListIncomingInvites,
				Message.SucceededListInvites({ organizationId: hazel, version: 2, invites: [pending] }),
			),
			model((current) => expect(current.invites).toEqual(Invites.Success({ data: [pending] }))),
		)
	})

	test("a failed refetch keeps the listed invites as Stale", () => {
		const refetching = { ...listed, listVersion: 2 }
		const failed = run(
			refetching,
			Message.FailedListInvites({ organizationId: hazel, version: 2, reason: "Timeout" }),
		)
		expect(failed.model.invites).toEqual(Invites.Stale({ error: "Timeout", data: [pending] }))
	})

	test("an older list or one for another organization is dropped", () => {
		const other = Schema.decodeSync(OrganizationId)(uuid(9))
		const refetching = { ...listed, listVersion: 2 }
		const stale = run(
			refetching,
			Message.SucceededListInvites({ organizationId: hazel, version: 1, invites: [] }),
		)
		expect(invitesOf(stale.model)).toEqual([pending])
		const foreign = run(
			refetching,
			Message.SucceededListInvites({ organizationId: other, version: 2, invites: [] }),
		)
		expect(invitesOf(foreign.model)).toEqual([pending])
		const staleFailure = run(
			refetching,
			Message.FailedListInvites({ organizationId: hazel, version: 1, reason: "Offline" }),
		)
		expect(staleFailure.model.invites).toEqual(Invites.Success({ data: [pending] }))
	})

	test("a new organization drops the old list and requests its own", () => {
		const other = Schema.decodeSync(OrganizationId)(uuid(9))
		const switched = sharedChanged(listed, shared(other))
		expect(switched.model.invites).toEqual(Invites.Loading())
		expect(switched.model.requestedFor).toBe(other)
		expect(switched.commands?.map((command) => command.name)).toEqual([ListIncomingInvites.name])
	})
})

describe("decline", () => {
	test("Decline disables the row, then toasts and refetches for this organization", () => {
		story(
			run,
			given(listed),
			message(Message.ClickedDecline({ inviteId })),
			Command.expectExact(DeclineInvite({ inviteId })),
			model((current) => expect(current.decliningIds).toEqual([inviteId])),
			Command.resolve(DeclineInvite, Message.SucceededDecline({ inviteId })),
			expectOutMessage(PageOutMessage.RequestedToast({ toast: successToast("Invite declined") })),
			Command.expectExact(ListIncomingInvites({ organizationId: hazel, version: 2 })),
			Command.resolve(
				ListIncomingInvites,
				Message.SucceededListInvites({ organizationId: hazel, version: 2, invites: [] }),
			),
			model((current) => {
				expect(current.decliningIds).toEqual([])
				expect(invitesOf(current)).toEqual([])
			}),
		)
	})

	test("a failed decline toasts and does not refetch", () => {
		story(
			run,
			given(listed),
			message(Message.ClickedDecline({ inviteId })),
			Command.resolve(DeclineInvite, Message.FailedDecline({ inviteId, reason: "Unexpected" })),
			expectOutMessage(PageOutMessage.RequestedToast({ toast: reasonToast("Unexpected") })),
			Command.expectNone(),
		)
	})
})

describe("double submit", () => {
	test("Accept without an organization sends nothing", () => {
		story(
			(current: Parameters<typeof update>[0], next: Message) => update(current, next, shared(null)),
			given(listed),
			message(Message.ClickedAccept({ inviteId })),
			Command.expectNone(),
			model((current) => expect(current.acceptingIds).toEqual([])),
		)
	})

	test("Accept or Decline on a row that is already accepting sends nothing", () => {
		story(
			run,
			given({ ...listed, acceptingIds: [inviteId] }),
			message(Message.ClickedAccept({ inviteId })),
			Command.expectNone(),
			message(Message.ClickedDecline({ inviteId })),
			Command.expectNone(),
		)
		story(
			run,
			given({ ...listed, decliningIds: [inviteId] }),
			message(Message.ClickedAccept({ inviteId })),
			Command.expectNone(),
		)
	})
})
