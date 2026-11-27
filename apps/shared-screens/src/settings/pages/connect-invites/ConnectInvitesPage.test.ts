// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
import { Component } from "@effect/ui"
import { Locator, Scene } from "@effect/ui/testing"
import {
	ChannelId,
	ConnectInviteId,
	CustomerAccountId,
	CustomerChannelSuggestionId,
	OrganizationId,
	OrganizationMemberId,
	UserId,
} from "@hazel/schema"
import { describe, expect, test } from "vitest"
import { ShowToast } from "../../../app/requests"
import type { Session } from "../../../app/session"
import { errorToast, successToast } from "../../../modals/feedback"
import {
	AcceptInvite,
	ConnectInvitesMessage,
	ConnectInvitesPageNoDeps,
	DeclineInvite,
	FetchChannelSuggestion,
	SettleSuggestion,
} from "./ConnectInvitesPage"

/** Connect invites: the incoming list (pending first), accept and decline, and the customer prompt after an accept. */

const organizationId = OrganizationId.make("00000001-0000-4000-8000-000000000001")
const host = OrganizationId.make("00000001-0000-4000-8000-000000000002")
const pending = ConnectInviteId.make("0000000f-0000-4000-8000-000000000001")
const declined = ConnectInviteId.make("0000000f-0000-4000-8000-000000000002")
const channelId = ChannelId.make("00000005-0000-4000-8000-000000000001")

const session: Session = {
	auth: "SignedIn",
	user: {
		id: UserId.make("00000002-0000-4000-8000-000000000001"),
		firstName: "Ada",
		lastName: "Lovelace",
		email: "ada@hazel.test",
		avatarUrl: null,
		isOnboarded: true,
	},
	organization: { id: organizationId, name: "Hazel", slug: "hazel", logoUrl: null },
	member: { id: OrganizationMemberId.make("00000003-0000-4000-8000-000000000001"), role: "owner" },
	orgSlug: "hazel",
}

const listed = (version: number) =>
	ConnectInvitesMessage.SucceededListInvites({
		version,
		invites: [
			{ id: declined, hostOrganizationId: host, status: "declined", createdAtMs: 1 },
			{ id: pending, hostOrganizationId: host, status: "pending", createdAtMs: 2 },
		],
	})

const byProp = (tag: string, name: string, value: unknown): Locator.Locator => ({
	description: `<hz:${tag} ${name}=${JSON.stringify(value)}>`,
	all: (root) => Locator.all(root, Locator.tag(`hz:${tag}`)).filter((node) => node.props?.[name] === value),
})
const button = (label: string) => byProp("button", "label", label)
const listKey = (version: number) => `list:"${organizationId}","${version}"`

const start = () => Scene.start(ConnectInvitesPageNoDeps, { session }).subscription(listKey(0), listed(0))

describe("connect invites settings page", () => {
	test("loads, then lists pending invites first with a count", () => {
		Scene.start(ConnectInvitesPageNoDeps, { session })
			.expect(byProp("progress", "label", "Loading invitations..."))
			.toExist()
		const s = start()
			.expect(byProp("badge", "label", "1 pending"))
			.toExist()
		const rows = s.all(Locator.tag("hz:tableRow"))
		expect(rows.map((row) => row.props?.["key"])).toEqual([pending, declined])
	})

	test("a failed first load says why and retries", () => {
		Scene.start(ConnectInvitesPageNoDeps, { session })
			.subscription(
				listKey(0),
				ConnectInvitesMessage.FailedListInvites({ version: 0, reason: "Offline" }),
			)
			.expect(byProp("emptyState", "title", "Couldn't load connect invitations"))
			.toExist()
			.fire(button("Try again"), "press")
			.subscription(listKey(1), listed(1))
			.expect(button("Accept"))
			.toExist()
	})

	test("accepting connects, lists again and asks whether the channel is a customer", () => {
		const suggestion = {
			id: CustomerChannelSuggestionId.make("00000020-0000-4000-8000-000000000001"),
			channelId,
			accountId: CustomerAccountId.make("00000021-0000-4000-8000-000000000001"),
			accountName: "Acme",
			strength: "strong" as const,
			reasons: [],
		}
		const s = start()
			.fire(button("Accept"), "press")
			.expectExact(AcceptInvite.make({ inviteId: pending, guestOrganizationId: organizationId }))
			.resolve(AcceptInvite, ConnectInvitesMessage.SucceededAccept({ inviteId: pending, channelId }))
			.expectExact(
				ShowToast.make({ toast: successToast("Channel connected") }),
				FetchChannelSuggestion.make({ organizationId, channelId }),
			)
			.resolve(ShowToast, Component.noop)
			.resolve(
				FetchChannelSuggestion,
				ConnectInvitesMessage.FetchedSuggestion({ channelId, item: suggestion as never }),
			)
			.expect(byProp("banner", "title", "The shared channel looks like Acme"))
			.toExist()
			.fire(button("Link"), "press")
		s.expectExact(SettleSuggestion.make({ organizationId, suggestion: suggestion as never, link: true }))
	})

	test("a failed decline says why", () => {
		start()
			.fire(button("Decline"), "press")
			.expectExact(DeclineInvite.make({ inviteId: pending }))
			.resolve(
				DeclineInvite,
				ConnectInvitesMessage.FailedDecline({ inviteId: pending, reason: "InvalidState" }),
			)
			.expectExact(
				ShowToast.make({
					toast: errorToast({
						title: "Cannot decline",
						description: "This invite is no longer in a declinable state.",
					}),
				}),
			)
			.resolve(ShowToast, Component.noop)
	})
})
