// @vitest-environment jsdom
import * as Scene from "foldkit/scene"
import { describe, test } from "vitest"
import { errorToast, successToast } from "../../../data/actions"
import { makeShared, pageScene } from "../../../test/pages-fixtures"
import * as Menu from "../../../ui/menu"
import { FocusTriggerOnPress } from "../../../ui/menu-view"
import { PageOutMessage } from "../../out-message"
import { Message } from "./message"
import type { Invitation } from "./model"
import { FetchInvitations, init, RevokeInvitation, update } from "./update"
import { view } from "./view"

/** The pending invitations table through its view: empty state, the row menu and revoking. */

const config = pageScene(update, view, makeShared())
const ada: Invitation = { id: "inv_1", emailAddress: "ada@hazel.test", role: "org:member", createdAtMs: 0 }
const loaded = update(init().model, Message.CompletedFetchInvitations({ invitations: [ada] })).model

// The row trigger is an icon-only button with no accessible name, so it is located by id.
const trigger = Scene.selector("#invitation-inv_1-trigger")
const revokeItem = Scene.role("menuitem", { name: "Revoke Invitation" })
const triggerMounted = Scene.Mount.resolve(FocusTriggerOnPress, Menu.Message.CompletedFocusTriggerOnPress())
const portalMenu = { name: "PortalMenu" }
const openRowMenu = [
	Scene.pointerDown(trigger),
	Scene.Mount.resolve(portalMenu, Menu.Message.CompletedPortalMenu()),
	Scene.expect(revokeItem).toExist(),
]

describe("empty state", () => {
	test("with no invitations both invite buttons request the invite modal", () => {
		Scene.scene(
			config,
			Scene.given(init().model),
			Scene.expect(Scene.role("heading", { name: "No pending invitations" })).toExist(),
			Scene.click(Scene.role("button", { name: /Invite a team member/ })),
			Scene.expectOutMessage(PageOutMessage.RequestedModal({ modal: { _tag: "EmailInvite" } })),
			Scene.click(Scene.role("button", { name: /Invite user/ })),
			Scene.expectOutMessage(PageOutMessage.RequestedModal({ modal: { _tag: "EmailInvite" } })),
		)
	})
})

describe("revoke from the row menu", () => {
	test("revoking shows the pending row, toasts, and the refetch empties the table", () => {
		Scene.scene(
			config,
			Scene.given(loaded),
			triggerMounted,
			Scene.expect(Scene.text("ada@hazel.test")).toExist(),
			Scene.expect(Scene.text("Member")).toExist(),
			Scene.expect(Scene.text("1 pending", { exact: false })).toExist(),
			...openRowMenu,
			Scene.click(revokeItem),
			Scene.Command.expectExact(RevokeInvitation({ invitationId: "inv_1" })),
			Scene.Mount.expectEnded(portalMenu),
			Scene.expect(trigger).toBeDisabled(),
			Scene.Command.resolve(RevokeInvitation, Message.SucceededRevoke()),
			Scene.expectOutMessage(PageOutMessage.RequestedToast({ toast: successToast("Invitation revoked successfully") })),
			Scene.Command.resolve(FetchInvitations, Message.CompletedFetchInvitations({ invitations: [] })),
			Scene.Mount.expectEnded(FocusTriggerOnPress),
			Scene.expect(Scene.text("ada@hazel.test")).toBeAbsent(),
			Scene.expect(Scene.role("heading", { name: "No pending invitations" })).toExist(),
		)
	})

	test("a failed revoke toasts the error and re-enables the row", () => {
		Scene.scene(
			config,
			Scene.given(loaded),
			triggerMounted,
			...openRowMenu,
			Scene.click(revokeItem),
			Scene.Mount.expectEnded(portalMenu),
			Scene.Command.resolve(RevokeInvitation, Message.FailedRevoke()),
			Scene.expectOutMessage(PageOutMessage.RequestedToast({ toast: errorToast("Failed to revoke invitation") })),
			Scene.expect(trigger).toBeEnabled(),
			Scene.Command.resolve(FetchInvitations, Message.CompletedFetchInvitations({ invitations: [ada] })),
			Scene.expect(Scene.text("ada@hazel.test")).toExist(),
		)
	})
})
