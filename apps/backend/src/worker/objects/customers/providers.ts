/**
 * The registered adapters as a service (`docs/customers/integrations.md`). A provider with no adapter
 * answers `CustomerProviderUnavailableError` on connect.
 */
import type { CustomerProvider } from "@hazel/domain/customers"
import { makeAutumnAdapter } from "@hazel/customer-integrations/autumn/adapter"
import { makeClerkAdapter } from "@hazel/customer-integrations/clerk/adapter"
import type { CustomerProviderAdapter } from "@hazel/customer-integrations/kit/contract"
import { CustomerProviderError, CustomerWebhookRejectedError } from "@hazel/customer-integrations/kit/errors"
import { makeMapleAdapter } from "@hazel/customer-integrations/maple/adapter"
import { makeStripeAdapter } from "@hazel/customer-integrations/stripe/adapter"
import { Context, Effect, Layer, Option } from "effect"
import { FetchHttpClient } from "effect/http"

export type {
	CustomerProviderAdapter,
	ProviderCredentials,
	PullPage,
} from "@hazel/customer-integrations/kit/contract"
export { CustomerProviderError, CustomerWebhookRejectedError }

export interface CustomerProvidersApi {
	readonly get: (provider: CustomerProvider) => Option.Option<CustomerProviderAdapter>
}

export class CustomerProviders extends Context.Service<CustomerProviders, CustomerProvidersApi>()(
	"@hazel/backend/CustomerProviders",
) {
	/**
	 * The registered adapters. Provider PRs add theirs here. The layer brings its own
	 * `FetchHttpClient` so every consumer (the RPC handlers, the alarm, the webhook call) keeps
	 * taking the service with no requirement of its own.
	 */
	static readonly layer = Layer.effect(
		this,
		Effect.gen(function* () {
			const adapters = new Map<CustomerProvider, CustomerProviderAdapter>([
				["clerk", yield* makeClerkAdapter],
				["stripe", yield* makeStripeAdapter],
				["autumn", yield* makeAutumnAdapter],
				["maple", yield* makeMapleAdapter],
			])
			return CustomerProviders.of({ get: (provider) => Option.fromNullishOr(adapters.get(provider)) })
		}),
	).pipe(Layer.provide(FetchHttpClient.layer))
}
