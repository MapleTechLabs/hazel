/**
 * Core's side of the integration boundary (`docs/customers/integrations.md`): MRR source selection
 * generalised over the registry equals the two-provider logic it replaced, and what the open schemas
 * no longer refuse is refused at the handler or route.
 */
import { DEFAULT_CONNECTION_CONFIG } from "@hazel/customer-integrations"
import type { schema } from "@hazel/db"
import type { ConnectionConfig, CustomerProvider } from "@hazel/domain/customers"
import { SubscriptionStatus } from "@hazel/domain/customers"
import { Effect, type Scope } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/http"
import { describe, expect, it } from "vitest"
import { handleCustomersWebhook } from "../../../routes/customers-webhooks.http"
import { Directory } from "../../../services/directory"
import { ObjectStubs } from "../protocol"
import { pays } from "./facts"
import { billingProviderOf, billsNow } from "./snapshot"
import { makeCustomersWorld, ok, tagOf } from "./test-kit"

type Subscription = schema.CustomerSubscription

/** The function as it read before the registry, kept as the reference. */
const twoProviderBillingOf = (
	autumnReady: boolean,
	subscriptions: ReadonlyArray<Subscription>,
	stored: CustomerProvider | null,
): CustomerProvider => {
	const autumn = subscriptions.filter((sub) => sub.provider === "autumn")
	if (autumn.length === 0) return "stripe"
	const stripe = subscriptions.filter((sub) => sub.provider === "stripe")
	if (stripe.length === 0) return "autumn"
	if (autumnReady && autumn.some(billsNow)) return "autumn"
	if (stripe.some(billsNow)) return "stripe"
	if (stored !== null) return stored
	return autumnReady && autumn.some(pays) && !stripe.some(pays) ? "autumn" : "stripe"
}

/** Every status, priced or free, on usage or not, and a trial canceled before it converted. */
const variants = (provider: CustomerProvider): ReadonlyArray<Subscription> =>
	SubscriptionStatus.literals.flatMap((status) =>
		[0, 100].flatMap((mrrMinor) =>
			[false, true].flatMap((billsByUsage) =>
				[false, true].map(
					(unconverted) =>
						({
							provider,
							status,
							mrrMinor,
							billsByUsage,
							trialEndsAt: unconverted ? new Date("2026-02-01") : null,
							canceledAt: unconverted ? new Date("2026-01-15") : null,
							currentPeriodEnd: unconverted ? new Date("2026-01-20") : null,
						}) as Subscription,
				),
			),
		),
	)

/** No subscription, one, or any two of them. */
const holdings = (provider: CustomerProvider): ReadonlyArray<ReadonlyArray<Subscription>> => {
	const all = variants(provider)
	return [
		[],
		...all.map((sub) => [sub]),
		...all.flatMap((a, index) => all.slice(index + 1).map((b) => [a, b])),
	]
}

const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
	Effect.runPromise(Effect.scoped(effect) as Effect.Effect<A, E>)

describe("billingProviderOf", () => {
	it("equals the two-provider logic over every combination of what decides it", () => {
		// What the choice reads of one provider's subscriptions: whether it holds any, bills now, pays.
		const classes = (provider: CustomerProvider) => {
			const seen = new Map<string, ReadonlyArray<Subscription>>()
			for (const subs of holdings(provider)) {
				seen.set(`${subs.length > 0}:${subs.some(billsNow)}:${subs.some(pays)}`, subs)
			}
			return [...seen.values()]
		}
		const autumn = classes("autumn")
		const stripe = classes("stripe")
		// None; held but never paid; paid, not billing now; billing now.
		expect([autumn.length, stripe.length]).toEqual([4, 4])
		let compared = 0
		for (const ready of [false, true]) {
			for (const stored of [null, "stripe", "autumn"]) {
				for (const a of autumn) {
					for (const s of stripe) {
						for (const subscriptions of [
							[...a, ...s],
							[...s, ...a],
						]) {
							expect(
								billingProviderOf(new Set(ready ? ["autumn"] : []), subscriptions, stored),
							).toBe(twoProviderBillingOf(ready, subscriptions, stored))
							compared += 1
						}
					}
				}
			}
		}
		expect(compared).toBe(2 * 3 * autumn.length * stripe.length * 2)
	})

	it("equals it over every single subscription pair", () => {
		const autumn = [[], ...variants("autumn").map((sub) => [sub])]
		const stripe = [[], ...variants("stripe").map((sub) => [sub])]
		for (const ready of [false, true]) {
			for (const stored of [null, "stripe", "autumn"]) {
				for (const a of autumn) {
					for (const s of stripe) {
						const subscriptions = [...a, ...s]
						if (
							billingProviderOf(new Set(ready ? ["autumn"] : []), subscriptions, stored) !==
							twoProviderBillingOf(ready, subscriptions, stored)
						) {
							expect.fail(JSON.stringify({ ready, stored, subscriptions }))
						}
					}
				}
			}
		}
	})
})

