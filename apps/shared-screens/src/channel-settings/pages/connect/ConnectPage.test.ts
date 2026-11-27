// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { Component } from "@effect/ui"
import { Locator, Scene } from "@effect/ui/testing"
import { ConnectConversationId, ConnectInviteId, OrganizationId } from "@hazel/schema"
import { describe, expect, test } from "vitest"
import { Navigate } from "../../../app/requests"
import { RedirectPage } from "../RedirectPage"
import { button, byProp, channelId, orgId, otherOrgId, session } from "../../test-support"
import {
	ConnectMessage,
	ConnectPageNoDeps,
	DisconnectOrganization,
	type Invite,
	type Mount,
	RevokeInvite,
} from "./ConnectPage"
import {
	CreateInvite,
	SearchWorkspaces,
	ShareChannelMessage,
	ShareChannelModalNoDeps,
} from "./ShareChannelModal"

/** Channel settings, Connect: connections, invitations and the share dialog; and the settings redirect. */

const MOUNTS = `mounts:"${channelId}"`
const conversationId = ConnectConversationId.make("00000020-0000-4000-8000-000000000001")
const mount = (id: string, organizationId: OrganizationId, role: Mount["role"]): Mount => ({
	id,
	conversationId,
	organizationId,
	role,
})
const invite = (n: number, status: string): Invite => ({
	id: ConnectInviteId.make(`00000022-0000-4000-8000-00000000000${n}`),
	targetValue: `workspace-${n}`,
	status,
	createdAtMs: 0,
})

const start = () => Scene.start(ConnectPageNoDeps, { channelId, session: session() })

describe("channel settings connect", () => {
	test("with nothing shared and no invitations it offers to share", () => {
		start()
			.loaded("invites", [])
			.expect(byProp("emptyState", "title", "Not shared yet"))
			.toExist()
	})

	test("a failed load explains itself and retries", () => {
		const s = start().loadFailed("invites", "Offline")
		expect(s.get(byProp("banner", "title", "Couldn't load invitations")).props?.["description"]).toBe(
			"Check your internet connection and try again.",
		)
		s.fire(button("Try again"), "press").loaded("invites", [invite(1, "pending")])
		s.expect(byProp("tableRow", "title", "workspace-1")).toExist()
	})

	test("a pending invitation is revoked, and the list is fetched again", () => {
		const pending = invite(1, "pending")
		const s = start().loaded("invites", [pending, invite(2, "declined")])
		// Only the pending one can be revoked.
		expect(s.get(button("Revoke")).props?.["variant"]).toBe("outline")
		s.fire(button("Revoke"), "press").expectExact(RevokeInvite.make({ inviteId: pending.id }))
		s.expect(button("Revoking...")).toExist()
		s.resolve(
			RevokeInvite,
			ConnectMessage.SettledRevoke({ inviteId: pending.id, succeeded: true }),
		).loaded("invites", [invite(2, "declined")])
		s.expect(button("Revoke")).toBeAbsent()
	})

	test("the host disconnects another workspace after confirming", () => {
		const s = start()
			.loaded("invites", [])
			.subscription(
				MOUNTS,
				ConnectMessage.UpdatedMounts({
					mounts: [mount("m1", orgId, "host"), mount("m2", otherOrgId, "guest")],
				}),
			)
		s.expect(byProp("emptyState", "title", "Not shared yet")).toBeAbsent()
		s.fire(button("Disconnect"), "press")
			.expect(byProp("text", "role", "caption"))
			.toExist()
			.fire(button("Cancel"), "press")
			.expect(button("Cancel"))
			.toBeAbsent()
			.fire(button("Disconnect"), "press")
			// The armed row now offers Cancel and a danger Disconnect.
			.fire(button("Disconnect"), "press")
			.expectExact(
				DisconnectOrganization.make({
					mountId: "m2",
					conversationId,
					organizationId: otherOrgId,
					isLeaving: false,
				}),
			)
		s.expect(button("Disconnecting...")).toExist()
	})

	test("a guest leaves the shared channel, and cannot cut other guests", () => {
		const third = OrganizationId.make("00000002-0000-4000-8000-000000000003")
		const s = start()
			.loaded("invites", [])
			.subscription(
				MOUNTS,
				ConnectMessage.UpdatedMounts({
					mounts: [
						mount("m1", otherOrgId, "host"),
						mount("m2", orgId, "guest"),
						mount("m3", third, "guest"),
					],
				}),
			)
		s.expect(byProp("text", "role", "caption")).toExist()
		s.fire(button("Leave shared channel"), "press")
			.fire(button("Leave"), "press")
			.expectExact(
				DisconnectOrganization.make({
					mountId: "m1",
					conversationId,
					organizationId: orgId,
					isLeaving: true,
				}),
			)
	})
})

describe("share channel dialog", () => {
	const props = { channelId, channelName: "general", organizationId: orgId }
	const query = (value: string) => ({ value, rev: 1, edit: 0 })
	const acme = { id: otherOrgId, name: "Acme", slug: "acme", logoUrl: null }

	test("searches after two characters, picks a workspace and sends the invite", () => {
		const s = Scene.start(ShareChannelModalNoDeps, props)
		expect(s.get(button("Send invite")).props?.["disabled"]).toBe(true)
		s.fire(Locator.tag("hz:textField"), "change", query("a")).expectNone()
		s.fire(Locator.tag("hz:textField"), "change", query("ac")).expectExact(
			SearchWorkspaces.make({ version: 2, query: "ac", organizationId: orgId, delayed: true }),
		)
		s.resolve(
			SearchWorkspaces,
			ShareChannelMessage.SucceededSearch({
				version: 2,
				workspaces: [acme, { ...acme, id: orgId, name: "No slug", slug: null }],
			}),
		)
		expect(s.get(byProp("item", "title", "No slug")).props?.["disabled"]).toBe(true)
		s.fire(byProp("item", "title", "Acme"), "press")
			.fire(Locator.tag("hz:toggle"), "change", { checked: true })
			.fire(button("Send invite"), "press")
			.expectExact(
				CreateInvite.make({
					channelId,
					guestOrganizationId: otherOrgId,
					slug: "acme",
					allowGuestMemberAdds: true,
				}),
			)
			.resolve(CreateInvite, ShareChannelMessage.SucceededSend())
			.emitted({ _tag: "Sent" })
	})

	test("Cancel asks to close", () => {
		Scene.start(ShareChannelModalNoDeps, props)
			.fire(button("Cancel"), "press")
			.emitted({ _tag: "RequestedClose" })
	})

	test("a stale search answer is dropped", () => {
		const s = Scene.start(ShareChannelModalNoDeps, props)
			.fire(Locator.tag("hz:textField"), "change", query("ac"))
			.keepPending(SearchWorkspaces)
			.fire(Locator.tag("hz:textField"), "change", query("acm"))
			.keepPending(SearchWorkspaces)
		s.resolve(SearchWorkspaces, ShareChannelMessage.SucceededSearch({ version: 1, workspaces: [acme] }))
		s.expect(byProp("item", "title", "Acme")).toBeAbsent()
	})
})

describe("channel settings redirect", () => {
	test("replaces the URL with the Overview tab", () => {
		Scene.start(RedirectPage, { overviewHref: "/hazel/channels/c1/settings/overview" })
			.subscription(`redirect:"/hazel/channels/c1/settings/overview"`, { _tag: "Mounted" })
			.expectExact(Navigate.make({ href: "/hazel/channels/c1/settings/overview", replace: true }))
			.resolve(Navigate, Component.noop)
	})
})
