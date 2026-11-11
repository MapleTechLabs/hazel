/**
 * Reading one Autumn customer's current state, and pricing plans: the path a webhook delivery takes
 * (`./webhook.ts`), and the pieces the pull shares with it (`./pull.ts`).
 *
 * A customer read answers the account, its feature usage (`balances`, with the features' names
 * expanded so a metric is named after its feature, and the prepaid units its plans are billed for)
 * and its live plans, each expanded to the customer's own version of the plan (custom prices
 * included). The plans that ended come from `POST /v1/subscriptions.list` — a customer lists its
 * `active`, `past_due` and `scheduled` plans and nothing else (`RELEVANT_STATUSES` in Autumn's
 * server), so without that read a plan that ended while no delivery arrived would keep its MRR for
 * ever.
 *
 * Plan prices for a row the read did not expand come from `POST /v1/plans.list` (archived plans
 * included: a grandfathered customer is still on one), and the currency from
 * `GET /v1/organization`. Both change rarely, so the adapter keeps them a few minutes per
 * connection ({@link cachedPricing}).
 */
import type { ConnectionConfig, IngestOp, IsoTimestamp } from "@hazel/domain/customers"
import { Clock, Effect, Option } from "effect"
import { type CustomerProviderError, CustomerWebhookRejectedError } from "../provider-errors"
import type { AutumnApi } from "./http"
import { customerOps, featureNamesOf, plansById, type Pricing, subscriptionOps } from "./map"
import {
	AutumnCustomer,
	type AutumnEnv,
	AutumnOrganization,
	AutumnPlansPage,
	AutumnSubscriptionsPage,
} from "./wire"

/** Autumn's own fallback when an organization has set no currency (`orgToCurrency`). */
const DEFAULT_CURRENCY = "usd"

/** Autumn's ceiling for `subscriptions.list`. */
export const SUBSCRIPTIONS_PAGE_SIZE = 200

/**
 * What a customer read expands: the features' names on its balances, and each live plan's own
 * version. `customers.list` honours the same `expand` in its body.
 */
export const CUSTOMER_EXPAND = ["balances.feature", "subscriptions.plan"]

/**
 * The active (else only) version of every plan, archived ones included, and the currency Autumn
 * quotes plan amounts in — the organization's `default_currency`, which neither a plan nor a
 * customer carries. Read together.
 */
export const readPricing = (api: AutumnApi): Effect.Effect<Pricing, CustomerProviderError> =>
	Effect.all(
		[
			api.post("/v1/plans.list", { include_archived: true }, AutumnPlansPage),
			api.get("/v1/organization", [], AutumnOrganization),
		],
		{ concurrency: 2 },
	).pipe(
		Effect.map(([plans, organization]) => ({
			plans: plansById(plans.list),
			currency: (organization.default_currency ?? DEFAULT_CURRENCY).toLowerCase(),
		})),
		Effect.withSpan("Autumn.readPricing"),
	)

/** How long a connection's pricing is reused: a plan edit shows up within this. */
const PRICING_TTL_MS = 5 * 60_000

/** Per isolate, keyed by the provider account (`<organization id>:<env>`): pricing is no secret. */
const pricing = new Map<string, { readonly expiresAt: number; readonly value: Pricing }>()

/** `read`'s result, reused for {@link PRICING_TTL_MS} for the same Autumn account. */
export const cachedPricing = (
	accountId: string,
	read: Effect.Effect<Pricing, CustomerProviderError>,
): Effect.Effect<Pricing, CustomerProviderError> =>
	Effect.gen(function* () {
		const now = yield* Clock.currentTimeMillis
		const held = pricing.get(accountId)
		if (held !== undefined && held.expiresAt > now) return held.value
		const value = yield* read
		for (const [key, entry] of pricing) if (entry.expiresAt <= now) pricing.delete(key)
		pricing.set(accountId, { expiresAt: now + PRICING_TTL_MS, value })
		return value
	})

/** A read's result; `None` when Autumn does not know the object under this key (404). */
const current = <A>(read: Effect.Effect<A, CustomerProviderError>) =>
	read.pipe(
		Effect.map(Option.some),
		Effect.catchTag("CustomerProviderError", (error) =>
			error.httpStatus === 404 ? Effect.succeed(Option.none<A>()) : Effect.fail(error),
		),
	)

