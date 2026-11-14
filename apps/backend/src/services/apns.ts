/**
 * Apple Push Notification service: one HTTP/2 request per device (`POST /3/device/<token>`),
 * authenticated with a provider token, an ES256 JWT signed with the team's `.p8` key. Called by
 * the `UserObject` from its outbox (`worker/objects/user/push.ts`).
 *
 * Config (all optional; any one unset disables push, logged once per isolate):
 * - `APNS_KEY_ID`: the key's id (the JWT's `kid`).
 * - `APNS_TEAM_ID`: the Apple developer team (the JWT's `iss`).
 * - `APNS_PRIVATE_KEY`: the `.p8` key, as PEM or as its base64 PKCS#8 body.
 *
 * APNs refuses a provider token refreshed more than once per 20 minutes and one older than an
 * hour, so each isolate signs one per key and reuses it for `PROVIDER_TOKEN_TTL_MS`.
 *
 * Local workerd has no HTTP/2 to APNs: there the request fails as `ApnsRequestError`.
 */
import { Clock, Config, Context, Effect, Layer, Option, Redacted, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"

export type ApnsEnvironment = "development" | "production"

export const APNS_HOSTS: Record<ApnsEnvironment, string> = {
	production: "https://api.push.apple.com",
	development: "https://api.sandbox.push.apple.com",
}

/** How long a signed provider token is reused. */
export const PROVIDER_TOKEN_TTL_MS = 50 * 60 * 1000

/** The JSON body APNs delivers to the app. */
export interface ApnsPayload {
	readonly aps: {
		readonly alert: { readonly title: string; readonly body: string }
		readonly sound: "default"
		readonly badge: number
		readonly "thread-id": string
	}
	readonly hazel: {
		readonly path?: string
		readonly channelId: string
		readonly notificationId: string
	}
}

export interface ApnsNotification {
	readonly environment: ApnsEnvironment
	readonly token: string
	/** The app's bundle id. */
	readonly topic: string
	/** Epoch seconds after which APNs stops trying. */
	readonly expiration: number
	readonly payload: ApnsPayload
}

/** APNs's answer: the status and, on a failure, its `reason`. */
export interface ApnsResult {
	readonly status: number
	readonly reason: string | null
}

/** APNs was not reached (network, no HTTP/2, a timeout). */
export class ApnsRequestError extends Schema.TaggedError<ApnsRequestError>()("ApnsRequestError", {
	message: Schema.String,
	cause: Schema.optional(Schema.Unknown),
}) {}

/** APNs answered with a failure worth retrying (429, 5xx, a stale provider token). */
export class ApnsRetryableError extends Schema.TaggedError<ApnsRetryableError>()("ApnsRetryableError", {
	status: Schema.Number,
	reason: Schema.NullOr(Schema.String),
}) {}

export interface ApnsClientShape {
	/** False when the `APNS_*` config is missing or the key does not import. */
	readonly enabled: boolean
	readonly send: (notification: ApnsNotification) => Effect.Effect<ApnsResult, ApnsRequestError>
	/** Forget the cached provider token (APNs called it expired or invalid). */
	readonly invalidateToken: Effect.Effect<void>
}

// PROVIDER TOKEN

const encoder = new TextEncoder()

const base64Url = (bytes: Uint8Array | ArrayBuffer) =>
	btoa(String.fromCharCode(...new Uint8Array(bytes)))
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "")

const base64UrlJson = (value: unknown) => base64Url(encoder.encode(JSON.stringify(value)))

/** The `.p8` key's PKCS#8 bytes, from PEM (escaped newlines too) or the bare base64 body. */
export const pkcs8Of = (key: string): Uint8Array<ArrayBuffer> => {
	const body = key
		.replace(/\\n/g, "\n")
		.replace(/-----(BEGIN|END) [A-Z ]+-----/g, "")
		.replace(/\s+/g, "")
	return Uint8Array.from(atob(body), (char) => char.charCodeAt(0))
}

