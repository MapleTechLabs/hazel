import "../document-stub"
import { ChannelId, ConnectInviteId, OrganizationId } from "@hazel/schema"
import { Schema } from "effect"
import { Command, expectOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import type { Shared } from "../../contract"
import { PageOutMessage } from "../../out-message"
import { ListOutgoingInvites, RevokeInvite } from "./command"
import { Message } from "./model"
import * as ShareModal from "./share-modal"
import { init, update } from "./update"

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const organizationId = Schema.decodeSync(OrganizationId)(uuid(1))
const channelId = Schema.decodeSync(ChannelId)(uuid(2))
const inviteId = Schema.decodeSync(ConnectInviteId)(uuid(3))
const shared: Shared = {
	auth: "SignedIn",
	orgSlug: "hazel",
	currentUser: null,
	organization: { id: organizationId, name: "Hazel", slug: "hazel", logoUrl: null },
	member: null,
	nowMs: 0,
}
const run = (current: Parameters<typeof update>[0], next: Message) => update(current, next, shared)
const initial = init({ _tag: "ChannelSettingsConnect", orgSlug: "hazel", channelId }, shared)
const invite = { id: inviteId, targetValue: "globex", status: "pending", createdAtMs: 0 }
const share = (shareMessage: ShareModal.Message) => Message.GotShareModalMessage({ message: shareMessage })

describe("channel connect", () => {
	test("lists the outgoing invites, then revoking refetches them", () => {
		expect(initial.commands?.map((command) => command.name)).toEqual(["ListOutgoingInvites"])
		story(
			run,
			given(initial.model),
			message(Message.SucceededListOutgoingInvites({ organizationId, invites: [invite] })),
			message(Message.ClickedRevokeInvite({ inviteId })),
			model((current) => expect(current.revokingInviteIds).toEqual([inviteId])),
			Command.resolve(RevokeInvite, Message.SucceededRevokeInvite({ inviteId })),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: { intent: "success", title: "Invite revoked", description: null },
				}),
			),
			Command.resolve(
				ListOutgoingInvites,
				Message.SucceededListOutgoingInvites({ organizationId, invites: [] }),
			),
			model((current) => expect(current.invites).toEqual([])),
		)
	})

	test("the workspace search only runs for the latest query", () => {
		const typed = [
			ShareModal.Message.ChangedWorkspaceQuery({ value: "gl" }),
			ShareModal.Message.ChangedWorkspaceQuery({ value: "glo" }),
		].reduce((current, next) => run(current, share(next)).model, initial.model)
		expect(typed.share.isSearching).toBe(true)
		const stale = run(typed, share(ShareModal.Message.ElapsedSearchDelay({ version: 1, query: "gl" })))
		expect(stale.commands ?? []).toHaveLength(0)
		const latest = run(typed, share(ShareModal.Message.ElapsedSearchDelay({ version: 2, query: "glo" })))
		expect(latest.commands?.map((command) => command.name)).toEqual(["SearchWorkspaces"])
	})
})
