import { ConnectInviteId, OrganizationId } from "@hazel/schema"
import { Schema } from "effect"
import { describe, expect, test } from "vitest"
import type { Shared } from "../../contract"
import { Message } from "./message"
import { init, sharedChanged, update } from "./update"
import { sharedDefaults } from "../../test-shared"

/** Update-loop tests for connect invitations: list requests and the accept/decline lifecycle. */

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const hazel = Schema.decodeSync(OrganizationId)(uuid(1))
const inviteId = Schema.decodeSync(ConnectInviteId)(uuid(2))
const shared = (organizationId: OrganizationId | null): Shared => ({
	auth: "SignedIn",
	orgSlug: "hazel",
	currentUser: null,
	organization: organizationId === null ? null : { id: organizationId, name: "Hazel", slug: "hazel", logoUrl: null },
	member: null,
	nowMs: 0,
	...sharedDefaults,
})

describe("connect invitations", () => {
	test("lists once the organization is known, once per organization", () => {
		const waiting = init(undefined, shared(null))
		expect(waiting.commands ?? []).toEqual([])
		const requested = sharedChanged(waiting.model, shared(hazel))
		expect(requested.commands?.[0]).toMatchObject({ name: "ListIncomingInvites", args: { organizationId: hazel } })
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
		const toast = { intent: "error" as const, title: "Cannot decline", description: null }
		const failed = update(declining, Message.FailedDecline({ inviteId, toast }), shared(hazel))
		expect(failed.model.decliningIds).toEqual([])
		expect(failed.commands ?? []).toEqual([])
		expect(failed.outMessage).toMatchObject({ toast })
	})
})
