/**
 * The Stripe mapping against the real `CustomerIngest`, in a `CustomersObject` on node SQLite: a
 * customer has to land on the account its Clerk organization id names, its billing contact has to
 * merge into the member who already has that email, its subscription and invoice have to resolve
 * the account through the refs, the timeline entries ingest raises have to appear, and a
 * redelivery has to change nothing.
 */
import type { IngestOp } from "@hazel/domain/customers"
import { Effect, Schema, type Scope } from "effect"
import { describe, expect, it } from "vitest"
import { type CustomersWorld, makeCustomersWorld } from "../test-kit"
import {
	CUSTOMER_ACME,
	CUSTOMER_GLOBEX,
	CUSTOMER_PERSONAL,
	INVOICE_ACME_PAID,
	INVOICE_GLOBEX_OPEN,
	ORG_ACME,
	PRODUCT_PRO,
	PRODUCT_SEATS,
	SUB_ACME,
	SUB_GLOBEX,
} from "./fixtures"
import { accountDeletedOp, customerOps, invoiceOp, subscriptionOp } from "./map"
import { StripeCustomer, StripeInvoice, StripeSubscription } from "./wire"

const CONFIG = {
	_tag: "stripe",
	clerkOrgMetadataKey: "clerk_org_id",
	matchByDomain: true,
	accountId: "",
} as const

const customer = Schema.decodeUnknownSync(StripeCustomer)
const subscription = Schema.decodeUnknownSync(StripeSubscription)
const invoice = Schema.decodeUnknownSync(StripeInvoice)

const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
	Effect.runPromise(Effect.scoped(effect) as Effect.Effect<A, E>)

const PRODUCTS = new Map([
	[PRODUCT_PRO.id, "Pro"],
	[PRODUCT_SEATS.id, "Extra seats"],
])

/** What Clerk established before Stripe ever ran: the organization and one of its members. */
const clerkBefore: ReadonlyArray<IngestOp> = [
	{
		_tag: "account",
		externalId: ORG_ACME,
		name: "Acme Analytics",
		domains: ["acme.com"],
		sameAs: [],
		onNoMatch: "create",
	},
	{
		_tag: "contact",
		externalId: "user_2ada000000000000000000",
		account: { provider: "clerk", externalId: ORG_ACME },
		email: "billing@acme.com",
		name: "Ada Lovelace",
	},
]

/** A whole Stripe backfill of the fixture account, in the order the pull produces it. */
const backfill: ReadonlyArray<IngestOp> = [
	...customerOps(customer(CUSTOMER_ACME), CONFIG, "2026-11-10T12:00:00.000Z"),
	...customerOps(customer(CUSTOMER_GLOBEX), CONFIG, "2026-11-10T12:00:00.000Z"),
	...customerOps(customer(CUSTOMER_PERSONAL), CONFIG, "2026-11-10T12:00:00.000Z"),
	subscriptionOp(subscription(SUB_ACME), PRODUCTS)!,
	subscriptionOp(subscription(SUB_GLOBEX), PRODUCTS)!,
	invoiceOp(invoice(INVOICE_ACME_PAID))!,
	invoiceOp(invoice(INVOICE_GLOBEX_OPEN))!,
]

const accounts = (world: CustomersWorld) =>
	world.rows<{ name: string; domains: string; planName: string | null; mrrMinor: number }>(
		`SELECT name, domains, planName, mrrMinor FROM customer_accounts WHERE deletedAt IS NULL ORDER BY name`,
	)

const refs = (world: CustomersWorld) =>
	world.rows<{ provider: string; externalId: string; entityType: string; matchMethod: string }>(
		`SELECT provider, externalId, entityType, matchMethod FROM customer_external_refs ORDER BY provider, entityType, externalId`,
	)

const contacts = (world: CustomersWorld) =>
	world.rows<{ email: string | null; name: string | null; isBillingContact: number }>(
		`SELECT email, name, isBillingContact FROM customer_contacts WHERE deletedAt IS NULL ORDER BY email`,
	)

const subscriptions = (world: CustomersWorld) =>
	world.rows<{ planName: string | null; status: string; mrrMinor: number; currency: string }>(
		`SELECT planName, status, mrrMinor, currency FROM customer_subscriptions ORDER BY mrrMinor DESC`,
	)

const invoices = (world: CustomersWorld) =>
	world.rows<{ number: string | null; status: string; amountDueMinor: number; hostedUrl: string | null }>(
		`SELECT number, status, amountDueMinor, hostedUrl FROM customer_invoices ORDER BY number`,
	)

