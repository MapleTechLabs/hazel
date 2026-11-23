/**
 * The registered adapters as a service (`docs/customers/integrations.md`). A provider with no adapter
 * answers `CustomerProviderUnavailableError` on connect.
 */
import { integrations } from "@hazel/customer-integrations"
import type { CustomerProviderAdapter } from "@hazel/customer-integrations/kit/contract"
import { CustomerProviderError, CustomerWebhookRejectedError } from "@hazel/customer-integrations/kit/errors"
import type { CustomerProvider } from "@hazel/domain/customers"
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
	 * Every registered integration's adapter, its server half imported here (never in global scope:
	 * a layer builds inside an object or a request). The layer brings its own `FetchHttpClient` so
	 * every consumer (the RPC handlers, the alarm, the webhook call) keeps taking the service with no
	 * requirement of its own.
	 */
	static readonly layer = Layer.effect(
		this,
		Effect.gen(function* () {
			const adapters = new Map<CustomerProvider, CustomerProviderAdapter>(
				yield* Effect.forEach(integrations, (integration) =>
					Effect.promise(integration.server).pipe(
						Effect.flatMap((server) => server.makeAdapter),
						Effect.map((adapter) => [integration.id, adapter] as const),
					),
				),
			)
			return CustomerProviders.of({ get: (provider) => Option.fromNullishOr(adapters.get(provider)) })
		}),
	).pipe(Layer.provide(FetchHttpClient.layer))
}
