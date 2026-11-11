/**
 * The Autumn data source (`docs/customers/tech-design.md` §5), the **MRR source of every account it
 * bills once its first import finished**: Autumn customers land on the accounts the identity source
 * created, their plans become the MRR, the plan name, the trial and the payment state, and their
 * feature balances become the usage metrics and plan limits the `near_limit` signal reads. Stripe
 * keeps the invoices either way (`tech-design.md` §4.2), and the MRR of an account Autumn holds no
 * plan of.
 *
 * Connecting needs an Autumn **secret key** (`am_sk_live_…` / `am_sk_test_…`) and, for live
 * updates, the signing secret of an Autumn webhook endpoint pointed at
 * `/webhooks/customers/autumn/:organizationId/:connectionId`. Both are stored encrypted
 * (`../credentials.ts`) and only ever decrypted to call Autumn or verify a delivery.
 *
 * Nothing here writes the store: `webhook` and `pull` produce `IngestOp`s and `CustomerIngest`
 * applies them.
 *
 * Only the connection's organization *and environment* (`credentials.externalAccountId`, what
 * `validate` found, `<organization id>:<env>`): a key opens exactly one of each, so what a pull
 * lists is always the connection's, and a delivery — which Autumn stamps with neither — is checked
 * by the customer it names (`./webhook.ts`). A new key is validated again, and core drops the old
 * account's data when it differs, so moving a connection from sandbox to live re-imports from
 * scratch instead of mixing the two.
 */
import { Effect, Option, Redacted } from "effect"
import { HttpClient } from "effect/http"
import { CustomerProviderError, CustomerWebhookRejectedError } from "../provider-errors"
import { type ProviderRequestOptions, WEBHOOK_REQUESTS } from "../provider-http"
import type { CustomerProviderAdapter, ProviderCredentials } from "../providers"
import { type AutumnApi, makeAutumnApi } from "./http"
import { pullPage } from "./pull"
import { cachedPricing, readPricing } from "./read"
import { receiveWebhook } from "./webhook"
import {
	accountIdOf,
	type AutumnEnv,
	AutumnCustomersPage,
	AutumnFeaturesPage,
	AutumnOrganizationMe,
	AutumnSubscriptionsPage,
	envOfKey,
} from "./wire"

/**
 * Autumn's webhooks carry plan changes and limits as they happen; the walk behind them only
 * reconciles missed deliveries, and no Autumn listing filters by a change time, so it runs every
 * six hours rather than every minute. A connection with no webhook endpoint is correct within one
 * period.
 */
export const AUTUMN_PULL_INTERVAL_MS = 6 * 60 * 60_000

const refused = (message: string) =>
	new CustomerProviderError({ code: "auth", message, httpStatus: null, retryAfterMs: null })

const WHERE_TO_FIND = "Autumn → Developer → Keys"

/** The environment half of the connection's account id, from what `validate` stored. */
export const envOfAccountId = (externalAccountId: string | null): AutumnEnv | null => {
	if (externalAccountId === null) return null
	if (externalAccountId.endsWith(":live")) return "live"
	return externalAccountId.endsWith(":sandbox") ? "sandbox" : null
}

/**
 * Connecting proves the key can read everything a pull and a delivery need — one request per
 * endpoint, the smallest page each will take — so a key whose scopes miss one says which at connect
 * time instead of failing the first backfill.
 *
 * Then the organization *and* environment the key opens, which is required: core tells a key of
 * another one by it (dropping the old data and importing from scratch), and a delivery's customer is
 * checked against the environment. `GET /v1/organization/me` answers both. The key's own prefix
 * says which environment it is for — checked before any request — and a key whose prefix
 * contradicts Autumn's answer is refused rather than guessed at: that pairing is how a sandbox key
 * ends up wired to live data.
 */
const validateWith = Effect.fn("Autumn.validate")(function* (
	api: AutumnApi,
	apiKey: Redacted.Redacted<string>,
) {
	const fromKey = envOfKey(Redacted.value(apiKey))
	if (fromKey === null) {
		return yield* refused(
			`"am_sk_live_…" or "am_sk_test_…" is what an Autumn secret key looks like (${WHERE_TO_FIND})`,
		)
	}
	const me = yield* api.get("/v1/organization/me", [], AutumnOrganizationMe)
	if (fromKey !== me.env) {
		return yield* refused(
			fromKey === "live"
				? "The key looks like a live key (am_sk_live_…) but Autumn answers for the sandbox"
				: "The key looks like a sandbox key (am_sk_test_…) but Autumn answers for the live environment",
		)
	}
	yield* readPricing(api)
	yield* api.post("/v1/features.list", {}, AutumnFeaturesPage)
	yield* api.post("/v1/customers.list", { start_cursor: "", limit: 1 }, AutumnCustomersPage)
	yield* api.post(
		"/v1/subscriptions.list",
		{ start_cursor: "", limit: 1, statuses: ["active", "past_due", "scheduled", "expired"] },
		AutumnSubscriptionsPage,
	)
	yield* Effect.annotateCurrentSpan({ "autumn.organization_id": me.id, "autumn.env": me.env })
	return {
		externalAccountId: accountIdOf(me.id, me.env),
		externalAccountName:
			me.name === null || me.name === undefined || me.name.trim() === ""
				? `Autumn ${me.env}`
				: `${me.name.trim()} (${me.env})`,
	}
})

/** Why a connection's environment is unknown: it never finished validating. */
const UNVALIDATED = "The Autumn connection has no validated account; reconnect it"

export const makeAutumnAdapter = Effect.gen(function* () {
	const client = yield* HttpClient.HttpClient

	/** The key's API, the connection's pricing (kept a few minutes) and its environment. */
	const connectionOf = (credentials: ProviderCredentials, options?: ProviderRequestOptions) => {
		const api = makeAutumnApi(client, credentials.apiKey, options)
		const env = envOfAccountId(credentials.externalAccountId)
		return env === null || credentials.externalAccountId === null
			? Option.none()
			: Option.some({
					api,
					env,
					pricing: cachedPricing(credentials.externalAccountId, readPricing(api)),
				})
	}

	const adapter: CustomerProviderAdapter = {
		provider: "autumn",
		validate: (credentials) =>
			validateWith(makeAutumnApi(client, credentials.apiKey), credentials.apiKey),

		// Core calls `webhook` only for a connection with a signing secret.
		webhook: (request, credentials) =>
			Option.match(connectionOf(credentials, WEBHOOK_REQUESTS), {
				onNone: () => Effect.fail(new CustomerWebhookRejectedError({ message: UNVALIDATED })),
				onSome: (connection) =>
					credentials.webhookSecret === null
						? Effect.die("Autumn webhook called without a signing secret")
						: receiveWebhook({
								// A delivery answers fast (`../provider-http.ts`, `./webhook.ts`).
								...connection,
								headers: request.headers,
								body: request.body,
								webhookSecret: credentials.webhookSecret,
								config: credentials.config,
							}),
			}),

		pull: (input) =>
			Option.match(connectionOf(input.credentials), {
				onNone: () => Effect.fail(refused(UNVALIDATED)),
				onSome: (connection) =>
					pullPage({ ...connection, cursor: input.cursor, config: input.credentials.config }),
			}),

		pullIntervalMs: AUTUMN_PULL_INTERVAL_MS,
	}
	return adapter
})
