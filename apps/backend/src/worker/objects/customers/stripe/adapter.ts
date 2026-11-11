/**
 * The Stripe data source (`docs/customers/tech-design.md` §5), Hazel's billing source for
 * Customers: Stripe customers land on the accounts the identity source created, and their
 * subscriptions and invoices become the MRR, the plan, the trial and the payment state every
 * billing signal and the health score's billing component read.
 *
 * Connecting needs a Stripe **restricted key** (`rk_live_…` / `rk_test_…`, with the account id
 * entered next to it, or a secret key) with read access to customers, products, prices,
 * subscriptions, invoices, payment methods and events, and, for live updates, the
 * signing secret of a Stripe webhook endpoint pointed at
 * `/webhooks/customers/stripe/:organizationId/:connectionId`. Both are stored encrypted
 * (`../credentials.ts`) and only ever decrypted to call Stripe or verify a delivery.
 *
 * Nothing here writes the store: `webhook` and `pull` produce `IngestOp`s and `CustomerIngest`
 * applies them.
 *
 * Only the connection's account (`credentials.externalAccountId`, what `validate` found): a
 * delivery stamped with another account, or from the other mode, is refused, and one whose object
 * the key cannot read is skipped (`./webhook.ts`). A key opens exactly one account and Hazel never
 * sends `Stripe-Account`, so what a pull lists is always the connection's; a new key is validated
 * again, and core drops the old account's data when it differs. The account id entered in the form
 * is read only then: changing it alone moves nothing.
 */
import type { ConnectionConfig } from "@hazel/domain/customers"
import { Effect, Redacted, Result } from "effect"
import { HttpClient } from "effect/http"
import { CustomerProviderError } from "../provider-errors"
import { WEBHOOK_REQUESTS } from "../provider-http"
import type { CustomerProviderAdapter, ProviderCredentials } from "../providers"
import { makeStripeGet, type StripeGet } from "./http"
import { pullPage } from "./pull"
import { receiveWebhook } from "./webhook"
import {
	StripeAccount,
	StripeCustomersPage,
	StripeEventsPage,
	StripeInvoicesPage,
	StripeProductsPage,
	StripeSubscriptionsPage,
	subscriptionExpands,
} from "./wire"

/**
 * Scheduled pulls read the events since the last one (`./pull.ts`): they catch up on what webhooks
 * missed, and carry every change for a connection with no webhook endpoint. Each costs one request
 * per changed object, so six hours is cheap and still keeps that connection within a working day.
 */
const STRIPE_PULL_INTERVAL_MS = 6 * 60 * 60_000

/** Which mode a key is for, from its prefix; null for one that does not say (a legacy `sk_…`). */
export const livemodeOfKey = (apiKey: Redacted.Redacted<string>): boolean | null => {
	const key = Redacted.value(apiKey)
	if (key.includes("_test_")) return false
	if (key.includes("_live_")) return true
	return null
}

const ACCOUNT_ID = /^acct_[A-Za-z0-9]+$/
/** An account id inside text Stripe wrote: a refusal's message, a hosted invoice's URL. */
const ACCOUNT_ID_IN = /\bacct_[A-Za-z0-9]+/g

const WHERE_TO_FIND = "Stripe Dashboard → Settings → Business → Account details"

const refused = (message: string) =>
	new CustomerProviderError({ code: "auth", message, httpStatus: null, retryAfterMs: null })

/**
 * Connecting proves the key can read everything a pull needs, one `limit=1` request per resource
 * with the pull's own expansions, so a restricted key missing a permission says which one at
 * connect time instead of failing the first backfill.
 *
 * Then the account the key opens, which is required: core tells a key of another account by it
 * (dropping the old account's data), and webhooks are checked against it. A secret key reads it
 * (`GET /v1/account`), and an account id entered in the form must match. A restricted key may not
 * read its own account (Stripe answers 403), so it needs the account id entered: Hazel checks its
 * shape and, where Stripe gives the real one away (the 403's message, a hosted invoice's URL), that
 * it matches, so a typo cannot attach the connection to an account id no event will ever carry.
 */
const validateWith = Effect.fn("Stripe.validate")(function* (
	get: StripeGet,
	apiKey: Redacted.Redacted<string>,
	config: ConnectionConfig,
) {
	const one = [["limit", "1"]] as const
	yield* get("/customers", one, StripeCustomersPage)
	yield* get(
		"/subscriptions",
		[...one, ["status", "all"], ...subscriptionExpands("data.")],
		StripeSubscriptionsPage,
	)
	const invoices = yield* get("/invoices", one, StripeInvoicesPage)
	yield* get("/products", one, StripeProductsPage)
	yield* get("/events", one, StripeEventsPage)
	const entered = config._tag === "stripe" ? config.accountId.trim() : ""
	if (entered !== "" && !ACCOUNT_ID.test(entered)) {
		return yield* refused(`"${entered}" is not a Stripe account id (acct_…, ${WHERE_TO_FIND})`)
	}
	const account = yield* Effect.result(get("/account", [], StripeAccount))
	if (Result.isSuccess(account)) {
		const { id } = account.success
		if (entered !== "" && entered !== id) {
			return yield* refused(`The key opens Stripe account ${id}, not ${entered}`)
		}
		yield* Effect.annotateCurrentSpan("stripe.account_id", id)
		return {
			externalAccountId: id,
			externalAccountName:
				account.success.settings?.dashboard?.display_name ??
				account.success.business_profile?.name ??
				account.success.email ??
				"Stripe account",
		}
	}
	const error = account.failure
	if (error.httpStatus !== 403 || !Redacted.value(apiKey).startsWith("rk_")) return yield* error
	if (entered === "") {
		return yield* refused(
			`A restricted key cannot read the Stripe account it belongs to: enter the account id (acct_…, ${WHERE_TO_FIND})`,
		)
	}
	const seen = [error.message, invoices.data[0]?.hosted_invoice_url ?? ""].flatMap(
		(text) => text.match(ACCOUNT_ID_IN) ?? [],
	)
	const other = seen.find((id) => id !== entered)
	if (other !== undefined)
		return yield* refused(`The key belongs to Stripe account ${other}, not ${entered}`)
	yield* Effect.annotateCurrentSpan({
		"stripe.account_id": entered,
		"stripe.account_confirmed": seen.length > 0,
	})
	return { externalAccountId: entered, externalAccountName: null }
})

export const makeStripeAdapter = Effect.gen(function* () {
	const client = yield* HttpClient.HttpClient
	const getOf = (credentials: ProviderCredentials) => makeStripeGet(client, credentials.apiKey)

	const adapter: CustomerProviderAdapter = {
		provider: "stripe",
		validate: (credentials) => validateWith(getOf(credentials), credentials.apiKey, credentials.config),

		// Core calls `webhook` only for a connection with a signing secret.
		webhook: (request, credentials) =>
			credentials.webhookSecret === null
				? Effect.die("Stripe webhook called without a signing secret")
				: receiveWebhook({
						// A delivery answers fast (`../provider-http.ts`, `./webhook.ts`).
						get: makeStripeGet(client, credentials.apiKey, WEBHOOK_REQUESTS),
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
