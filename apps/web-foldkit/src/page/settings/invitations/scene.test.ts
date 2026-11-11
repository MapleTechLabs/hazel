// @vitest-environment jsdom
import { InvitationId } from "@hazel/schema"
import { Schema } from "effect"
import * as Scene from "foldkit/scene"
import { describe, test } from "vitest"
import type { CommonReason } from "~/lib/error-messages"
import { errorToast, successToast } from "../../../data/actions"
import { makeShared, organizationId, pageScene, uuid } from "../../../test/pages-fixtures"
import * as Menu from "../../../ui/menu"
import { FocusTriggerOnPress } from "../../../ui/menu-view"
import { PageOutMessage } from "../../out-message"
import { Message } from "./message"
import type { Invitation } from "./model"
import { FetchInvitations, init, RevokeInvitation, update } from "./update"
import { view } from "./view"

const inv1 = Schema.decodeSync(InvitationId)(uuid(11))

/** The pending invitations table through its view: empty state, the row menu and revoking. */

const config = pageScene(update, view, makeShared())
const ada: Invitation = { id: inv1, emailAddress: "ada@hazel.test", role: "member", createdAtMs: 0 }
const loaded = update(
	init(undefined, makeShared()).model,
	Message.SucceededFetchInvitations({ version: 1, invitations: [ada] }),
).model

// The row trigger is an icon-only button with no accessible name, so it is located by id.
const trigger = Scene.selector(`#invitation-${inv1}-trigger`)
const revokeItem = Scene.role("menuitem", { name: "Revoke Invitation" })
const triggerMounted = Scene.Mount.resolve(FocusTriggerOnPress, Menu.Message.CompletedFocusTriggerOnPress())
const portalMenu = { name: "PortalMenu" }
const openRowMenu = [
	Scene.pointerDown(trigger),
	Scene.Mount.resolve(portalMenu, Menu.Message.CompletedPortalMenu()),
	Scene.expect(revokeItem).toExist(),
]

const loadedEmpty = update(
	init(undefined, makeShared()).model,
	Message.SucceededFetchInvitations({ version: 1, invitations: [] }),
).model

const failedWith = (reason: CommonReason) =>
	update(init(undefined, makeShared()).model, Message.FailedFetchInvitations({ version: 1, reason })).model

describe("loading the list", () => {
	test("while the first fetch runs the page shows a loader, not the empty state", () => {
		Scene.scene(
			config,
			Scene.given(init(undefined, makeShared()).model),
			Scene.expect(Scene.text("Loading invitations...")).toExist(),
			Scene.expect(Scene.role("heading", { name: "No pending invitations" })).toBeAbsent(),
		)
	})

	test("a failed fetch shows the error and a retry, never the empty state", () => {
		Scene.scene(
			config,
			Scene.given(failedWith("Offline")),
			Scene.expect(Scene.role("heading", { name: "Couldn't load invitations" })).toExist(),
			Scene.expect(Scene.text("Check your internet connection and try again.")).toExist(),
			Scene.expect(Scene.role("heading", { name: "No pending invitations" })).toBeAbsent(),
			Scene.click(Scene.role("button", { name: "Try again" })),
			Scene.Command.expectExact(FetchInvitations({ organizationId, version: 2 })),
			Scene.expect(Scene.text("Loading invitations...")).toExist(),
			Scene.Command.resolve(
				FetchInvitations,
				Message.SucceededFetchInvitations({ version: 2, invitations: [ada] }),
			),
			triggerMounted,
			Scene.expect(Scene.text("ada@hazel.test")).toExist(),
		)
	})

	test("an unexpected failure offers no retry", () => {
		Scene.scene(
			config,
			Scene.given(failedWith("Unexpected")),
			Scene.expect(Scene.role("heading", { name: "Couldn't load invitations" })).toExist(),
			Scene.expect(Scene.role("button", { name: "Try again" })).toBeAbsent(),
		)
	})

	test("a failed refetch keeps the loaded rows and says it couldn't refresh", () => {
		Scene.scene(
			config,
			Scene.given(
				update(
					{ ...loaded, fetchVersion: 2 },
					Message.FailedFetchInvitations({ version: 2, reason: "Timeout" }),
				).model,
			),
			triggerMounted,
			Scene.expect(Scene.text("ada@hazel.test")).toExist(),
			Scene.expect(Scene.role("alert")).toContainText("Couldn't refresh"),
		)
	})
})

describe("empty state", () => {
	test("with no invitations both invite buttons request the invite modal", () => {
		Scene.scene(
			config,
			Scene.given(loadedEmpty),
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
			Scene.Command.expectExact(RevokeInvitation({ invitationId: inv1 })),
			Scene.Mount.expectEnded(portalMenu),
			Scene.expect(trigger).toBeDisabled(),
			Scene.Command.resolve(RevokeInvitation, Message.SucceededRevokeInvitation()),
			Scene.expectOutMessage(
				PageOutMessage.RequestedToast({ toast: successToast("Invitation revoked successfully") }),
			),
			Scene.Command.resolve(
				FetchInvitations,
				Message.SucceededFetchInvitations({ version: 2, invitations: [] }),
			),
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
			Scene.Command.resolve(RevokeInvitation, Message.FailedRevokeInvitation({ reason: "Unexpected" })),
			Scene.expectOutMessage(
				PageOutMessage.RequestedToast({
					toast: errorToast("Something went wrong", "Please try again."),
				}),
			),
			Scene.expect(trigger).toBeEnabled(),
			Scene.Command.resolve(
				FetchInvitations,
				Message.SucceededFetchInvitations({ version: 2, invitations: [ada] }),
			),
			Scene.expect(Scene.text("ada@hazel.test")).toExist(),
		)
	})
})
