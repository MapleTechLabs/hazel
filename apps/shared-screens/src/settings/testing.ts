// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/** What the settings pages' tests share: a session per role, and locators by a prop. */
import { Locator } from "@effect/ui/testing"
import { OrganizationId, OrganizationMemberId, UserId } from "@hazel/schema"
import type { Session } from "../app/session"

export const ada = UserId.make("00000001-0000-4000-8000-000000000001")
export const orgId = OrganizationId.make("00000002-0000-4000-8000-000000000001")

/** Ada in the Hazel workspace as `role`; `null` while the membership loads. */
export const sessionAs = (role: "owner" | "admin" | "member" | null): Session => ({
	auth: "SignedIn",
	user: {
		id: ada,
		firstName: "Ada",
		lastName: "Lovelace",
		email: "ada@hazel.test",
		avatarUrl: null,
		isOnboarded: true,
	},
	organization: { id: orgId, name: "Hazel", slug: "hazel", logoUrl: null },
	member:
		role === null
			? null
			: { id: OrganizationMemberId.make("00000003-0000-4000-8000-000000000001"), role },
	orgSlug: "hazel",
})

/** A vocabulary element by one of its props (a Scene draws `hz:<tag>` nodes with their props). */
export const byProp = (tag: string, name: string, value: unknown): Locator.Locator => ({
	description: `<hz:${tag} ${name}=${JSON.stringify(value)}>`,
	all: (root) => Locator.all(root, Locator.tag(`hz:${tag}`)).filter((node) => node.props?.[name] === value),
})

export const button = (label: string) => byProp("button", "label", label)
