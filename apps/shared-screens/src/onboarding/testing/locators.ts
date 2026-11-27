import type { Locator } from "@effect/ui/testing"
import { Locator as L } from "@effect/ui/testing"
import { OrganizationId, OrganizationMemberId, UserId } from "@hazel/schema"
import type { Session } from "../../app/session"
import type { Membership } from "../domain/OnboardingFlow"

/** A vocabulary element by one of its props (a Scene draws `hz:<tag>` nodes with their props). */
export const byProp = (tag: string, name: string, value: unknown): Locator.Locator => ({
	description: `<hz:${tag} ${name}=${JSON.stringify(value)}>`,
	all: (root) => L.all(root, L.tag(`hz:${tag}`)).filter((node) => node.props?.[name] === value),
})

export const button = (label: string) => byProp("button", "label", label)
export const field = (label: string) => byProp("textField", "label", label)

export const ada = {
	id: UserId.make("00000001-0000-4000-8000-000000000001"),
	firstName: "Ada",
	lastName: "Lovelace",
	email: "ada@hazel.test",
	avatarUrl: null,
	isOnboarded: false,
}

export const signedIn: Session = {
	auth: "SignedIn",
	user: ada,
	organization: null,
	member: null,
	orgSlug: null,
}

export const invitedTo: Membership = {
	organizationId: OrganizationId.make("00000002-0000-4000-8000-000000000001"),
	memberId: OrganizationMemberId.make("00000003-0000-4000-8000-000000000001"),
	name: "Hazel Labs",
	slug: "hazel",
}
