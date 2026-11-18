/**
 * Gmail's `email` ops against the real `CustomerIngest`, in a `CustomersObject` on node SQLite:
 * an email lands on the account of a contact it names (case-insensitively), else on the one account
 * holding its domain; a domain two accounts share, a free-mail domain and the org's own addresses
 * place nothing; one thread read from two members' mailboxes lands once; and an email no customer
 * is on is dropped, never parked.
 */
import type { IngestOp, RecordEmail } from "@hazel/domain/customers"
import { Effect, type Scope } from "effect"
import { describe, expect, it } from "vitest"
import { type CustomersWorld, makeCustomersWorld } from "../test-kit"

const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
	Effect.runPromise(Effect.scoped(effect) as Effect.Effect<A, E>)

const ADA = "ada@hazel.sh"
const LIN = "lin@hazel.sh"

/** Clerk's view first: the customers, their domains, one contact. */
const clerkBefore: ReadonlyArray<IngestOp> = [
	{
		_tag: "account",
		externalId: "org_globex",
		name: "Globex",
		domains: ["globex.io"],
		sameAs: [],
		onNoMatch: "create",
	},
	{
		_tag: "contact",
		externalId: "user_grace",
		account: { provider: "clerk", externalId: "org_globex" },
		email: "Grace@Globex.io",
		name: "Grace",
	},
	{
		_tag: "account",
		externalId: "org_initech",
		name: "Initech",
		domains: ["initech.com"],
		sameAs: [],
		onNoMatch: "create",
	},
	{
		_tag: "account",
		externalId: "org_a",
		name: "Shared A",
		domains: ["shared.io"],
		sameAs: [],
		onNoMatch: "create",
	},
	{
		_tag: "account",
		externalId: "org_b",
		name: "Shared B",
		domains: ["shared.io"],
		sameAs: [],
		onNoMatch: "create",
	},
	// The org itself, as a Clerk organization: its own people's mail is never a customer's.
	{
		_tag: "account",
		externalId: "org_hazel",
		name: "Hazel",
		domains: ["hazel.sh"],
		sameAs: [],
		onNoMatch: "create",
	},
]

const email = (overrides: Partial<RecordEmail> & Pick<RecordEmail, "messageId">): RecordEmail => ({
	_tag: "email",
	externalId: `gmail-${overrides.messageId}`,
	threadId: `thread-${overrides.messageId}`,
	mailbox: ADA,
	direction: "inbound",
	from: { email: "grace@globex.io", name: "Grace" },
	to: [{ email: ADA, name: "Ada" }],
	cc: [],
	subject: "Renewal",
	snippet: "Can we talk?",
	bodyText: "Can we talk about the renewal?",
	occurredAt: "2026-06-14T09:30:00.000Z",
	...overrides,
})

const events = (world: CustomersWorld) =>
	world.rows<{ account: string; type: string; title: string; contact: string | null; data: string }>(
		`SELECT a.name AS account, e.type, e.title, c.email AS contact, e.data FROM customer_events e
		 JOIN customer_accounts a ON a.id = e.accountId LEFT JOIN customer_contacts c ON c.id = e.contactId
		 WHERE e.provider = 'gmail' ORDER BY a.name, e.type`,
	)

/** The events without their `data`. */
const timeline = (world: CustomersWorld) =>
	events(world).map(({ account, type, title, contact }) => ({ account, type, title, contact }))

const emailCount = (world: CustomersWorld) =>
	world.rows<{ n: number }>(`SELECT count(*) AS n FROM customer_emails`)[0]?.n

const setUp = Effect.gen(function* () {
	const world = yield* makeCustomersWorld
	yield* world.ingest("clerk", clerkBefore)
	const ada = world.connectGmail(ADA, world.member)
	const lin = world.connectGmail(LIN, world.owner)
	return { world, ada, lin }
})

