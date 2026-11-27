// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/** Rows and helpers the Signals tests share: an org, its session and a few rules. */
import { Locator } from "@effect/ui/testing"
import * as Customers from "@hazel/domain/customers"
import { CustomerSignalRuleId, OrganizationId, OrganizationMemberId, UserId } from "@hazel/schema"
import type { Session } from "../../../app/session"
import type { RuleRow } from "./model"

export const organizationId = OrganizationId.make("00000002-0000-4000-8000-000000000001")

export const session = (role: "owner" | "admin" | "member" = "owner"): Session => ({
	auth: "SignedIn",
	user: {
		id: UserId.make("00000001-0000-4000-8000-000000000001"),
		firstName: "Ada",
		lastName: "Lovelace",
		email: "ada@hazel.test",
		avatarUrl: null,
		isOnboarded: true,
	},
	organization: { id: organizationId, name: "Hazel", slug: "hazel", logoUrl: null },
	member: { id: OrganizationMemberId.make("00000003-0000-4000-8000-000000000001"), role },
	orgSlug: "hazel",
})

export const NOW = Date.parse("2026-11-26T15:00:00Z")

export const ruleId = (n: number) => CustomerSignalRuleId.make(`00000000-0000-4000-8000-0000000c000${n}`)

export const rule = (
	n: number,
	template: Customers.SignalTemplate,
	overrides: Partial<RuleRow> = {},
): RuleRow => {
	const meta = Customers.TEMPLATES[template]
	return {
		id: ruleId(n),
		name: meta.name,
		template,
		kind: meta.kind,
		severity: meta.defaultSeverity,
		config: meta.defaultConfig,
		scope: {},
		enabled: true,
		lastTriggeredAtMs: null,
		matchingCount: 0,
		updatedAtMs: NOW - 4 * 86_400_000,
		...overrides,
	}
}

/** A vocabulary element by one of its props (a Scene draws `hz:<tag>` nodes with their props). */
export const byProp = (tag: string, name: string, value: unknown): Locator.Locator => ({
	description: `<hz:${tag} ${name}=${JSON.stringify(value)}>`,
	all: (root) => Locator.all(root, Locator.tag(`hz:${tag}`)).filter((node) => node.props?.[name] === value),
})
export const button = (label: string) => byProp("button", "label", label)

/** Subscription keys, as the instance reports them (name, then its dependencies). */
export const feedKey = (feed: string) => `${feed}:"${organizationId}"`
