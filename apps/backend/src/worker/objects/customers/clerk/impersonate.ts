/**
 * Clerk user impersonation: one actor token (`POST /actor_tokens`) for a Clerk user, acted by the
 * Hazel member (`actor.sub`, so the customer's app sees who in its session's `act` claim). Its
 * `url` signs the browser out of the customer's app and in as that user, once, within a minute.
 *
 * Unlike the reads (`./http.ts`) a refusal here says nothing about the key's health, so it never
 * touches the connection: it goes back to the member who asked, with Clerk's own explanation (the
 * monthly allowance used up, say). A 403 `feature_not_enabled` is impersonation switched off in the
 * Clerk dashboard. Never retried: each token counts against the allowance.
 */
import { CustomerImpersonationError } from "@hazel/domain/rpc"
import type { UserId } from "@hazel/schema"
import { Effect, type Redacted, Schema } from "effect"
import { type HttpClient, HttpClientRequest } from "effect/http"
import { CLERK_API_URL } from "./http"

/** The link is opened right away; a token left unused stops working after this. */
export const ACTOR_TOKEN_TTL_SECONDS = 60

const ActorToken = Schema.Struct({ id: Schema.String, url: Schema.String })

const ClerkErrors = Schema.Struct({
	errors: Schema.optionalKey(
		Schema.Array(
			Schema.Struct({
				code: Schema.optionalKey(Schema.String),
				message: Schema.optionalKey(Schema.String),
				long_message: Schema.optionalKey(Schema.String),
			}),
		),
	),
})

const fail = (reason: CustomerImpersonationError["reason"], message: string) =>
	new CustomerImpersonationError({ reason, message })

export const createActorToken = Effect.fn("Clerk.createActorToken")(function* (
	client: HttpClient.HttpClient,
	apiKey: Redacted.Redacted<string>,
	input: { readonly clerkUserId: string; readonly actorUserId: UserId },
) {
	const request = HttpClientRequest.post(`${CLERK_API_URL}/actor_tokens`).pipe(
		HttpClientRequest.bearerToken(apiKey),
		HttpClientRequest.acceptJson,
		HttpClientRequest.bodyJsonUnsafe({
			user_id: input.clerkUserId,
			actor: { sub: input.actorUserId },
			expires_in_seconds: ACTOR_TOKEN_TTL_SECONDS,
		}),
	)
	const response = yield* client.execute(request).pipe(
		Effect.timeout("10 seconds"),
		Effect.mapError(() => fail("provider", "Could not reach Clerk")),
	)
	yield* Effect.annotateCurrentSpan("http.response.status_code", response.status)
	const body = yield* response.json.pipe(Effect.orElseSucceed(() => null))
	if (response.status >= 200 && response.status < 300) {
		return yield* Schema.decodeUnknownEffect(ActorToken)(body).pipe(
			Effect.mapError(() => fail("provider", "Clerk answered with an actor token Hazel cannot read")),
		)
	}
	const first = Schema.decodeUnknownOption(ClerkErrors)(body).pipe((option) =>
		option._tag === "Some" ? option.value.errors?.[0] : undefined,
	)
	if (first?.code === "feature_not_enabled") {
		return yield* fail("disabled", "User impersonation is turned off in this Clerk instance's settings")
	}
	const detail = first?.long_message ?? first?.message
	return yield* fail(
		"provider",
		detail === undefined ? `Clerk refused the impersonation (${response.status})` : `Clerk: ${detail}`,
	)
})
