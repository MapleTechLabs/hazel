// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/** What the modal scene tests share: the signed-in session and locators by a vocabulary prop. */
import type { Locator } from "@effect/ui/testing"
import { Locator as L } from "@effect/ui/testing"
import { OrganizationId, OrganizationMemberId, UserId } from "@hazel/schema"
import type { Session } from "../app/session"

export const ada = {
	id: UserId.make("00000001-0000-4000-8000-000000000001"),
	firstName: "Ada",
	lastName: "Lovelace",
	email: "ada@hazel.test",
	avatarUrl: null,
	isOnboarded: true,
}

export const organizationId = OrganizationId.make("00000002-0000-4000-8000-000000000001")

export const session: Session = {
	auth: "SignedIn",
	user: ada,
	organization: { id: organizationId, name: "Hazel Labs", slug: "hazel", logoUrl: null },
	member: { id: OrganizationMemberId.make("00000003-0000-4000-8000-000000000001"), role: "owner" },
	orgSlug: "hazel",
}

/** A vocabulary element by one of its props (a Scene draws `hz:<tag>` nodes with their props). */
export const byProp = (tag: string, name: string, value: unknown): Locator.Locator => ({
	description: `<hz:${tag} ${name}=${JSON.stringify(value)}>`,
	all: (root) => L.all(root, L.tag(`hz:${tag}`)).filter((node) => node.props?.[name] === value),
})

export const button = (label: string) => byProp("button", "label", label)
export const field = (label: string) => byProp("textField", "label", label)
export const dialog = (title: string) => byProp("dialog", "title", title)

/** A text field's `change`, as the renderer reports a keystroke. */
export const typed = (value: string, rev = 1) => ({ value, rev, edit: 0 })
