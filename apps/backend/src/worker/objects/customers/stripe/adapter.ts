/**
 * The Stripe data source (`docs/customers/tech-design.md` §5), Hazel's billing source for
 * Customers: Stripe customers land on the accounts the identity source created, and their
 * subscriptions and invoices become the MRR, the plan, the trial and the payment state every
 * billing signal and the health score's billing component read.
 *
 * Connecting needs a Stripe **restricted key** (`rk_live_…` / `rk_test_…`, or a secret key) with
 * read access to customers, products, subscriptions and invoices, and, for live updates, the
 * signing secret of a Stripe webhook endpoint pointed at
 * `/webhooks/customers/stripe/:organizationId/:connectionId`. Both are stored encrypted
 * (`../credentials.ts`) and only ever decrypted to call Stripe or verify a delivery.
 *
 * Nothing here writes the store: `webhook` and `pull` produce `IngestOp`s and `CustomerIngest`
 * applies them.
 */
import { Effect, Option, Redacted } from "effect"
import { HttpClient } from "effect/http"
import type { CustomerProviderAdapter, ProviderCredentials } from "../providers"
import { makeStripeGet, type StripeGet } from "./http"
import { pullPage } from "./pull"
import { receiveWebhook } from "./webhook"
import {
	StripeAccount,
	StripeCustomersPage,
	StripeInvoicesPage,
	StripeProductsPage,
	StripeSubscriptionsPage,
} from "./wire"

/**
 * Webhooks carry every change as it happens; the pull behind them reconciles what a delivery
 * missed, and none of Stripe's list endpoints filter by a change time, so it runs every six hours
 * rather than every minute. A scheduled pull is incremental (`created` since the last success), so
 * it is a handful of requests; the complete walk is the connect-time backfill.
 */
export const STRIPE_PULL_INTERVAL_MS = 6 * 60 * 60_000

/** Which mode a key is for, from its prefix; null for one that does not say (a legacy `sk_…`). */
export const livemodeOfKey = (apiKey: Redacted.Redacted<string>): boolean | null => {
	const key = Redacted.value(apiKey)
	if (key.includes("_test_")) return false
	if (key.includes("_live_")) return true
	return null
}

/**
 * Connecting proves the key can read everything a pull needs, one `limit=1` request per resource,
 * so a restricted key missing a permission says which one at connect time instead of failing the
 * first backfill. The account the key opens is a further, optional request (`Account` read is not
 * part of the permissions Hazel asks for), and its id is what webhook deliveries are checked
 * against.
 */
const validateWith = Effect.fn("Stripe.validate")(function* (get: StripeGet) {
	const one = [["limit", "1"]] as const
	yield* get("/customers", one, StripeCustomersPage)
	yield* get("/subscriptions", [...one, ["status", "all"]], StripeSubscriptionsPage)
	yield* get("/invoices", one, StripeInvoicesPage)
	yield* get("/products", one, StripeProductsPage)
	const account = yield* get("/account", [], StripeAccount).pipe(
		Effect.map(Option.some),
		Effect.catchTag("CustomerProviderError", () => Effect.succeed(Option.none<StripeAccount>())),
	)
	return {
		externalAccountId: Option.match(account, { onNone: () => null, onSome: (value) => value.id }),
		externalAccountName: Option.match(account, {
			onNone: () => null,
			onSome: (value) =>
				value.settings?.dashboard?.display_name ??
				value.business_profile?.name ??
				value.email ??
				"Stripe account",
		}),
	}
})

export const makeStripeAdapter = Effect.gen(function* () {
	const client = yield* HttpClient.HttpClient
	const getOf = (credentials: ProviderCredentials) => makeStripeGet(client, credentials.apiKey)

	const adapter: CustomerProviderAdapter = {
		provider: "stripe",
		validate: (credentials) => validateWith(getOf(credentials)),

		// Core calls `webhook` only for a connection with a signing secret.
		webhook: (request, credentials) =>
			credentials.webhookSecret === null
				? Effect.die("Stripe webhook called without a signing secret")
				: receiveWebhook({
						get: getOf(credentials),
						headers: request.headers,
						body: request.body,
						webhookSecret: credentials.webhookSecret,
						accountId: credentials.externalAccountId,
						livemode: livemodeOfKey(credentials.apiKey),
						config: credentials.config,
					}),

		pull: (input) =>
			pullPage({
				get: getOf(input.credentials),
				cursor: input.cursor,
				since: input.since,
				config: input.credentials.config,
			}),

		pullIntervalMs: STRIPE_PULL_INTERVAL_MS,
	}
	return adapter
})
