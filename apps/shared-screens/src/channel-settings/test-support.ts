// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/** What the channel settings scene tests share: a session, ids and a locator by prop. */
import { Locator } from "@effect/ui/testing"
import { ChannelId, OrganizationId, OrganizationMemberId, UserId } from "@hazel/schema"
import type { Session } from "../app/session"

export const channelId = ChannelId.make("00000005-0000-4000-8000-000000000001")
export const orgId = OrganizationId.make("00000002-0000-4000-8000-000000000001")
export const otherOrgId = OrganizationId.make("00000002-0000-4000-8000-000000000002")

export const session = (member = true): Session => ({
	auth: "SignedIn",
	user: {
		id: UserId.make("00000001-0000-4000-8000-000000000001"),
		firstName: "Ada",
		lastName: "Lovelace",
		email: "ada@hazel.test",
		avatarUrl: null,
		isOnboarded: true,
	},
	organization: { id: orgId, name: "Hazel", slug: "hazel", logoUrl: null },
	member: member
		? { id: OrganizationMemberId.make("00000003-0000-4000-8000-000000000001"), role: "owner" }
		: null,
	orgSlug: "hazel",
})

/** A vocabulary element by one of its props (a Scene draws `hz:<tag>` nodes with their props). */
export const byProp = (tag: string, name: string, value: unknown): Locator.Locator => ({
	description: `<hz:${tag} ${name}=${JSON.stringify(value)}>`,
	all: (root) => Locator.all(root, Locator.tag(`hz:${tag}`)).filter((node) => node.props?.[name] === value),
})

export const button = (label: string) => byProp("button", "label", label)
