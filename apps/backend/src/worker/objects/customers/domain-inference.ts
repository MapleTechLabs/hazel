/**
 * A company domain for accounts no source gave one, guessed from their members' work emails
 * (`docs/customers/enrichment.md`, "Domains from member emails"). Clerk only sends verified
 * organization domains and a Stripe billing email teaches none when the customer names its Clerk
 * organization, so most accounts have no domain while their members sign in as `@acme.com`.
 *
 * Runs on each compute turn, before `seedEnrichments`, so a guessed domain is looked up the same turn.
 * Only an account with no domains and whose domains no admin edited (`fieldSources.domains`): an
 * admin who changes or removes a guess is never overruled.
 */
import { Database, SQLite, schema } from "@hazel/db"
import { normalizeDomain } from "@hazel/domain/customers"
import type { CustomerAccountId } from "@hazel/schema"
import { Effect } from "effect"

/**
 * A domain among the contacts of this many customers or more (an environment group counts once) is
 * not one company's: the workspace's own staff invited into customers' orgs, an agency's, a
 * university's. It is never guessed.
 */
export const SHARED_DOMAIN_CUSTOMERS = 4

/** A provider role that runs the org (Clerk `org:admin`): its email speaks for the company more. */
const isAdminRole = (role: string | null) => role !== null && /admin|owner/i.test(role)

export interface MemberEmail {
	readonly email: string | null
	readonly role: string | null
}

/** The company domain of an email, or null for none or a mail provider's. */
export const workDomainOf = (email: string | null): string | null => {
	const at = email?.lastIndexOf("@") ?? -1
	return email == null || at < 0 ? null : normalizeDomain(email.slice(at + 1))
}

/**
 * The account's domain from its members: the work domain with the most weight (an admin's email
 * counts twice), only when it leads every other one. Domains in `shared` do not count (a staff
 * member invited to help does not outvote the founder). Null when the members use mail providers
 * only, or no domain clearly wins.
 */
export const inferDomain = (
	members: ReadonlyArray<MemberEmail>,
	shared: ReadonlySet<string>,
): string | null => {
	const weights = new Map<string, number>()
	for (const member of members) {
		const domain = workDomainOf(member.email)
		if (domain === null || shared.has(domain)) continue
		weights.set(domain, (weights.get(domain) ?? 0) + (isAdminRole(member.role) ? 2 : 1))
	}
	const ranked = [...weights].sort(([, a], [, b]) => b - a)
	const [first, second] = ranked
	if (first === undefined) return null
	return second !== undefined && second[1] === first[1] ? null : first[0]
}

/** Give each live account with no domain (and none an admin edited) the one its members' emails show. */
export const inferAccountDomains = Effect.fn("CustomersObject.inferAccountDomains")(function* (now: Date) {
	const db = yield* Database.Database
	const accounts = yield* db.run(
		SQLite.from(schema.customerAccountsTable)
			.select("id", "domains", "fieldSources", "primaryAccountId")
			.where(($) => [$.deletedAt.isNull()]),
	)
	const pending = accounts.filter(
		(account) => account.domains.length === 0 && account.fieldSources.domains === undefined,
	)
	if (pending.length === 0) return 0
	const customerOf = new Map<CustomerAccountId, CustomerAccountId>(
		accounts.map((account) => [account.id, account.primaryAccountId ?? account.id]),
	)
	const contacts = yield* db.run(
		SQLite.from(schema.customerContactsTable)
			.select("accountId", "email", "role")
			.where(($) => [$.deletedAt.isNull(), $.email.isNotNull()]),
	)
	const membersOf = new Map<CustomerAccountId, Array<MemberEmail>>()
	const customersOfDomain = new Map<string, Set<CustomerAccountId>>()
	for (const contact of contacts) {
		const customer = customerOf.get(contact.accountId)
		// A contact of a deleted account.
		if (customer === undefined) continue
		const list = membersOf.get(contact.accountId) ?? []
		list.push(contact)
		membersOf.set(contact.accountId, list)
		const domain = workDomainOf(contact.email)
		if (domain === null) continue
		const customers = customersOfDomain.get(domain) ?? new Set()
		customers.add(customer)
		customersOfDomain.set(domain, customers)
	}
	const shared = new Set(
		[...customersOfDomain]
			.filter(([, customers]) => customers.size >= SHARED_DOMAIN_CUSTOMERS)
			.map(([domain]) => domain),
	)
	let inferred = 0
	for (const account of pending) {
		const domain = inferDomain(membersOf.get(account.id) ?? [], shared)
		if (domain === null) continue
		// In a transaction with its re-read: an admin's edit since the read above wins.
		const wrote = yield* db.transaction(
			Effect.gen(function* () {
				const current = yield* db.first(
					SQLite.from(schema.customerAccountsTable)
						.select("domains", "fieldSources")
						.where(($) => [$.id.eq(account.id), $.deletedAt.isNull()])
						.limit(1),
				)
				if (
					current._tag === "None" ||
					current.value.domains.length > 0 ||
					current.value.fieldSources.domains !== undefined
				) {
					return false
				}
				yield* db.run(
					SQLite.update(schema.customerAccountsTable)
						.set({ domains: [domain], updatedAt: now })
						.where(($) => [$.id.eq(account.id)]),
				)
				yield* db.run(
					SQLite.insertInto(schema.customerEventsTable).values({
						accountId: account.id,
						provider: "hazel",
						type: "account.domain_inferred",
						title: `Domain ${domain} found from member emails`,
						data: { domain },
						occurredAt: now,
					}),
				)
				return true
			}),
		)
		if (wrote) inferred++
	}
	yield* Effect.annotateCurrentSpan({ "domains.pending": pending.length, "domains.inferred": inferred })
	return inferred
})
