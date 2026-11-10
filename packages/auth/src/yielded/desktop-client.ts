import { BrowserLogin, OperationHttpClient } from "@yielded/auth"
import { OperationHttpError } from "@yielded/auth/OperationHttp"
import type { CredentialSlot } from "@yielded/auth/Operations"
import { DateTime, Effect, Layer, Redacted, Schema, Semaphore } from "effect"
import { HttpClient, HttpClientRequest } from "effect/http"

import {
	type BrowserLoginClient,
	desktopClient,
	desktopLogin,
	nativeHeaders,
	nativeSession,
} from "./contract.ts"

/**
 * The desktop app's side of browser sign-in (browser-safe; no server code): a vault over a
 * host-provided secure store, the native transport that carries its session in headers, and
 * the sign-in, session and sign-out calls.
 */

/** Where the vault keeps its one JSON record: the OS keychain in the desktop app. */
export interface RecordStore {
	readonly read: Effect.Effect<string | null, BrowserLogin.PlatformError>
	readonly write: (json: string) => Effect.Effect<void, BrowserLogin.PlatformError>
}

const recordJson = Schema.fromJsonString(BrowserLogin.VaultRecord)
type VaultRecord = typeof BrowserLogin.VaultRecord.Type
const slots = BrowserLogin.VaultRecord.fields.credentials.key.literals

const storageFailure = () => BrowserLogin.PlatformError.make({ reason: "storage" })

/**
 * `BrowserLogin.Vault` over a `RecordStore`. Never resets an unreadable record: it may hold the
 * `Exchanging` fence of a sign-in whose outcome is unknown.
 */
export const layerVault = (store: RecordStore) =>
	Layer.effect(
		BrowserLogin.Vault,
		Effect.gen(function* () {
			const gate = yield* Semaphore.make(1)
			const locked = <A, E>(effect: Effect.Effect<A, E>) =>
				gate.withPermits(1)(Effect.uninterruptible(effect))

			const readRecord = Effect.gen(function* () {
				const json = yield* store.read
				if (json === null) return { credentials: {} } satisfies VaultRecord
				return yield* Schema.decodeEffect(recordJson)(json).pipe(Effect.mapError(storageFailure))
			})

			const writeRecord = (record: VaultRecord) =>
				Schema.encodeEffect(recordJson)(record).pipe(
					Effect.mapError(storageFailure),
					Effect.flatMap(store.write),
				)

			return BrowserLogin.Vault.of({
				read: locked(
					Effect.gen(function* () {
						const record = yield* readRecord
						const now = DateTime.toEpochMillis(yield* DateTime.now)
						const credentials: Partial<Record<CredentialSlot, Redacted.Redacted<string>>> = {}
						for (const slot of slots) {
							const value = record.credentials[slot]
							if (value !== undefined && value.expiresAtMillis > now)
								credentials[slot] = value.credential
						}
						return credentials
					}),
				).pipe(Effect.mapError(() => OperationHttpError.make({ reason: "credentials" }))),
				accept: (commands) =>
					locked(
						Effect.gen(function* () {
							const record = yield* readRecord
							const credentials = { ...record.credentials }
							for (const command of commands) {
								if (command._tag === "Clear") delete credentials[command.slot]
								else
									credentials[command.slot] = {
										credential: command.credential,
										expiresAtMillis: command.expiresAtMillis,
									}
							}
							yield* writeRecord({ ...record, credentials })
						}),
					).pipe(Effect.mapError(() => OperationHttpError.make({ reason: "credentials" }))),
				loadAttempt: locked(readRecord.pipe(Effect.map((record) => record.attempt))),
				saveAttempt: (attempt) =>
					locked(
						Effect.gen(function* () {
							const record = yield* readRecord
							yield* writeRecord(
								attempt === undefined
									? { credentials: record.credentials }
									: { ...record, attempt },
							)
						}),
					),
			})
		}),
	)

/** Fetch for the native transport: no cookies, no redirects, tagged as the desktop app. */
const nativeHttpClient = Effect.map(Effect.service(HttpClient.HttpClient), (client) =>
	client.pipe(
		HttpClient.mapRequest(
			HttpClientRequest.setHeader(nativeHeaders.clientHeader, nativeHeaders.clientValue),
		),
	),
)

