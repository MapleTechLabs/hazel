// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { Component } from "@effect/ui"
import { Locator, Scene } from "@effect/ui/testing"
import { InvitationId } from "@hazel/schema"
import { describe, expect, test } from "vitest"
import { OpenModal, ShowToast } from "../../../app/requests"
import { button, byProp, sessionAs } from "../../testing"
import {
	type Invitation,
	InvitationsMessage,
	InvitationsPageNoDeps,
	RefetchInvitations,
	REVOKE,
	RevokeInvitation,
} from "./InvitationsPage"

/** The pending invitations: the list's states, revoking one, and inviting more. */

const invitation = (n: number, emailAddress: string): Invitation => ({
	id: InvitationId.make(`00000009-0000-4000-8000-00000000000${n}`),
	emailAddress,
	role: n === 2 ? "admin" : "member",
	createdAtMs: Date.UTC(2026, 10, 20 + n),
})

const INVITATIONS = [invitation(1, "linus@hazel.test"), invitation(2, "barbara@hazel.test")]

const start = () => Scene.start(InvitationsPageNoDeps, { session: sessionAs("owner") })
const row = (email: string) => byProp("tableRow", "title", email)

describe("invitations settings", () => {
	test("waits for the list, then shows each invitation with a pending count", () => {
		start()
			.expect(byProp("progress", "label", "Loading invitations..."))
			.toExist()
			.loaded("invitations", INVITATIONS)
			.expect(row("linus@hazel.test"))
			.toExist()
			.expect(byProp("badge", "label", "2 pending"))
			.toExist()
	})

	test("no invitations offers to invite someone", () => {
		start()
			.loaded("invitations", [])
			.expect(byProp("emptyState", "title", "No pending invitations"))
			.toExist()
			.fire(button("Invite a team member"), "press")
			.expectExact(OpenModal.make({ modal: { _tag: "EmailInvite" } }))
			.resolve(OpenModal, Component.noop)
	})

	test("a failed load says why and tries again when that can help", () => {
		start()
			.loadFailed("invitations", "Offline")
			.expect(byProp("emptyState", "title", "Couldn't load invitations"))
			.toExist()
			.fire(button("Try again"), "press")
			.expectExact(RefetchInvitations.make({}))
			.resolve(RefetchInvitations, Component.noop)
		start().loadFailed("invitations", "SignedOut").expect(button("Try again")).toBeAbsent()
	})

	test("revoking runs once, spins the row's menu, and toasts the outcome", () => {
		const id = INVITATIONS[0]!.id
		const s = start()
			.loaded("invitations", INVITATIONS)
			.fire(
				Locator.inside(row("linus@hazel.test"), byProp("menu", "label", "Invitation actions")),
				"select",
				{
					id: REVOKE,
				},
			)
			.expectExact(RevokeInvitation.make({ invitationId: id }))
		const trigger = Locator.inside(
			row("linus@hazel.test"),
			byProp("button", "label", "Invitation actions"),
		)
		expect(s.get(trigger).props).toMatchObject({ loading: true, disabled: true })
		s.resolve(RevokeInvitation, InvitationsMessage.SucceededRevoke())
			.expectExact(
				ShowToast.make({
					toast: { intent: "success", title: "Invitation revoked successfully", description: null },
				}),
			)
			.resolve(ShowToast, Component.noop)
		expect(s.get(trigger).props?.["loading"]).toBeUndefined()
	})

	test("a revoke of a gone invitation says so", () => {
		start()
			.loaded("invitations", INVITATIONS)
			.fire(
				Locator.inside(row("linus@hazel.test"), byProp("menu", "label", "Invitation actions")),
				"select",
				{
					id: REVOKE,
				},
			)
			.resolve(RevokeInvitation, InvitationsMessage.FailedRevoke({ reason: "NotFound" }))
			.expectExact(
				ShowToast.make({
					toast: {
						intent: "error",
						title: "Invitation not found",
						description: "It may have already been accepted or revoked.",
					},
				}),
			)
			.resolve(ShowToast, Component.noop)
	})
})
