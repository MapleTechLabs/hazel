/**
 * The Clerk data source (`docs/customers/tech-design.md` §5), Hazel's identity source for
 * Customers: Clerk organizations are the accounts, their members are the contacts, and the Clerk
 * organization id is the shared id Stripe, Autumn and Maple match their own records against.
 *
 * Connecting needs a Clerk **secret key** (`sk_live_…` / `sk_test_…`) and, for live updates, the
 * signing secret of a Clerk webhook endpoint pointed at
 * `/webhooks/customers/clerk/:organizationId/:connectionId`. Both are stored encrypted
 * (`../credentials.ts`) and only ever decrypted to call Clerk or verify a delivery.
 *
 * Nothing here writes the store: `webhook` and `pull` produce `IngestOp`s and `CustomerIngest`
 * applies them.
 *
 * Only the connection's instance (`credentials.externalAccountId`, what `validate` found): a
 * delivery stamped with another `instance_id` is refused (`./webhook.ts`). A secret key opens
 * exactly one instance, and a new key is validated again (core drops the old instance's data when
 * it differs), so what a pull lists is always the connection's instance.
 */
import { Effect } from "effect"
import { HttpClient } from "effect/http"
import { CustomerProviderError } from "../provider-errors"
import type { CustomerProviderAdapter, ProviderCredentials } from "../providers"
import { makeClerkGet } from "./http"
import { onNoMatchOf } from "./map"
import { pullPage } from "./pull"
import { receiveWebhook } from "./webhook"
import { ClerkInstance, ClerkOrganizationsPage } from "./wire"

/**
 * Webhooks carry every change as it happens; the sweep behind them only reconciles missed
 * deliveries, and Clerk cannot filter a list by change time, so it runs every six hours rather
 * than every minute.
 */
export const CLERK_PULL_INTERVAL_MS = 6 * 60 * 60_000

export const makeClerkAdapter = Effect.gen(function* () {
	const client = yield* HttpClient.HttpClient
	const getOf = (credentials: ProviderCredentials) => makeClerkGet(client, credentials.apiKey)

	/**
	 * One organizations request proves the key works *and* that it can read what Hazel needs; the
	 * second names the instance it opens. That id is required: core tells a key of another instance
	 * by it (dropping the old instance's data), and webhooks are checked against it. A Clerk secret
	 * key carries no instance id of its own, so when `/instance` is refused there is nothing stable
	 * to fall back on and connecting fails with a message saying so.
	 */
	const validate = Effect.fn("Clerk.validate")(function* (credentials: ProviderCredentials) {
		const get = getOf(credentials)
		yield* get("/organizations", [["limit", "1"]], ClerkOrganizationsPage)
		// The key just read the organizations, so a refusal here (even a 403) is the endpoint's, not the key's.
		const instance = yield* get("/instance", [], ClerkInstance).pipe(
			Effect.catchTag("CustomerProviderError", (error) =>
				Effect.fail(
					error.code !== "rate_limited" &&
						error.httpStatus !== null &&
						error.httpStatus >= 400 &&
						error.httpStatus < 500
						? new CustomerProviderError({
								code: "provider",
								message: `Clerk did not say which instance this secret key opens (${error.httpStatus}), and Hazel needs it to keep instances apart`,
								httpStatus: error.httpStatus,
								retryAfterMs: null,
							})
						: error,
				),
			),
		)
		return {
			externalAccountId: instance.id,
			externalAccountName:
				instance.environment_type === undefined
					? "Clerk instance"
					: `Clerk ${instance.environment_type} instance`,
		}
	})

	const adapter: CustomerProviderAdapter = {
		provider: "clerk",
		validate,

		// Core calls `webhook` only for a connection with a signing secret.
		webhook: (request, credentials) =>
			credentials.webhookSecret === null
				? Effect.die("Clerk webhook called without a signing secret")
				: receiveWebhook({
						get: getOf(credentials),
						headers: request.headers,
						body: request.body,
						webhookSecret: credentials.webhookSecret,
						instanceId: credentials.externalAccountId,
						onNoMatch: onNoMatchOf(credentials.config),
					}),

		pull: (input) =>
			pullPage({
				get: getOf(input.credentials),
				cursor: input.cursor,
				config: input.credentials.config,
			}),

		pullIntervalMs: CLERK_PULL_INTERVAL_MS,
	}
	return adapter
})
