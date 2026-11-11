import type {
	CustomerProvider,
	IgnoreRule,
	IgnoreRuleField,
	UnmatchedEntityType,
	UnmatchedRecord,
} from "@hazel/domain/customers"
import { CustomerIgnoreRuleId, CustomerUnmatchedRecordId } from "@hazel/schema"
import { Schema } from "effect"
import {
	ACCOUNTS_BY_KEY,
	MAPLE_CONNECTION,
	MAYA as ME,
	NOW,
	type NamedAccount,
	STRIPE_CONNECTION,
} from "./customers"

/**
 * Unmatched records for the resolver (Wonder `ids`): five Stripe customers and nine Maple groups with
 * mixed confidence, three ignored records and two ignore rules. Suggestions point at the named
 * accounts of `./customers`.
 */

const HOUR = 3_600_000
const ago = (ms: number) => new Date(NOW.getTime() - ms)
const uuid = (kind: number, n: number) =>
	`${String(kind).padStart(8, "0")}-0000-4000-8000-${String(n).padStart(12, "0")}`

const CONNECTION_OF = { stripe: STRIPE_CONNECTION.id, maple: MAPLE_CONNECTION.id } as const

type Seed = Readonly<{
	provider: keyof typeof CONNECTION_OF
	entityType?: UnmatchedEntityType
	externalId: string
	label: string
	email?: string
	domain?: string
	valueMinor?: number
	events?: number
	suggested?: NamedAccount
	confidence?: number
	reason: string
	status?: "open" | "ignored"
}>

const record = (n: number, seed: Seed): UnmatchedRecord => ({
	id: Schema.decodeSync(CustomerUnmatchedRecordId)(uuid(40, n)),
	connectionId: CONNECTION_OF[seed.provider],
	provider: seed.provider,
	entityType: seed.entityType ?? "account",
	externalId: seed.externalId,
	label: seed.label,
	email: seed.email ?? null,
	domain: seed.domain ?? null,
	valueMinor: seed.valueMinor ?? null,
	currency: seed.valueMinor === undefined ? null : "usd",
	eventCount30d: seed.events ?? null,
	payload: null,
	suggestedAccountId: seed.suggested === undefined ? null : ACCOUNTS_BY_KEY[seed.suggested].id,
	confidence: seed.confidence ?? null,
	reason: seed.reason,
	status: seed.status ?? "open",
	resolvedByUserId: seed.status === "ignored" ? ME.id : null,
	resolvedAt: seed.status === "ignored" ? ago(30 * HOUR) : null,
	createdAt: ago((40 + n) * HOUR),
	updatedAt: ago(n * HOUR),
})

