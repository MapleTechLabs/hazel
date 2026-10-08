// @vitest-environment jsdom
import * as Scene from "foldkit/scene"
import { describe, test } from "vitest"
import { successToast } from "../../../data/actions"
import {
	globex,
	globexGuestMount,
	initechId as initechGuest,
	hostMount,
	inviteId,
	mountOf,
	pendingInvite,
} from "../../../test/pages-channel-settings-fixtures"
import {
	channelId,
	failureToastFixture,
	makeShared,
	organizationId,
	pageScene,
	portalModalMounted,
} from "../../../test/pages-fixtures"
import * as Modal from "../../../ui/modal"
import { PageOutMessage } from "../../out-message"
import { DisconnectOrganization, ListOutgoingInvites, RevokeInvite } from "./command"
import { Message } from "./model"
import * as ShareModal from "./share-modal"
import { init, update } from "./update"
import { view } from "./view"

/** The Hazel Connect tab through its view: sharing, invitations and connections. */

const shared = makeShared()
const initial = init({ _tag: "ChannelSettingsConnect", orgSlug: "hazel", channelId }, shared).model
const config = pageScene(update, view, shared)
const dialog = Scene.role("dialog")
const workspaceInput = Scene.label("Workspace")
const sendInvite = Scene.within(dialog, Scene.role("button", { name: "Send invite" }))
const orgs = Message.UpdatedOrgs({ orgs: { [globex.id]: { name: "Globex", slug: "globex", logoUrl: null } } })

describe("share channel", () => {
	test("search, pick a workspace, send the invite, and see it listed", () => {
		Scene.scene(
			config,
			Scene.given(initial),
			Scene.expect(Scene.text("Not shared yet")).toExist(),
			Scene.Subscription.emit(Message.UpdatedChannelName({ name: "general" })),
			Scene.click(Scene.role("button", { name: /Share channel/ })),
			portalModalMounted,
			Scene.expect(Scene.role("heading", { name: "Share #general" })).toExist(),
			Scene.expect(sendInvite).toBeDisabled(),
			Scene.type(workspaceInput, "glo"),
			Scene.Command.resolve(
				ShareModal.WaitForSearchDelay,
				ShareModal.Message.ElapsedSearchDelay({ version: 1, query: "glo" }),
			),
			Scene.Command.expectExact(
				ShareModal.SearchWorkspaces({ version: 1, query: "glo", organizationId }),
			),
			Scene.Command.resolve(
				ShareModal.SearchWorkspaces,
				ShareModal.Message.SucceededSearchWorkspaces({ version: 1, results: [globex] }),
			),
			Scene.click(Scene.within(dialog, Scene.text("Globex"))),
			Scene.expect(workspaceInput).toHaveValue("Globex"),
			Scene.click(sendInvite),
			Scene.Command.expectExact(
				ShareModal.CreateInvite({
					channelId,
					guestOrganizationId: globex.id,
					slug: "globex",
					allowGuestMemberAdds: false,
				}),
			),
			Scene.expect(Scene.within(dialog, Scene.role("button", { name: "Sending..." }))).toBeDisabled(),
			Scene.Command.resolve(ShareModal.CreateInvite, ShareModal.Message.SucceededCreateInvite()),
			Scene.expectOutMessage(PageOutMessage.RequestedToast({ toast: successToast("Invite sent") })),
			Scene.expect(dialog).toBeAbsent(),
			Scene.Mount.expectEnded(Modal.PortalModal),
			Scene.Command.resolve(
				ListOutgoingInvites,
				Message.SucceededListOutgoingInvites({ organizationId, invites: [pendingInvite] }),
			),
			Scene.expect(Scene.within(Scene.role("table"), Scene.text("globex"))).toExist(),
			Scene.expect(Scene.role("button", { name: "Revoke" })).toBeEnabled(),
			Scene.expect(Scene.text("Not shared yet")).toBeAbsent(),
		)
	})

	test("no matches shows the empty result, and Cancel closes the dialog", () => {
		Scene.scene(
			config,
			Scene.given(initial),
			Scene.Subscription.emit(Message.UpdatedChannelName({ name: "general" })),
			Scene.click(Scene.role("button", { name: /Share this channel/ })),
			portalModalMounted,
			Scene.type(workspaceInput, "zz"),
			Scene.Command.resolve(
				ShareModal.WaitForSearchDelay,
				ShareModal.Message.ElapsedSearchDelay({ version: 1, query: "zz" }),
			),
			Scene.Command.resolve(
				ShareModal.SearchWorkspaces,
				ShareModal.Message.FailedSearchWorkspaces({ version: 1 }),
			),
			Scene.expect(Scene.text("No public workspaces found")).toExist(),
			Scene.click(Scene.within(dialog, Scene.role("button", { name: "Cancel" }))),
			Scene.expect(dialog).toBeAbsent(),
			Scene.Mount.expectEnded(Modal.PortalModal),
		)
	})
})

