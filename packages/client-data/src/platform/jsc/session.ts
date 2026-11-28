// @effect-diagnostics experimentalApiUsage:off
/**
 * `Session` on iOS, as the hybrid app signs in (`apps/ios/web/host.ts`, `HostBridge.swift`):
 * the session credential lives in the keychain's one vault record (`@hazel/auth/desktop`'s JSON,
 * the same item the hybrid writes), RPCs send it as `Authorization: Bearer`, and the sync sockets'
 * access token is exchanged for it at `POST <api>/auth/token`, as the web app's `access-token.ts`.
 *
 * A 401 on the exchange is a session the API refused: the shell hears it (`__native.session.rejected`,
 * where the web dispatches `hazel:session-rejected` on `window`), and so do `onSessionRejected` listeners.
 */
import { SessionLoadError } from "@hazel/domain/errors"
import type { SyncTokenResult } from "@hazel/effect-db-collection"
import { Context, Duration, Effect, Layer, Option, Schedule, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"
import { ClientDataConfig, Session } from "../services"
import { type NativeBridge, nativeBridge } from "./bridge"

/** The vault record's session slot (`BrowserLogin.VaultRecord`, encoded); other fields are kept as they are. */
const VaultRecord = Schema.fromJsonString(
	Schema.Struct({
		credentials: Schema.Struct({
			session: Schema.optional(
				Schema.Struct({ credential: Schema.String, expiresAtMillis: Schema.Finite }),
			),
		}),
	}),
)
const decodeVault = Schema.decodeUnknownOption(VaultRecord)

const TokenResponse = Schema.Struct({ token: Schema.String, expiresIn: Schema.Finite })
const decodeToken = Schema.decodeUnknownEffect(TokenResponse)

/** Renew this long before expiry, as the web does. */
const RENEW_BEFORE_MS = 60_000
/** Attempts per exchange: a network error or 5xx right after sign-in is usually momentary. */
const EXCHANGE_ATTEMPTS = 3
/** The shell hears a rejected session at most this often (the web's subscriber throttles the same). */
const REJECTED_EVERY_MS = 30_000

class ExchangeUnavailable extends Schema.TaggedError<
	ExchangeUnavailable,
	{ readonly brand: unique symbol }
>()("ExchangeUnavailable", { cause: Schema.Defect() }) {}

const rejectedListeners = new Set<() => void>()

/** Calls `listener` each time the API refuses the session; returns the unsubscribe. */
export const onSessionRejected = (listener: () => void): (() => void) => {
	rejectedListeners.add(listener)
	return () => rejectedListeners.delete(listener)
}

export interface NativeSessionOptions {
	readonly bridge: NativeBridge
	readonly http: HttpClient.HttpClient
	readonly apiUrl: string
	readonly now?: () => number
}

/** The service, and the controls a sign-in screen needs on iOS. */
export const makeNativeSession = (options: NativeSessionOptions) => {
	const { bridge, http, apiUrl } = options
	const now = options.now ?? Date.now
	let generation = 0
	let cached: { readonly token: string; readonly expiresAtMs: number } | null = null
	let pending: Promise<SyncTokenResult> | null = null
	let lastRejectedAt = Number.NEGATIVE_INFINITY

	/** The keychain's live session credential; G3's configured token on a host with no vault. */
	const credential = (): string | null => {
		const stored = bridge.session?.read() ?? null
		if (stored !== null) {
			const session = Option.getOrUndefined(decodeVault(stored))?.credentials.session
			if (session !== undefined && session.expiresAtMillis > now()) return session.credential
		}
		return bridge.config.token
	}

	const rejected = () => {
		cached = null
		if (now() - lastRejectedAt < REJECTED_EVERY_MS) return
		lastRejectedAt = now()
		bridge.session?.rejected()
		for (const listener of [...rejectedListeners]) listener()
	}

	const exchangeOnce = (
		started: number,
		bearer: string,
	): Effect.Effect<string | null, ExchangeUnavailable> =>
		Effect.gen(function* () {
			const response = yield* http
				.execute(
					HttpClientRequest.post(`${apiUrl}/auth/token`).pipe(
						HttpClientRequest.setHeader("authorization", `Bearer ${bearer}`),
					),
				)
				.pipe(Effect.mapError((cause) => new ExchangeUnavailable({ cause })))
			if (started !== generation) return null
			if (response.status >= 500)
				return yield* new ExchangeUnavailable({ cause: `HTTP ${response.status}` })
			if (response.status === 401) {
				rejected()
				return null
			}
			if (response.status < 200 || response.status >= 300) {
				cached = null
				return null
			}
			const body = yield* response.json.pipe(
				Effect.flatMap(decodeToken),
				Effect.mapError((cause) => new ExchangeUnavailable({ cause })),
			)
			if (started !== generation) return null
			cached = { token: body.token, expiresAtMs: now() + body.expiresIn * 1000 }
			return body.token
		}).pipe(Effect.scoped)

	const exchange = (started: number, bearer: string): Effect.Effect<SyncTokenResult> =>
		exchangeOnce(started, bearer).pipe(
			Effect.retry({
				schedule: Schedule.exponential(Duration.millis(500)),
				times: EXCHANGE_ATTEMPTS - 1,
				while: () => started === generation,
			}),
			Effect.catchTag("ExchangeUnavailable", () =>
				Effect.succeed<SyncTokenResult>(started === generation ? "unavailable" : null),
			),
		)

	const getAccessToken = async (): Promise<SyncTokenResult> => {
		if (cached !== null && cached.expiresAtMs - now() > RENEW_BEFORE_MS) return cached.token
		const bearer = credential()
		// Signed out: nothing to exchange.
		if (bearer === null) return null
		if (pending === null) {
			const request = Effect.runPromise(exchange(generation, bearer)).finally(() => {
				if (pending === request) pending = null
			})
			pending = request
		}
		return pending
	}

	const service = Session.of({
		getAccessToken,
		invalidateAccessToken: (token) => {
			if (cached?.token === token) cached = null
		},
		authorization: Effect.try({
			try: () => {
				const bearer = credential()
				return bearer === null ? null : `Bearer ${bearer}`
			},
			catch: () =>
				new SessionLoadError({
					message: "Could not read the session",
					detail: "The keychain did not answer",
				}),
		}),
	})

	return {
		service,
		/** Whether there is a session to use (the keychain's, or a fixture's stand-in); no API call. */
		hasCredential: (): boolean => credential() !== null,
		/** Keeps a sign-in's vault record (the desktop sign-in's JSON); whether the keychain took it. */
		signIn: (record: string): boolean => {
			generation++
			cached = null
			pending = null
			return bridge.session?.write(record) ?? false
		},
		/** Forgets the session here; the API call that ends it is the sign-out screen's. */
		signOut: () => {
			generation++
			cached = null
			pending = null
			bridge.session?.clear()
		},
	}
}

/** A sign-in or sign-out screen's hold on the native session. */
export class NativeSessionControls extends Context.Service<
	NativeSessionControls,
	Pick<ReturnType<typeof makeNativeSession>, "hasCredential" | "signIn" | "signOut">
>()("@hazel/client-data/jsc/NativeSessionControls") {}

/** `Session` over the keychain and URLSession, with its `NativeSessionControls`. */
export const SessionJsc = Layer.effectContext(
	Effect.gen(function* () {
		const http = yield* HttpClient.HttpClient
		const config = yield* ClientDataConfig
		const { service, hasCredential, signIn, signOut } = makeNativeSession({
			bridge: nativeBridge(),
			http,
			apiUrl: config.apiUrl,
		})
		return Context.make(Session, service).pipe(
			Context.add(NativeSessionControls, { hasCredential, signIn, signOut }),
		)
	}),
)
