// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/** Fixtures and locators the integrations pages' Scene tests share. */
import { Locator } from "@effect/ui/testing"
import { BotId, OrganizationId, OrganizationMemberId, UserId } from "@hazel/schema"
import type { Session } from "../../app/session"
import type { Bot, PublicBot } from "./data"

export const adaId = UserId.make("00000001-0000-4000-8000-000000000001")
export const orgId = OrganizationId.make("00000002-0000-4000-8000-000000000001")

export const session: Session = {
	auth: "SignedIn",
	user: {
		id: adaId,
		firstName: "Ada",
		lastName: "Lovelace",
		email: "ada@hazel.test",
		avatarUrl: null,
		isOnboarded: true,
	},
	organization: { id: orgId, name: "Hazel", slug: "hazel", logoUrl: null },
	member: { id: OrganizationMemberId.make("00000003-0000-4000-8000-000000000001"), role: "owner" },
	orgSlug: "hazel",
}

export const bot = (n: number, overrides: Partial<Bot> = {}): Bot => ({
	id: BotId.make(`00000031-0000-4000-8000-00000000000${n}`),
	name: `Bot ${n}`,
	description: `Bot ${n} does things.`,
	isPublic: false,
	scopes: ["messages:read", "messages:write"],
	allowedIntegrations: [],
	installRedirectUris: [],
	avatarUrl: null,
	installCount: 1,
	...overrides,
})

export const publicBot = (n: number, overrides: Partial<PublicBot> = {}): PublicBot => ({
	...bot(n, { isPublic: true }),
	creatorName: "Grace Hopper",
	...overrides,
})

/** A vocabulary element by one of its props (a Scene draws `hz:<tag>` nodes with their props). */
export const byProp = (tag: string, name: string, value: string): Locator.Locator => ({
	description: `<hz:${tag} ${name}=${JSON.stringify(value)}>`,
	all: (root) => Locator.all(root, Locator.tag(`hz:${tag}`)).filter((node) => node.props?.[name] === value),
})
export const button = (label: string) => byProp("button", "label", label)