describe("invitations", () => {
	test("Revoke disables while running and re-enables after a failure", () => {
		Scene.scene(
			config,
			Scene.given(initial),
			Scene.Subscription.emit(
				Message.SucceededListOutgoingInvites({ organizationId, invites: [pendingInvite] }),
			),
			Scene.click(Scene.role("button", { name: "Revoke" })),
			Scene.Command.expectExact(RevokeInvite({ inviteId })),
			Scene.expect(Scene.role("button", { name: "Revoking..." })).toBeDisabled(),
			Scene.Command.resolve(
				RevokeInvite,
				Message.FailedRevokeInvite({
					inviteId,
					title: failureToastFixture.title,
					description: failureToastFixture.description,
				}),
			),
			Scene.expectOutMessage(PageOutMessage.RequestedToast({ toast: failureToastFixture })),
			Scene.expect(Scene.role("button", { name: "Revoke" })).toBeEnabled(),
		)
	})
})

describe("active connections", () => {
	test("the host disconnects a guest workspace", () => {
		Scene.scene(
			config,
			Scene.given(initial),
			Scene.Subscription.emit(Message.UpdatedMounts({ mounts: [hostMount, globexGuestMount] })),
			Scene.Subscription.emit(orgs),
			Scene.expect(Scene.text("Active connections")).toExist(),
			Scene.expect(Scene.text("Not shared yet")).toBeAbsent(),
			Scene.expect(Scene.text("Globex")).toExist(),
			Scene.click(Scene.role("button", { name: "Disconnect" })),
			Scene.Command.expectExact(
				DisconnectOrganization({
					mountId: globexGuestMount.id,
					conversationId: globexGuestMount.conversationId,
					organizationId: globex.id,
					isLeaving: false,
				}),
			),
			Scene.expect(Scene.role("button", { name: "Disconnecting..." })).toBeDisabled(),
			Scene.Command.resolve(
				DisconnectOrganization,
				Message.SucceededDisconnect({
					mountId: globexGuestMount.id,
					successMessage: "Organization disconnected",
				}),
			),
			Scene.expectOutMessage(
				PageOutMessage.RequestedToast({ toast: successToast("Organization disconnected") }),
			),
			Scene.expect(Scene.role("button", { name: "Disconnect" })).toBeEnabled(),
		)
	})

	test("a guest can leave the host but not remove another guest", () => {
		const asGuest = [
			mountOf(1, globex.id, "host"),
			{ ...globexGuestMount, organizationId },
			mountOf(3, initechGuest, "guest"),
		]
		Scene.scene(
			config,
			Scene.given(initial),
			Scene.Subscription.emit(Message.UpdatedMounts({ mounts: asGuest })),
			Scene.expect(Scene.role("button", { name: "Leave shared channel" })).toExist(),
			Scene.expect(Scene.role("button", { name: "Disconnect" })).toBeAbsent(),
			Scene.expect(Scene.text("Managed by host workspace")).toExist(),
			Scene.click(Scene.role("button", { name: "Leave shared channel" })),
			Scene.Command.expectExact(
				DisconnectOrganization({
					mountId: "mount-1",
					conversationId: globexGuestMount.conversationId,
					organizationId,
					isLeaving: true,
				}),
			),
			Scene.expect(Scene.role("button", { name: "Leaving..." })).toBeDisabled(),
			Scene.Command.resolve(
				DisconnectOrganization,
				Message.FailedDisconnect({
					mountId: "mount-1",
					title: failureToastFixture.title,
					description: failureToastFixture.description,
				}),
			),
			Scene.expectOutMessage(PageOutMessage.RequestedToast({ toast: failureToastFixture })),
		)
	})
})
