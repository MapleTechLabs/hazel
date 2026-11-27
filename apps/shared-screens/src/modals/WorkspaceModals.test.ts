// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { Component } from "@effect/ui"
import { Scene } from "@effect/ui/testing"
import { OrganizationId, OrganizationMemberId, UserId } from "@hazel/schema"
import { describe, expect, test } from "vitest"
import { Navigate } from "../app/requests"
import { ChangeRoleModalNoDeps, UpdateRole } from "./ChangeRoleModal"
import {
	CreateOrganization,
	CreateOrganizationModalNoDeps,
	organizationHref,
} from "./CreateOrganizationModal"
import { EmailInviteMessage, EmailInviteModalNoDeps, SendInvites } from "./EmailInviteModal"
import { ModalEvents } from "./feedback"
import { FeedbackModalNoDeps, ThankForFeedback } from "./FeedbackModal"
import { KeyboardShortcutsModal } from "./KeyboardShortcutsModal"
import {
	CreateIntegrationRequest,
	RequestIntegrationMessage,
	RequestIntegrationModalNoDeps,
} from "./RequestIntegrationModal"
import { button, byProp, field, organizationId, session, typed } from "./test-support"

/** The workspace modals: email invites, a new server, a member's role, feedback, integrations, shortcuts. */

const close = ModalEvents.RequestedClose()

describe("email invite modal", () => {
	test("sends the filled rows by role and closes", () => {
		const s = Scene.start(EmailInviteModalNoDeps, { session })
			.fire(field("Email address"), "change", typed("grace@hazel.test"))
			.fire(button("Add another"), "press")
		const second = byProp("textField", "placeholder", "colleague@company.com")
		expect(s.all(second)).toHaveLength(2)
		s.fire(button("Remove invite"), "press")
		expect(s.all(second)).toHaveLength(1)
		expect(s.get(button("Send invite")).props?.["disabled"]).toBeFalsy()
		s.fire(byProp("select", "label", "Role"), "change", { value: "admin" })
			.fire(button("Send invite"), "press")
			.expectExact(
				SendInvites.make({ organizationId, invites: [{ email: "grace@hazel.test", role: "admin" }] }),
			)
			.resolve(SendInvites, EmailInviteMessage.SucceededSendInvites())
			.emitted(close)
	})

	test("with only blank rows nothing is sent", () => {
		Scene.start(EmailInviteModalNoDeps, { session })
			.fire(button("Send invite"), "press")
			.expect(button("Sending..."))
			.toBeAbsent()
	})
})

describe("create organization modal", () => {
	const name = field("Server name")
	const slug = field("Server slug")

	test("a short name shows both fields' errors and blocks the submit", () => {
		const s = Scene.start(CreateOrganizationModalNoDeps, { isMobile: false }).fire(
			name,
			"change",
			typed("ab"),
		)
		expect(s.get(name).props?.["error"]).toBe("Server name must be at least 3 characters")
		expect(s.get(slug).props?.["error"]).toBe("Server slug must be at least 3 characters")
		expect(s.get(button("Create server")).props?.["disabled"]).toBe(true)
	})

	test("creates the server", () => {
		Scene.start(CreateOrganizationModalNoDeps, { isMobile: true })
			.fire(name, "change", typed("Acme Corp"))
			.fire(slug, "change", typed("acme-corp"))
			.fire(button("Create server"), "press")
			.expectExact(CreateOrganization.make({ name: "Acme Corp", slug: "acme-corp", isMobile: true }))
	})

	test("the new server opens at its home, chat on a phone, or its setup without a slug", () => {
		const id = OrganizationId.make("00000002-0000-4000-8000-000000000009")
		expect(organizationHref({ id, slug: "acme" }, false)).toBe("/acme")
		expect(organizationHref({ id, slug: "acme" }, true)).toBe("/acme/chat")
		expect(organizationHref({ id, slug: null }, false)).toBe(`/onboarding/setup-organization?orgId=${id}`)
	})
})

describe("change role modal", () => {
	const props = {
		userId: UserId.make("00000001-0000-4000-8000-000000000002"),
		memberId: OrganizationMemberId.make("00000003-0000-4000-8000-000000000002"),
		name: "Grace",
		role: "member",
		currentUserRole: "admin",
	}
	const roles = byProp("choiceGroup", "label", "Role")

	test("only an owner may pick owner; an unchanged role disables the update", () => {
		const s = Scene.start(ChangeRoleModalNoDeps, props)
		expect(s.get(button("Update role")).props?.["disabled"]).toBe(true)
		s.fire(roles, "change", { selected: ["owner"] })
		expect(s.get(roles).props?.["selected"]).toEqual(["member"])
	})

	test("updates the role", () => {
		Scene.start(ChangeRoleModalNoDeps, props)
			.fire(roles, "change", { selected: ["admin"] })
			.fire(button("Update role"), "press")
			.expectExact(UpdateRole.make({ memberId: props.memberId, role: "admin", name: "Grace" }))
	})
})

describe("feedback modal", () => {
	const message = byProp("textArea", "label", "Message")

	test("a short message says why", () => {
		const s = Scene.start(FeedbackModalNoDeps, {}).fire(message, "change", typed("bug"))
		expect(s.get(message).props?.["error"]).toBe("Feedback must be at least 6 characters")
		expect(s.get(button("Submit feedback")).props?.["disabled"]).toBe(true)
	})

	test("a valid message thanks and closes", () => {
		Scene.start(FeedbackModalNoDeps, {})
			.fire(byProp("select", "label", "Category"), "change", { value: "question" })
			.fire(message, "change", typed("How do threads work?"))
			.fire(button("Submit feedback"), "press")
			.expectExact(ThankForFeedback.make({}))
			.emitted(close)
			.resolve(ThankForFeedback, Component.noop)
	})
})

describe("request integration modal", () => {
	const url = field("Website URL (optional)")

	test("an invalid URL says so", () => {
		const s = Scene.start(RequestIntegrationModalNoDeps, { session })
			.fire(field("Integration name"), "change", typed("Linear"))
			.fire(url, "change", typed("not a url"))
		expect(s.get(url).props?.["error"]).toBe("Please enter a valid URL")
		expect(s.get(button("Submit request")).props?.["disabled"]).toBe(true)
	})

	test("submits the request", () => {
		Scene.start(RequestIntegrationModalNoDeps, { session })
			.fire(field("Integration name"), "change", typed("Linear"))
			.fire(url, "change", typed("https://linear.app"))
			.fire(button("Submit request"), "press")
			.expectExact(
				CreateIntegrationRequest.make({
					organizationId,
					integrationName: "Linear",
					integrationUrl: "https://linear.app",
					description: null,
				}),
			)
			.resolve(CreateIntegrationRequest, RequestIntegrationMessage.SucceededCreateRequest())
			.emitted(close)
	})
})

describe("keyboard shortcuts modal", () => {
	test("lists the actions by category and opens the keybind settings", () => {
		const s = Scene.start(KeyboardShortcutsModal, { overrides: {}, platform: "mac", orgSlug: "hazel" })
		expect(s.all(byProp("text", "role", "overline")).length).toBeGreaterThan(3)
		s.fire(button("Customize keybinds"), "press")
			.expectExact(Navigate.make({ href: "/hazel/my-settings/keybinds", replace: false }))
			.emitted(close)
			.resolve(Navigate, Component.noop)
	})
})