describe("Gmail ingest", () => {
	it("places an email on the account of the contact it names, whatever the case", () =>
		run(
			Effect.gen(function* () {
				const { world, ada } = yield* setUp
				const report = yield* world.ingestGmail(ada, [email({ messageId: "m1" })])

				expect(report.stats.events).toBe(1)
				expect(timeline(world)).toEqual([
					{
						account: "Globex",
						type: "email.received",
						title: "Renewal",
						contact: "Grace@Globex.io",
					},
				])
				const stored = world.rows<{ id: string; mailbox: string; bodyText: string }>(
					`SELECT id, mailbox, bodyText FROM customer_emails`,
				)
				expect(stored).toEqual([
					{ id: expect.any(String), mailbox: ADA, bodyText: "Can we talk about the renewal?" },
				])
				expect(JSON.parse(events(world)[0]!.data)).toEqual({
					emailId: stored[0]!.id,
					direction: "inbound",
					snippet: "Can we talk?",
					from: { email: "grace@globex.io", name: "Grace" },
					to: [{ email: ADA, name: "Ada" }],
					cc: [],
				})
			}),
		))

	it("falls back to the one account holding the domain", () =>
		run(
			Effect.gen(function* () {
				const { world, ada } = yield* setUp
				yield* world.ingestGmail(ada, [
					email({
						messageId: "m2",
						direction: "outbound",
						from: { email: ADA, name: "Ada" },
						to: [{ email: "joe@initech.com", name: null }],
						subject: "Quote",
					}),
				])
				expect(timeline(world)).toEqual([
					{ account: "Initech", type: "email.sent", title: "Quote", contact: null },
				])
			}),
		))

	it("drops mail of a shared domain, a free-mail domain or only the org's own people", () =>
		run(
			Effect.gen(function* () {
				const { world, ada } = yield* setUp
				const report = yield* world.ingestGmail(ada, [
					email({ messageId: "shared", from: { email: "x@shared.io", name: null } }),
					email({ messageId: "free", from: { email: "someone@gmail.com", name: null } }),
					email({
						messageId: "internal",
						from: { email: LIN, name: "Lin" },
						cc: [{ email: "team@hazel.sh", name: null }],
					}),
				])

				expect(report.outcomes.map((outcome) => outcome._tag)).toEqual([
					"Ignored",
					"Ignored",
					"Ignored",
				])
				expect(report.stats).toMatchObject({ events: 0, unmatched: 0 })
				expect(events(world)).toEqual([])
				expect(emailCount(world)).toBe(0)
				expect(world.rows(`SELECT id FROM customer_unmatched_records`)).toEqual([])
			}),
		))

	it("counts mail from another connected mailbox as sent, and lands a thread two mailboxes hold once", () =>
		run(
			Effect.gen(function* () {
				const { world, ada, lin } = yield* setUp
				// Lin wrote to Grace with Ada in copy: Ada's mailbox reads it as received, Lin's as sent.
				const sent = {
					messageId: "m3",
					from: { email: LIN, name: "Lin" },
					to: [{ email: "grace@globex.io", name: "Grace" }],
					cc: [{ email: ADA, name: "Ada" }],
				}
				yield* world.ingestGmail(ada, [email({ ...sent, direction: "inbound" })])
				const again = yield* world.ingestGmail(lin, [
					email({ ...sent, mailbox: LIN, direction: "outbound", externalId: "lin-copy" }),
				])
				const replay = yield* world.ingestGmail(ada, [email({ ...sent, direction: "inbound" })])

				expect(timeline(world)).toEqual([
					{ account: "Globex", type: "email.sent", title: "Renewal", contact: "Grace@Globex.io" },
				])
				expect(emailCount(world)).toBe(1)
				expect(again.outcomes[0]?._tag).toBe("Unchanged")
				expect(replay.outcomes[0]?._tag).toBe("Unchanged")
			}),
		))

	it("lands one event on each account an email names", () =>
		run(
			Effect.gen(function* () {
				const { world, ada } = yield* setUp
				yield* world.ingestGmail(ada, [
					email({ messageId: "m4", cc: [{ email: "joe@initech.com", name: null }] }),
				])
				expect(events(world).map((row) => row.account)).toEqual(["Globex", "Initech"])
				expect(emailCount(world)).toBe(1)
			}),
		))
})
