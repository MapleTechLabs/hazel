/**
 * The Autumn data source (`docs/customers/tech-design.md` §5), Hazel's **MRR source once it is
 * connected**: Autumn customers land on the accounts the identity source created, their plans
 * become the MRR, the plan name, the trial and the payment state, and their feature balances become
 * the usage metrics and plan limits the `near_limit` signal reads. Stripe keeps the invoices
 * either way (`tech-design.md` §4.2); its subscriptions step aside while Autumn is connected,
 * because Autumn is what the app actually bills through.
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
import { Effect, Redacted } from "effect"
import { HttpClient } from "effect/http"
import { CustomerProviderError } from "../provider-errors"
import { WEBHOOK_REQUESTS } from "../provider-http"
import type { CustomerProviderAdapter, ProviderCredentials } from "../providers"
import { type AutumnApi, makeAutumnApi } from "./http"
import { pullPage } from "./pull"
import { receiveWebhook } from "./webhook"
import {
	accountIdOf,
	type AutumnEnv,
	AutumnCustomersPage,
	AutumnFeaturesPage,
	AutumnOrganizationMe,
	AutumnPlansPage,
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
 * says which environment it is for, and a key whose prefix contradicts Autumn's answer is refused
 * rather than guessed at: that pairing is how a sandbox key ends up wired to live data.
 */
const validateWith = Effect.fn("Autumn.validate")(function* (
	api: AutumnApi,
	apiKey: Redacted.Redacted<string>,
) {
	const me = yield* api.get("/v1/organization/me", [], AutumnOrganizationMe)
	const fromKey = envOfKey(Redacted.value(apiKey))
	if (fromKey === null) {
		return yield* refused(
			`"am_sk_live_…" or "am_sk_test_…" is what an Autumn secret key looks like (${WHERE_TO_FIND})`,
		)
	}
	if (fromKey !== me.env) {
		return yield* refused(
			fromKey === "live"
				? "The key looks like a live key (am_sk_live_…) but Autumn answers for the sandbox"
				: "The key looks like a sandbox key (am_sk_test_…) but Autumn answers for the live environment",
		)
	}
	yield* api.post("/v1/features.list", {}, AutumnFeaturesPage)
	yield* api.post("/v1/plans.list", { include_archived: true }, AutumnPlansPage)
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

export const makeAutumnAdapter = Effect.gen(function* () {
	const client = yield* HttpClient.HttpClient
	const apiOf = (credentials: ProviderCredentials) => makeAutumnApi(client, credentials.apiKey)

	/** The environment the credentials opened; a connection still validating has none yet. */
	const envOf = (credentials: ProviderCredentials): AutumnEnv =>
		envOfAccountId(credentials.externalAccountId) ??
		envOfKey(Redacted.value(credentials.apiKey)) ??
		"live"

	const adapter: CustomerProviderAdapter = {
		provider: "autumn",
		validate: (credentials) => validateWith(apiOf(credentials), credentials.apiKey),

		// Core calls `webhook` only for a connection with a signing secret.
		webhook: (request, credentials) =>
			credentials.webhookSecret === null
				? Effect.die("Autumn webhook called without a signing secret")
				: receiveWebhook({
						// A delivery answers fast (`../provider-http.ts`, `./webhook.ts`).
						api: makeAutumnApi(client, credentials.apiKey, WEBHOOK_REQUESTS),
						headers: request.headers,
						body: request.body,
						webhookSecret: credentials.webhookSecret,
						env: envOf(credentials),
						config: credentials.config,
					}),

		pull: (input) =>
			pullPage({
				api: apiOf(input.credentials),
				cursor: input.cursor,
				config: input.credentials.config,
				env: envOf(input.credentials),
			}),

		pullIntervalMs: AUTUMN_PULL_INTERVAL_MS,
	}
	return adapter
})
