/** Reading a connection's stored config in an adapter, through the integration's own schema. */
import type { ConnectionConfig } from "@hazel/domain/customers"
import { Effect, Schema } from "effect"
import { CustomerProviderError, CustomerWebhookRejectedError } from "./errors"

/** `config` as this integration's; a refused `auth` error when it cannot be read as one. */
export const configReader = <S extends Schema.Codec<ConnectionConfig, unknown>>(schema: S, name: string) => {
	const decode = Schema.decodeUnknownOption(schema)
	return (config: ConnectionConfig): Effect.Effect<S["Type"], CustomerProviderError> =>
		Effect.fromOption(
			decode(config),
			() =>
				new CustomerProviderError({
					code: "auth",
					message: `The ${name} connection has no ${name} settings; reconnect it`,
					httpStatus: null,
					retryAfterMs: null,
				}),
		)
}

/** The same refusal on a webhook delivery, which answers with its own error. */
export const asWebhookRejection = <A, R>(effect: Effect.Effect<A, CustomerProviderError, R>) =>
	Effect.mapError(effect, (error) => new CustomerWebhookRejectedError({ message: error.message }))