describe("what the open schemas no longer refuse", () => {
	it("refuses a connect naming an unknown provider or a config its schema rejects", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				const connect = (provider: string, config: ConnectionConfig) =>
					world.call(
						"customers.connection.connect",
						{ provider, apiKey: "key", webhookSecret: null, config },
						world.owner,
					)
				const before = world.rows(`SELECT count(*) AS n FROM customer_connections`)
				expect(tagOf(yield* connect("nope", { _tag: "nope" }))).toBe(
					"CustomerProviderUnavailableError",
				)
				expect(tagOf(yield* connect("nope", DEFAULT_CONNECTION_CONFIG.clerk))).toBe(
					"CustomersInvalidRequestError",
				)
				expect(
					tagOf(yield* connect("maple", { ...DEFAULT_CONNECTION_CONFIG.maple, lookbackDays: 0 })),
				).toBe("CustomersInvalidRequestError")
				expect(world.rows(`SELECT count(*) AS n FROM customer_connections`)).toEqual(before)
			}),
		))

	it("stores a submitted config as its schema decodes it: defaults in, dropped keys out", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				const connectionId = world.connection("maple")
				world.object.storage.db
					.prepare(`UPDATE customer_connections SET externalAccountId = 'org_a:us' WHERE id = ?`)
					.run(connectionId)
				const legacy = {
					_tag: "maple",
					activityEvents: ["signed_in"],
					metricMappings: [],
					lookbackDays: 30,
					mapleOrgId: "org_a",
					accountKey: "GroupId",
					userKey: "UserId",
				}
				ok(
					yield* world.call(
						"customers.connection.update",
						{ connectionId, config: legacy },
						world.owner,
					),
				)
				const [row] = world.rows<{ config: string }>(
					`SELECT config FROM customer_connections WHERE id = '${connectionId}'`,
				)
				expect(JSON.parse(row!.config)).toEqual({
					_tag: "maple",
					region: "us",
					activityEvents: ["signed_in"],
					metricMappings: [],
					lookbackDays: 30,
				})
			}),
		))

	it("refuses attention settings naming an unknown source, writing nothing", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				const attention = () => world.rows(`SELECT attention FROM customer_settings`)
				const before = attention()
				const refused = yield* world.call(
					"customers.settings.update",
					{ attention: { stages: ["active"], requiredSources: ["nope"] } },
					world.owner,
				)
				expect(tagOf(refused)).toBe("InternalServerError")
				expect(attention()).toEqual(before)
				ok(
					yield* world.call(
						"customers.settings.update",
						{ attention: { stages: ["active"], requiredSources: ["autumn"] } },
						world.owner,
					),
				)
			}),
		))

	it("answers a webhook for an unknown provider 404, waking nothing", async () => {
		const response = await Effect.runPromise(
			handleCustomersWebhook.pipe(
				Effect.provideService(
					HttpServerRequest.HttpServerRequest,
					HttpServerRequest.fromWeb(
						new Request(
							"http://api.test/webhooks/customers/nope/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002",
							{ method: "POST", body: "{}" },
						),
					),
				),
				Effect.provideService(Directory, { org: () => Effect.die("looked up") } as never),
				Effect.provideService(ObjectStubs, { get: () => Effect.die("woken") } as never),
				Effect.map((answer) => HttpServerResponse.toWeb(answer)),
			),
		)
		expect(response.status).toBe(404)
	})
})
