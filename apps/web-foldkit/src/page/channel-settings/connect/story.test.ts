import "../document-stub"
import { ChannelId, ConnectInviteId, OrganizationId } from "@hazel/schema"
import { Schema } from "effect"
import { Command, expectOutMessage, given, message, model, story } from "foldkit/story"
import { describe, expect, test } from "vitest"
import type { Shared } from "../../contract"
import { PageOutMessage } from "../../out-message"
import {
	globex,
	globexGuestMount,
	hostMount,
	initechId,
	mountOf,
	slugless,
} from "../../../test/pages-channel-settings-fixtures"
import { DisconnectOrganization, ListOutgoingInvites, RevokeInvite } from "./command"
import { Message } from "./model"
import * as ShareModal from "./share-modal"
import { init, sharedChanged, update } from "./update"
import { sharedDefaults } from "../../test-shared"

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
	...sharedDefaults,
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

describe("revoke failure", () => {
	test("Revoke sends connectShare.invite.revoke for the invite and toasts the failure", () => {
		const description = "This invite may have already been revoked or expired."
		story(
			run,
			given(initial.model),
			message(Message.SucceededListOutgoingInvites({ organizationId, invites: [invite] })),
			message(Message.ClickedRevokeInvite({ inviteId })),
			Command.expectExact(RevokeInvite({ inviteId })),
			Command.resolve(
				RevokeInvite,
				Message.FailedRevokeInvite({ inviteId, title: "Invite not found", description }),
			),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: { intent: "error", title: "Invite not found", description },
				}),
			),
			model((current) => expect(current.revokingInviteIds).toEqual([])),
		)
	})
})

const connected = run(initial.model, Message.UpdatedMounts({ mounts: [hostMount, globexGuestMount] })).model

describe("disconnect", () => {
	test("the host disconnects a guest workspace and toasts", () => {
		story(
			run,
			given(connected),
			message(Message.ClickedDisconnect({ mountId: globexGuestMount.id })),
			Command.expectExact(
				DisconnectOrganization({
					mountId: globexGuestMount.id,
					conversationId: globexGuestMount.conversationId,
					organizationId: globexGuestMount.organizationId,
					isLeaving: false,
				}),
			),
			model((current) => expect(current.disconnectingMountIds).toEqual([globexGuestMount.id])),
			Command.resolve(
				DisconnectOrganization,
				Message.SucceededDisconnect({
					mountId: globexGuestMount.id,
					successMessage: "Organization disconnected",
				}),
			),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: { intent: "success", title: "Organization disconnected", description: null },
				}),
			),
			model((current) => expect(current.disconnectingMountIds).toEqual([])),
		)
	})

	test("a guest leaving targets its own organization", () => {
		const asGuest = run(
			initial.model,
			Message.UpdatedMounts({
				mounts: [
					{ ...hostMount, organizationId: globex.id },
					{ ...globexGuestMount, organizationId },
				],
			}),
		).model
		story(
			run,
			given(asGuest),
			message(Message.ClickedDisconnect({ mountId: hostMount.id })),
			Command.expectExact(
				DisconnectOrganization({
					mountId: hostMount.id,
					conversationId: hostMount.conversationId,
					organizationId,
					isLeaving: true,
				}),
			),
			Command.resolve(
				DisconnectOrganization,
				Message.FailedDisconnect({
					mountId: hostMount.id,
					title: "Something went wrong",
					description: null,
				}),
			),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: { intent: "error", title: "Something went wrong", description: null },
				}),
			),
			model((current) => expect(current.disconnectingMountIds).toEqual([])),
		)
	})

	test("a guest cannot disconnect another guest, even without the hidden button", () => {
		const otherGuest = mountOf(3, initechId, "guest")
		const asGuest = run(
			initial.model,
			Message.UpdatedMounts({ mounts: [mountOf(1, organizationId, "guest"), otherGuest] }),
		).model
		story(
			run,
			given(asGuest),
			message(Message.ClickedDisconnect({ mountId: otherGuest.id })),
			Command.expectNone(),
		)
	})

	test("a second click while disconnecting, or an unknown mount, sends nothing", () => {
		const disconnecting = run(
			connected,
			Message.ClickedDisconnect({ mountId: globexGuestMount.id }),
		).model
		story(
			run,
			given(disconnecting),
			message(Message.ClickedDisconnect({ mountId: globexGuestMount.id })),
			Command.expectNone(),
			message(Message.ClickedDisconnect({ mountId: "missing" })),
			Command.expectNone(),
		)
	})
})