const events = (world: CustomersWorld) =>
	world.rows<{ type: string; title: string }>(
		`SELECT type, title FROM customer_events ORDER BY type, title`,
	)

const unmatched = (world: CustomersWorld) =>
	world.rows<{ entityType: string; externalId: string; label: string | null; reason: string }>(
		`SELECT entityType, externalId, label, reason FROM customer_unmatched_records WHERE status = 'open' ORDER BY entityType, externalId`,
	)

describe("Stripe ops through CustomerIngest", () => {
	it("lands the billing data on the account its Clerk organization id names", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				yield* world.ingest("clerk", clerkBefore)
				const report = yield* world.ingest("stripe", backfill)

				// Acme matched by the shared id Autumn wrote into the customer's metadata.
				expect(refs(world).filter((ref) => ref.provider === "stripe")).toEqual([
					{
						provider: "stripe",
						externalId: CUSTOMER_ACME.id,
						entityType: "account",
						matchMethod: "shared_id",
					},
					{
						provider: "stripe",
						externalId: CUSTOMER_ACME.id,
						entityType: "contact",
						matchMethod: "existing",
					},
				])
				expect(accounts(world)).toEqual([
					{ name: "Acme Analytics", domains: '["acme.com"]', planName: null, mrrMinor: 0 },
				])

				// The billing contact is the member who already had that email, not a second row.
				expect(contacts(world)).toEqual([
					{ email: "billing@acme.com", name: "Ada Lovelace", isBillingContact: 1 },
				])

				expect(subscriptions(world)).toEqual([
					{ planName: "Pro", status: "active", mrrMinor: 120_000, currency: "usd" },
				])
				expect(invoices(world)).toEqual([
					{
						number: "HAZEL-0001",
						status: "paid",
						amountDueMinor: 120_000,
						hostedUrl: INVOICE_ACME_PAID.hosted_invoice_url,
					},
				])
				// Ingest raises the billing timeline itself; the adapter sends no event ops.
				expect(events(world)).toEqual([
					{ type: "contact.joined", title: "Ada Lovelace joined" },
					{ type: "invoice.paid", title: "HAZEL-0001 paid" },
					{ type: "subscription.started", title: "Started Pro" },
				])
				// Globex, the personal customer and its contact, and the two billing rows behind Globex.
				expect(report.outcomes.filter((outcome) => outcome._tag === "Unmatched")).toHaveLength(5)
			}),
		))

	it("parks a customer no organization claims, with its subscription and invoice", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				yield* world.ingest("clerk", clerkBefore)
				yield* world.ingest("stripe", backfill)
				expect(unmatched(world)).toEqual([
					{
						entityType: "account",
						externalId: CUSTOMER_GLOBEX.id,
						label: CUSTOMER_GLOBEX.id,
						reason: "No customer matches its ids or domain",
					},
					{
						entityType: "account",
						externalId: CUSTOMER_PERSONAL.id,
						// A free-mail domain is no company domain: ingest drops it.
						label: "Grace Hopper",
						reason: "No customer matches its ids or domain",
					},
					{
						entityType: "contact",
						externalId: CUSTOMER_PERSONAL.id,
						label: "grace.hopper@gmail.com",
						reason: `Its account (stripe ${CUSTOMER_PERSONAL.id}) is not linked to a customer`,
					},
					{
						entityType: "invoice",
						externalId: INVOICE_GLOBEX_OPEN.id,
						label: "HAZEL-0002",
						reason: `Its customer (stripe ${CUSTOMER_GLOBEX.id}) is not linked`,
					},
					{
						entityType: "subscription",
						externalId: SUB_GLOBEX.id,
						label: "Extra seats",
						reason: `Its customer (stripe ${CUSTOMER_GLOBEX.id}) is not linked`,
					},
				])
			}),
		))

	it("replays a parked customer's billing when a human links it", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				yield* world.ingest("clerk", clerkBefore)
				yield* world.ingest("stripe", backfill)
				const parked = unmatched(world).find((row) => row.externalId === CUSTOMER_GLOBEX.id)!
				const recordId = world.rows<{ id: string }>(
					`SELECT id FROM customer_unmatched_records WHERE externalId = ?`,
					parked.externalId,
				)[0]!.id
				const accountId = world.rows<{ id: string }>(
					`SELECT id FROM customer_accounts WHERE deletedAt IS NULL`,
				)[0]!.id
				const exit = yield* world.call(
					"customers.unmatched.link",
					{ recordId, accountId },
					world.owner,
				)
				expect(exit._tag).toBe("Success")
				// The subscription and the invoice that were waiting on it are applied.
				expect(subscriptions(world).map((row) => row.planName)).toEqual(["Pro", "Extra seats"])
				expect(invoices(world).map((row) => row.number)).toEqual(["HAZEL-0001", "HAZEL-0002"])
			}),
		))

	it("matches a customer by its email domain when no shared id names one", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				yield* world.ingest("clerk", clerkBefore)
				const noMetadata = { ...CUSTOMER_ACME, id: "cus_2bydomain00001", metadata: {} }
				const report = yield* world.ingest(
					"stripe",
					customerOps(customer(noMetadata), CONFIG, "2026-11-10T12:00:00.000Z"),
				)
				expect(report.outcomes.map((outcome) => outcome._tag)).toEqual(["Updated", "Updated"])
				expect(
					refs(world).find(
						(ref) => ref.externalId === "cus_2bydomain00001" && ref.entityType === "account",
					),
				).toMatchObject({ matchMethod: "domain" })
			}),
		))

	it("parks a customer the connection refuses to match by domain", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				yield* world.ingest("clerk", clerkBefore)
				const noMetadata = { ...CUSTOMER_ACME, id: "cus_2bydomain00002", metadata: {} }
				// The op still carries the domain; the connection's config is what turns matching off.
				const ops = customerOps(customer(noMetadata), CONFIG, "2026-11-10T12:00:00.000Z")
				world.object.storage.db
					.prepare(`UPDATE customer_connections SET config = ? WHERE provider = 'stripe'`)
					.run(JSON.stringify({ ...CONFIG, matchByDomain: false }))
				const report = yield* world.ingest("stripe", ops)
				expect(report.outcomes.map((outcome) => outcome._tag)).toEqual(["Unmatched", "Unmatched"])
			}),
		))

	it("keeps a newer read of a subscription or invoice over an older one applied after it", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				yield* world.ingest("clerk", clerkBefore)
				yield* world.ingest("stripe", backfill)
				const newer = "2026-11-10T13:00:00.000Z"
				const older = "2026-11-10T12:30:00.000Z"
				// A webhook read the cancellation and the voided invoice...
				yield* world.ingest("stripe", [
					subscriptionOp(subscription({ ...SUB_ACME, status: "canceled" }), PRODUCTS, newer)!,
					invoiceOp(invoice({ ...INVOICE_ACME_PAID, status: "void" }), { observedAt: newer })!,
				])
				// ...then a pull page that read both before them lands.
				const late = yield* world.ingest("stripe", [
					subscriptionOp(subscription(SUB_ACME), PRODUCTS, older)!,
					invoiceOp(invoice(INVOICE_ACME_PAID), { observedAt: older })!,
				])
				expect(late.outcomes.map((outcome) => outcome._tag)).toEqual(["Unchanged", "Unchanged"])
				expect(subscriptions(world).map((row) => row.status)).toContain("canceled")
				expect(invoices(world).map((row) => row.status)).toEqual(["void"])
			}),
		))

	it("changes nothing on a redelivery, and nothing at all for a late delete", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				yield* world.ingest("clerk", clerkBefore)
				yield* world.ingest("stripe", backfill)
				const again = yield* world.ingest("stripe", backfill)
				expect(
					again.outcomes.filter(
						(outcome) => outcome._tag !== "Unchanged" && outcome._tag !== "Unmatched",
					),
				).toEqual([])
				expect(events(world)).toHaveLength(3)

				// The customer is deleted (dated by its event), then an older delivery of it arrives again.
				yield* world.ingest("stripe", [
					accountDeletedOp(CUSTOMER_ACME.id, "2026-11-10T12:00:00.000Z"),
				])
				const late = yield* world.ingest("stripe", [
					...customerOps(customer(CUSTOMER_ACME), CONFIG, "2026-11-10T11:00:00.000Z"),
				])
				expect(late.outcomes[0]!._tag).toBe("Unchanged")
				// The Clerk ref keeps the account alive, with Stripe's own ref stale.
				const staleRefs = () =>
					world.rows<{ n: number }>(
						`SELECT count(*) AS n FROM customer_external_refs WHERE provider = 'stripe' AND entityType = 'account' AND staleAt IS NOT NULL`,
					)
				expect(staleRefs()).toEqual([{ n: 1 }])
				// A sighting after the deletion (the customer was restored) revives the ref.
				yield* world.ingest(
					"stripe",
					customerOps(customer(CUSTOMER_ACME), CONFIG, "2026-11-10T13:00:00.000Z"),
				)
				expect(staleRefs()).toEqual([{ n: 0 }])
			}),
		))
})