export const importApnsKey = (key: string): Promise<CryptoKey> =>
	crypto.subtle.importKey("pkcs8", pkcs8Of(key), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"])

/**
 * The provider token: `{alg: ES256, kid}.{iss, iat}`, signed. WebCrypto's ECDSA signature is
 * already the raw `r || s` JWS wants.
 */
export const signProviderToken = async (input: {
	readonly key: CryptoKey
	readonly keyId: string
	readonly teamId: string
	readonly nowMs: number
}): Promise<string> => {
	const signingInput = `${base64UrlJson({ alg: "ES256", kid: input.keyId })}.${base64UrlJson({
		iss: input.teamId,
		iat: Math.floor(input.nowMs / 1000),
	})}`
	const signature = await crypto.subtle.sign(
		{ name: "ECDSA", hash: "SHA-256" },
		input.key,
		encoder.encode(signingInput),
	)
	return `${signingInput}.${base64Url(signature)}`
}

/** Signed tokens by `teamId.keyId`, shared by every object in the isolate. */
const providerTokens = new Map<string, { readonly token: string; readonly issuedAtMs: number }>()

let loggedDisabled = false

const ReasonBody = Schema.fromJsonString(Schema.Struct({ reason: Schema.optional(Schema.String) }))

const disabled: ApnsClientShape = {
	enabled: false,
	send: () => Effect.fail(new ApnsRequestError({ message: "APNs is not configured" })),
	invalidateToken: Effect.void,
}

export class ApnsClient extends Context.Service<ApnsClient, ApnsClientShape>()("@hazel/backend/ApnsClient") {
	/** APNs over the ambient `HttpClient`; the `APNS_*` config is read once. */
	static readonly layer = Layer.effect(
		this,
		Effect.gen(function* () {
			const client = yield* HttpClient.HttpClient
			const config = yield* Effect.all({
				keyId: Config.option(Config.String("APNS_KEY_ID")),
				teamId: Config.option(Config.String("APNS_TEAM_ID")),
				privateKey: Config.option(Config.Redacted("APNS_PRIVATE_KEY")),
			}).pipe(
				Effect.catchTag("ConfigError", () =>
					Effect.succeed({
						keyId: Option.none(),
						teamId: Option.none(),
						privateKey: Option.none(),
					}),
				),
			)
			if (
				Option.isNone(config.keyId) ||
				Option.isNone(config.teamId) ||
				Option.isNone(config.privateKey)
			) {
				if (!loggedDisabled) {
					loggedDisabled = true
					yield* Effect.logInfo(
						"APNS_KEY_ID, APNS_TEAM_ID or APNS_PRIVATE_KEY is not set; push is off",
					)
				}
				return disabled
			}
			const keyId = config.keyId.value.trim()
			const teamId = config.teamId.value.trim()
			const rawKey = Redacted.value(config.privateKey.value)
			const key = yield* Effect.tryPromise({
				try: () => importApnsKey(rawKey),
				catch: (cause) =>
					new ApnsRequestError({ message: "APNS_PRIVATE_KEY does not import", cause }),
			}).pipe(
				Effect.catchTag("ApnsRequestError", (error) =>
					Effect.logError(error.message).pipe(Effect.as(undefined)),
				),
			)
			if (key === undefined) return disabled
			const cacheKey = `${teamId}.${keyId}`

			const providerToken = Effect.gen(function* () {
				const nowMs = yield* Clock.currentTimeMillis
				const cached = providerTokens.get(cacheKey)
				if (cached !== undefined && nowMs - cached.issuedAtMs < PROVIDER_TOKEN_TTL_MS)
					return cached.token
				const token = yield* Effect.tryPromise({
					try: () => signProviderToken({ key, keyId, teamId, nowMs }),
					catch: (cause) =>
						new ApnsRequestError({ message: "Could not sign the provider token", cause }),
				})
				providerTokens.set(cacheKey, { token, issuedAtMs: nowMs })
				return token
			})

			const send = Effect.fn("ApnsClient.send")(function* (notification: ApnsNotification) {
				yield* Effect.annotateCurrentSpan({ "apns.environment": notification.environment })
				const token = yield* providerToken
				const request = HttpClientRequest.post(
					`${APNS_HOSTS[notification.environment]}/3/device/${notification.token}`,
				).pipe(
					HttpClientRequest.setHeaders({
						authorization: `bearer ${token}`,
						"apns-topic": notification.topic,
						"apns-push-type": "alert",
						"apns-priority": "10",
						"apns-expiration": String(notification.expiration),
					}),
					HttpClientRequest.bodyJsonUnsafe(notification.payload),
				)
				const response = yield* client
					.execute(request)
					.pipe(
						Effect.catchTag("HttpClientError", (cause) =>
							Effect.fail(new ApnsRequestError({ message: "APNs request failed", cause })),
						),
					)
				if (response.status === 200) return { status: 200, reason: null } satisfies ApnsResult
				// A failure's body is `{"reason": "BadDeviceToken"}`; anything else has no reason.
				const reason = yield* response.text.pipe(
					Effect.flatMap(Schema.decodeUnknownEffect(ReasonBody)),
					Effect.map((body) => body.reason ?? null),
					Effect.catchTags({
						HttpClientError: () => Effect.succeed(null),
						SchemaError: () => Effect.succeed(null),
					}),
				)
				yield* Effect.annotateCurrentSpan({
					"apns.status": response.status,
					"apns.reason": reason ?? "",
				})
				return { status: response.status, reason } satisfies ApnsResult
			})

			return {
				enabled: true,
				send,
				invalidateToken: Effect.sync(() => void providerTokens.delete(cacheKey)),
			} satisfies ApnsClientShape
		}),
	)

	/** Push off (tools and tests that never send). */
	static readonly layerDisabled = Layer.succeed(this, disabled)
}
