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
 */
import { Effect, Option } from "effect"
import { HttpClient } from "effect/http"
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
	 * instance it opens is a second, optional request, so a plan without instance settings still
	 * connects (its webhooks then go unchecked against the instance).
	 */
	const validate = Effect.fn("Clerk.validate")(function* (credentials: ProviderCredentials) {
		const get = getOf(credentials)
		yield* get("/organizations", [["limit", "1"]], ClerkOrganizationsPage)
		const instance = yield* get("/instance", [], ClerkInstance).pipe(
			Effect.map(Option.some),
			Effect.catchTag("CustomerProviderError", () => Effect.succeed(Option.none())),
		)
		return {
			externalAccountId: Option.match(instance, { onNone: () => null, onSome: (value) => value.id }),
			externalAccountName: Option.match(instance, {
				onNone: () => null,
				onSome: (value) =>
					value.environment_type === undefined
						? "Clerk instance"
						: `Clerk ${value.environment_type} instance`,
			}),
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