describe("invites list", () => {
	test("a second revoke click while revoking sends nothing", () => {
		const revoking = run(initial.model, Message.ClickedRevokeInvite({ inviteId })).model
		story(run, given(revoking), message(Message.ClickedRevokeInvite({ inviteId })), Command.expectNone())
	})

	test("a response for another organization is ignored", () => {
		const otherOrg = globex.id
		story(
			run,
			given(initial.model),
			message(Message.SucceededListOutgoingInvites({ organizationId: otherOrg, invites: [invite] })),
			model((current) => expect(current.invites).toEqual([])),
		)
	})

	test("switching organization refetches; the same organization does not", () => {
		expect(sharedChanged(initial.model, shared).commands).toBeUndefined()
		const switched = sharedChanged(initial.model, {
			...shared,
			organization: { id: globex.id, name: "Globex", slug: "globex", logoUrl: null },
		})
		expect(switched.commands).toMatchObject([
			{ name: "ListOutgoingInvites", args: { organizationId: globex.id, channelId } },
		])
	})
})

describe("share modal", () => {
	const opened = run(initial.model, Message.ClickedShareChannel()).model
	const picked = run(opened, share(ShareModal.Message.ClickedWorkspace({ workspace: globex }))).model

	test("sending an invite creates it, closes, toasts, and refetches the invites", () => {
		story(
			run,
			given(picked),
			message(share(ShareModal.Message.ToggledAllowGuestMemberAdds({ isSelected: true }))),
			message(share(ShareModal.Message.ClickedSendInvite())),
			Command.expectExact(
				ShareModal.CreateInvite({
					channelId,
					guestOrganizationId: globex.id,
					slug: "globex",
					allowGuestMemberAdds: true,
				}),
			),
			Command.resolve(ShareModal.CreateInvite, ShareModal.Message.SucceededCreateInvite()),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: { intent: "success", title: "Invite sent", description: null },
				}),
			),
			model((current) => {
				expect(current.share.modal.isOpen).toBe(false)
				expect(current.share.selectedWorkspace).toBeNull()
			}),
			Command.resolve(
				ListOutgoingInvites,
				Message.SucceededListOutgoingInvites({ organizationId, invites: [invite] }),
			),
			model((current) => expect(current.invites).toEqual([invite])),
		)
	})

	test("a failed invite keeps the selection and re-enables sending", () => {
		story(
			run,
			given(picked),
			message(share(ShareModal.Message.ClickedSendInvite())),
			Command.resolve(
				ShareModal.CreateInvite,
				ShareModal.Message.FailedCreateInvite({ title: "Already shared", description: "Shared." }),
			),
			expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: { intent: "error", title: "Already shared", description: "Shared." },
				}),
			),
			model((current) => {
				expect(current.share.isSubmitting).toBe(false)
				expect(current.share.selectedWorkspace).toEqual(globex)
				expect(current.share.modal.isOpen).toBe(true)
			}),
		)
	})

	test("a second send while sending, or a send with no selection, does nothing", () => {
		const sending = run(picked, share(ShareModal.Message.ClickedSendInvite())).model
		story(
			run,
			given(sending),
			message(share(ShareModal.Message.ClickedSendInvite())),
			Command.expectNone(),
		)
		story(
			run,
			given(opened),
			message(share(ShareModal.Message.ClickedSendInvite())),
			Command.expectNone(),
		)
	})

	test("a workspace without a slug cannot be selected", () => {
		story(
			run,
			given(opened),
			message(share(ShareModal.Message.ClickedWorkspace({ workspace: slugless }))),
			model((current) => expect(current.share.selectedWorkspace).toBeNull()),
		)
	})

	test("a one-character query clears results without searching", () => {
		story(
			run,
			given(opened),
			message(share(ShareModal.Message.ChangedWorkspaceQuery({ value: "g" }))),
			Command.expectNone(),
			model((current) => expect(current.share.isSearching).toBe(false)),
		)
	})

	test("a stale search result is dropped and the latest one shows", () => {
		story(
			run,
			given(opened),
			message(share(ShareModal.Message.ChangedWorkspaceQuery({ value: "glo" }))),
			Command.resolve(
				ShareModal.WaitForSearchDelay,
				ShareModal.Message.ElapsedSearchDelay({ version: 1, query: "glo" }),
			),
			Command.expectExact(ShareModal.SearchWorkspaces({ version: 1, query: "glo", organizationId })),
			Command.resolve(
				ShareModal.SearchWorkspaces,
				ShareModal.Message.SucceededSearchWorkspaces({ version: 1, results: [globex] }),
			),
			model((current) => {
				expect(current.share.searchResults).toEqual([globex])
				expect(current.share.isSearching).toBe(false)
			}),
			message(share(ShareModal.Message.SucceededSearchWorkspaces({ version: 0, results: [] }))),
			model((current) => expect(current.share.searchResults).toEqual([globex])),
		)
	})

	test("closing the modal resets the draft", () => {
		story(
			run,
			given(picked),
			message(share(ShareModal.Message.ClickedCancel())),
			model((current) => expect(current.share).toEqual(ShareModal.init())),
		)
	})
})