/**
 * Sign-in, session and sign-out for the desktop app. Needs `BrowserLogin.Browser` (opens the
 * hosted page, returns the callback), `BrowserLogin.Vault`, `Crypto` and an `HttpClient` that
 * neither sends cookies nor follows redirects.
 */
export const makeDesktopAuth = Effect.fnUntraced(function* (options: {
	/** The API origin (`VITE_BACKEND_URL`). */
	readonly apiOrigin: string
	/** The web app's handoff page, e.g. `https://app.hazel.sh/auth/desktop`. */
	readonly hostedUrl: string
	/** The app signing in, and so the link the browser returns to. @default desktopClient */
	readonly client?: BrowserLoginClient
}) {
	const client = options.client ?? desktopClient
	const vault = yield* BrowserLogin.Vault
	const http = yield* nativeHttpClient

	const transport = yield* OperationHttpClient.make({
		baseUrl: options.apiOrigin,
		csrfHeader: "x-effect-auth-csrf",
		csrfValue: "1",
		native: {
			modeHeader: nativeHeaders.modeHeader,
			requestHeaders: Object.fromEntries(
				slots.map((slot) => [slot, `${nativeHeaders.requestPrefix}${slot}`]),
			) as Readonly<Record<CredentialSlot, string>>,
			responseHeaders: Object.fromEntries(
				slots.map((slot) => [slot, `${nativeHeaders.responsePrefix}${slot}`]),
			) as Readonly<Record<CredentialSlot, string>>,
			credentials: BrowserLogin.Vault,
		},
	}).pipe(Effect.provideService(HttpClient.HttpClient, http))

	const login = yield* BrowserLogin.makeClient(desktopLogin, {
		clientId: client.clientId,
		returnUrl: client.returnUrl,
		hostedUrl: options.hostedUrl,
	}).pipe(Effect.provideService(OperationHttpClient.Client, transport))

	/** The signed-in session, or `null`. Asks the API, so a revoked session reads as signed out. */
	const session = Effect.gen(function* () {
		if ((yield* vault.read).session === undefined) return null
		return yield* transport
			.call(nativeSession.routes.session, {})
			.pipe(Effect.catchTag("SessionInvalid", () => Effect.succeed(null)))
	})

	/** The raw session credential, for the app's own API calls (`Authorization: Bearer`). */
	const credential = Effect.map(vault.read, (credentials) =>
		credentials.session === undefined ? null : Redacted.value(credentials.session),
	)

	/** Ends the session on the API; the vault forgets it either way. */
	const signOut = Effect.gen(function* () {
		if ((yield* vault.read).session === undefined) return
		yield* transport.call(nativeSession.routes.signOut, {}, { replaceSubject: true }).pipe(Effect.ignore)
		yield* vault.accept([{ _tag: "Clear", slot: "session" }])
	})

	/**
	 * A sign-in whose exchange failed keeps its attempt `Exchanging`: the library cannot tell a
	 * refused exchange from a lost answer, and refuses every later sign-in as busy, across
	 * restarts. With no session in the vault the exchange gave this app nothing, so the attempt
	 * is retired and a new sign-in can start (a session the server issued but never delivered
	 * only expires).
	 */
	const retireFailedExchange = Effect.gen(function* () {
		const pending = yield* vault.loadAttempt
		if (pending?.phase !== "Exchanging") return
		if ((yield* vault.read).session !== undefined) return
		yield* login.acknowledge
	})

	return {
		/** Opens the browser and waits for its callback, then exchanges it for a session. */
		signIn: Effect.andThen(retireFailedExchange, login.signIn),
		/** Continues a sign-in left waiting (the app restarted mid-way). */
		resume: login.resume,
		cancel: login.cancel,
		status: login.status,
		acknowledge: login.acknowledge,
		pendingAttempt: vault.loadAttempt,
		session,
		credential,
		signOut,
	}
})

export type DesktopAuth = Effect.Success<ReturnType<typeof makeDesktopAuth>>