const SEEDS: ReadonlyArray<Seed> = [
	{
		provider: "stripe",
		externalId: "cus_Q8f2Lk",
		label: "billing@northwind.io",
		email: "billing@northwind.io",
		domain: "northwind.io",
		valueMinor: 49_000,
		suggested: "northwind",
		confidence: 0.92,
		reason: "3 Northwind Labs contacts use @northwind.io",
	},
	{
		provider: "stripe",
		externalId: "cus_P1x9Wd",
		label: "ap@acmerobotics.com",
		email: "ap@acmerobotics.com",
		domain: "acmerobotics.com",
		valueMinor: 62_000,
		suggested: "acme",
		confidence: 0.74,
		reason: "Same company name, different domain",
	},
	{
		provider: "stripe",
		externalId: "cus_R0mT3a",
		label: "finance@kestrel.so",
		email: "finance@kestrel.so",
		domain: "kestrel.so",
		valueMinor: 29_000,
		suggested: "kestrel",
		confidence: 0.68,
		reason: "Same domain, but 2 accounts use kestrel.so",
	},
	{
		provider: "stripe",
		externalId: "cus_S7hL2q",
		label: "jon.park@gmail.com",
		email: "jon.park@gmail.com",
		valueMinor: 39_000,
		suggested: "brightfield",
		confidence: 0.41,
		reason: "Customer name only; gmail.com can't be matched",
	},
	{
		provider: "stripe",
		externalId: "cus_T4kN8v",
		label: "ops@tallyhq.com",
		email: "ops@tallyhq.com",
		domain: "tallyhq.com",
		valueMinor: 5_000,
		reason: "tallyhq.com isn't on any account",
	},
	{
		provider: "maple",
		externalId: "org_2rM1vHcT9e",
		label: "org_2rM1vHcT9e",
		events: 58,
		suggested: "lumen",
		confidence: 0.9,
		reason: "Group name and 2 users match Lumen Health",
	},
	{
		provider: "maple",
		externalId: "org_2wR7aLmQ1c",
		label: "org_2wR7aLmQ1c",
		events: 842,
		suggested: "pinecone",
		confidence: 0.86,
		reason: "All 6 users have @pinecone.studio emails",
	},
	{
		provider: "maple",
		externalId: "org_2xK9fPqLm4",
		label: "org_2xK9fPqLm4",
		events: 1_203,
		suggested: "cobalt",
		confidence: 0.88,
		reason: "8 of 14 users are Cobalt Freight contacts",
	},
	{
		provider: "maple",
		externalId: "org_2vB3cXzK7p",
		label: "org_2vB3cXzK7p",
		events: 611,
		suggested: "halcyon",
		confidence: 0.63,
		reason: "5 of 9 users are Halcyon Health contacts",
	},
	{
		provider: "maple",
		externalId: "staging-acme",
		label: "staging-acme",
		events: 3_410,
		suggested: "acme",
		confidence: 0.35,
		reason: "Name contains “acme”; looks like internal staging",
	},
	{
		provider: "maple",
		externalId: "org_2tY8bpQwR3n",
		label: "org_2tY8bpQwR3n",
		events: 377,
		reason: "Users have gmail.com and proton.me emails",
	},
	{
		provider: "maple",
		externalId: "org_2sN4kDe8Vb",
		label: "Fernway",
		events: 214,
		reason: "No account named Fernway; fernway.app unknown",
	},
	{
		provider: "maple",
		externalId: "test-group-1",
		label: "test-group-1",
		events: 96,
		reason: "Looks like test data",
	},
	{
		provider: "maple",
		externalId: "org_2qP6tJkW0a",
		label: "org_2qP6tJkW0a",
		events: 12,
		reason: "Single user, no email on events",
	},
	{
		provider: "maple",
		externalId: "internal-tools",
		label: "internal-tools",
		events: 1_920,
		reason: "Ignored by the rule internal-*",
		status: "ignored",
	},
	{
		provider: "stripe",
		externalId: "cus_Z0test1",
		label: "test@hazel.sh",
		email: "test@hazel.sh",
		domain: "hazel.sh",
		valueMinor: 0,
		reason: "Ignored by the rule hazel.sh",
		status: "ignored",
	},
	{
		provider: "maple",
		externalId: "org_2demo0000",
		label: "Demo workspace",
		events: 44,
		reason: "Ignored by hand",
		status: "ignored",
	},
]

const ALL = SEEDS.map((seed, index) => record(index + 1, seed))

export const OPEN_UNMATCHED: ReadonlyArray<UnmatchedRecord> = ALL.filter((row) => row.status === "open")
export const IGNORED_UNMATCHED: ReadonlyArray<UnmatchedRecord> = ALL.filter((row) => row.status === "ignored")

const rule = (
	n: number,
	provider: CustomerProvider,
	field: IgnoreRuleField,
	pattern: string,
): IgnoreRule => ({
	id: Schema.decodeSync(CustomerIgnoreRuleId)(uuid(41, n)),
	provider,
	entityType: "account",
	field,
	pattern,
	createdBy: ME.id,
	createdAt: ago(n * 24 * HOUR),
})

export const IGNORE_RULES: ReadonlyArray<IgnoreRule> = [
	rule(1, "maple", "external_id", "internal-*"),
	rule(2, "stripe", "domain", "hazel.sh"),
]
