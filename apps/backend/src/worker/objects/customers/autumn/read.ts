/**
 * Reading one Autumn customer's current state, and turning a page of plans into subscription ops:
 * the path a webhook delivery takes (`./webhook.ts`), and the one the pull's subscription phase
 * shares with it (`./pull.ts`).
 *
 * A customer read answers the account, its feature usage (`balances`, with the features' names
 * expanded so a metric is named after its feature) and its live plans; `withExpired` adds the plans
 * that have ended, which only `POST /v1/subscriptions.list` reports — a customer lists its `active`,
 * `past_due` and `scheduled` plans and nothing else (`RELEVANT_STATUSES` in Autumn's server), so
 * without that read a plan that ended while no delivery arrived would keep its MRR for ever.
 *
 * Plan prices come from `POST /v1/plans.list` (archived plans included: a grandfathered customer is
 * still on one), read once per delivery or page, and only when there is a plan to price.
 */
import type { IngestOp, IsoTimestamp } from "@hazel/domain/customers"
import { Effect, Option } from "effect"
import { type CustomerProviderError, CustomerWebhookRejectedError } from "../provider-errors"
import type { AutumnApi } from "./http"
import { customerOps, featureNamesOf, plansById, subscriptionOp } from "./map"
import {
	AutumnCustomer,
	type AutumnEnv,
	AutumnOrganization,
	AutumnPlansPage,
	type AutumnSubscription,
	AutumnSubscriptionsPage,
} from "./wire"

/** Autumn's own fallback when an organization has set no currency (`orgToCurrency`). */
const DEFAULT_CURRENCY = "usd"

/** Every plan state a subscription row can be in: the full picture of what a customer holds. */
export const ALL_SUBSCRIPTION_STATUSES = ["active", "past_due", "scheduled", "expired"] as const

/** Autumn's ceiling for `subscriptions.list`. */
export const SUBSCRIPTIONS_PAGE_SIZE = 200

/**
 * What it takes to price a plan: the active (else only) version of every plan, archived ones
 * included (a grandfathered customer is still on one), and the currency Autumn quotes plan amounts
 * in — the organization's `default_currency`, which neither a plan nor a customer carries. Read
 * together, so pricing a page or a delivery costs two requests however many plans it holds.
 */
export const readPricing = Effect.fn("Autumn.readPricing")(function* (api: AutumnApi) {
	const [plans, organization] = yield* Effect.all(
		[
			api.post("/v1/plans.list", { include_archived: true }, AutumnPlansPage),
			api.get("/v1/organization", [], AutumnOrganization),
		],
		{ concurrency: 2 },
	)
	return {
		plans: plansById(plans.list),
		currency: (organization.default_currency ?? DEFAULT_CURRENCY).toLowerCase(),
	}
})

/** Subscription ops for a batch of rows, priced from one lookup; `[]` needs no lookup at all. */
export const subscriptionOpsOf = Effect.fn("Autumn.subscriptionOps")(function* (
	api: AutumnApi,
	subscriptions: ReadonlyArray<AutumnSubscription>,
	options: { readonly customerId?: string; readonly observedAt: IsoTimestamp },
) {
	if (subscriptions.length === 0) return [] as Array<IngestOp>
	const { plans, currency } = yield* readPricing(api)
	return subscriptions.flatMap((subscription) => {
		const op = subscriptionOp(subscription, { ...options, plans, currency })
		return op === null ? [] : [op]
	})
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
 * organization's customer, or one deleted since.
 *
 * The customer's `env` is checked against the environment the key opens, and a mismatch is refused
 * rather than written: Autumn stamps a delivery with neither organization nor environment, so this
 * is what stops a sandbox endpoint's signing secret, pasted next to a live key, writing test data
 * into a production connection.
 */
export const readCustomer = Effect.fn("Autumn.readCustomer")(function* (input: {
	readonly api: AutumnApi
	readonly customerId: string
	readonly env: AutumnEnv
	readonly config: Parameters<typeof customerOps>[1]["config"]
	readonly at: Date
	readonly observedAt: IsoTimestamp
	readonly withExpired: boolean
}): Effect.fn.Return<Option.Option<CustomerState>, CustomerProviderError | CustomerWebhookRejectedError> {
	const read = yield* current(
		input.api.post(
			"/v1/customers.get",
			{ customer_id: input.customerId, expand: ["balances.feature"] },
			AutumnCustomer,
		),
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
	const id = customer.id ?? input.customerId
	const named = { ...customer, id }
	const names = featureNamesOf(
		Object.values(customer.balances ?? {}).map((balance) => ({
			id: balance.feature_id,
			name: balance.feature?.name ?? null,
		})),
	)
	const live = customer.subscriptions ?? []
	const expired = input.withExpired ? yield* expiredSubscriptionsOf(input.api, id) : []
	const subscriptions = yield* subscriptionOpsOf(input.api, [...live, ...expired], {
		customerId: id,
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
const expiredSubscriptionsOf = Effect.fnUntraced(function* (api: AutumnApi, customerId: string) {
	const page = yield* api.post(
		"/v1/subscriptions.list",
		{ customer_id: customerId, statuses: ["expired"], limit: SUBSCRIPTIONS_PAGE_SIZE },
		AutumnSubscriptionsPage,
	)
	return page.list
})