export interface CustomerState {
	/** The account, its usage metrics and its plans, in the order ingest needs them. */
	readonly ops: ReadonlyArray<IngestOp>
	/** Feature id → name, as the customer's balances carry them (for an event's title). */
	readonly names: Map<string, string>
}

/**
 * One customer as Autumn has it now. `None` when Autumn does not know it under this key: another
 * organization's or environment's customer, or one deleted since; or when it has no id of its own. `expired` reads the customer's
 * ended plans too (only those of `planId` when given), alongside the customer.
 *
 * The customer's `env` is checked against the environment the key opens, and a mismatch is refused
 * rather than written. A key only ever reads its own environment's customers, so this is a
 * backstop, not what keeps another environment's deliveries out (see `docs/customers/autumn.md`).
 */
export const readCustomer = Effect.fn("Autumn.readCustomer")(function* (input: {
	readonly api: AutumnApi
	readonly pricing: Effect.Effect<Pricing, CustomerProviderError>
	readonly customerId: string
	readonly env: AutumnEnv
	readonly config: ConnectionConfig
	readonly at: Date
	readonly observedAt: IsoTimestamp
	readonly expired: Option.Option<{ readonly planId: string | null }>
}): Effect.fn.Return<Option.Option<CustomerState>, CustomerProviderError | CustomerWebhookRejectedError> {
	const [read, ended] = yield* Effect.all(
		[
			current(
				input.api.post(
					"/v1/customers.get",
					{ customer_id: input.customerId, expand: CUSTOMER_EXPAND },
					AutumnCustomer,
				),
			),
			Option.match(input.expired, {
				onNone: () => Effect.succeed([]),
				onSome: ({ planId }) => expiredSubscriptionsOf(input.api, input.customerId, planId),
			}),
		],
		{ concurrency: 2 },
	)
	if (Option.isNone(read)) return Option.none()
	const customer = read.value
	if (customer.env != null && customer.env !== input.env) {
		yield* Effect.logWarning("Autumn customer refused", {
			reason: "env_mismatch",
			env: customer.env,
			expected: input.env,
		})
		return yield* new CustomerWebhookRejectedError({
			message:
				input.env === "live"
					? "The customer is in Autumn's sandbox, and the connection's key is a live one"
					: "The customer is in Autumn's live environment, and the connection's key is a sandbox one",
		})
	}
	// An id-less customer (Autumn keys it by its internal id) is none a pull imports either.
	const id = customer.id
	if (id == null || id === "") return Option.none()
	const named = { ...customer, id }
	const names = featureNamesOf(
		Object.values(customer.balances ?? {}).map((balance) => ({
			id: balance.feature_id,
			name: balance.feature?.name ?? null,
		})),
	)
	const plans = [...(customer.subscriptions ?? []), ...ended]
	const subscriptions =
		plans.length === 0
			? []
			: subscriptionOps(plans, {
					customerId: id,
					pricing: yield* input.pricing,
					balances: Object.values(customer.balances ?? {}),
					observedAt: input.observedAt,
				})
	return Option.some({
		ops: [
			...customerOps(named, {
				config: input.config,
				env: input.env,
				names,
				at: input.at,
				observedAt: input.observedAt,
			}),
			...subscriptions,
		],
		names,
	})
})

/**
 * The plans this customer has ended. One page is enough: a customer with more than
 * {@link SUBSCRIPTIONS_PAGE_SIZE} expired plans has the rest reconciled by the next pull, whose
 * subscription phase lists every row of the organization.
 */
const expiredSubscriptionsOf = (api: AutumnApi, customerId: string, planId: string | null) =>
	api
		.post(
			"/v1/subscriptions.list",
			{
				customer_id: customerId,
				statuses: ["expired"],
				limit: SUBSCRIPTIONS_PAGE_SIZE,
				// Absent from the JSON when no single plan ended.
				plan_id: planId ?? undefined,
			},
			AutumnSubscriptionsPage,
		)
		.pipe(Effect.map((page) => page.list))
