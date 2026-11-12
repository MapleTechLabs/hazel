import { BrowserLogin, OperationHttp, OperationHttpServer, Operations } from "@yielded/auth"
import { BrowserLoginPersistence } from "@yielded/auth-persistence"
import { hooksLayer } from "@yielded/auth/Persistence"
import { Effect, Layer } from "effect"
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"

import { HazelAuth, sessionConfiguration } from "./auth.ts"
import { browserLoginClients, desktopLogin, nativeHeaders, nativeSession } from "./contract.ts"
import type { HazelAuthConfig } from "./server.ts"

/**
 * Desktop sign-in through the system browser (`BrowserLogin`):
 * - the web app's `/auth/desktop` page describes the attempt and authorizes it with the
 *   browser's session cookie, then opens the client's callback (`com.hazel.app://auth/callback`);
 * - the desktop app exchanges that callback for its own session (native mode: credentials in
 *   headers, never cookies) and later verifies or ends it at `/auth/native/*`.
 *
 * Needs the auth services (`makeHazelAuthLive(...).Services`) below it.
 */
export const makeDesktopLoginRoutes = (config: HazelAuthConfig) => {
	const secure = new URL(config.origin).protocol === "https:"

	// Mirrors `Http.make`'s defaults, so the browser's session cookie and CSRF header are the same.
	const configuration = OperationHttpServer.configurationLayer({
		publicOrigin: config.origin,
		trustedOrigins: [...new Set([config.origin, ...(config.trustedOrigins ?? [])])],
		csrfHeader: "x-effect-auth-csrf",
		csrfValue: "1",
		maximumBodyBytes: 16_384,
		maximumUrlBytes: 4096,
		cookies: OperationHttpServer.cookieConfiguration({
			prefix: secure ? "__Host-effect-auth-" : "effect-auth-",
			secure,
		}),
		native: {
			modeHeader: nativeHeaders.modeHeader,
			requestHeaders: OperationHttpServer.headerConfiguration(nativeHeaders.requestPrefix),
			responseHeaders: OperationHttpServer.headerConfiguration(nativeHeaders.responsePrefix),
			// A public-client admission marker, not authentication: PKCE and the session
			// credential carry the authority.
			authorize: (request) =>
				request.headers.get(nativeHeaders.clientHeader) === nativeHeaders.clientValue &&
				request.headers.get("content-type")?.startsWith("application/json")
					? Effect.void
					: Effect.fail(OperationHttp.OperationHttpError.make({ reason: "origin" })),
		},
	})

	/** Who is calling: the browser's cookie session for `authorize`; a guest otherwise. */
	const invocation = OperationHttpServer.invocationLayer(
		Effect.fnUntraced(function* (request, credentials) {
			if (
				new URL(request.url).pathname === desktopLogin.routes.describe.path ||
				request.headers.has(nativeHeaders.modeHeader) ||
				credentials.session === undefined
			)
				return Operations.guest

			const session = yield* (yield* HazelAuth.sessions.SessionStrategy)
				.inspect(credentials.session)
				.pipe(
					Effect.map((source) => source.inspection.session),
					Effect.mapError(() => OperationHttp.OperationHttpError.make({ reason: "credentials" })),
				)

			return {
				_tag: "Authenticated" as const,
				subjectId: session.subjectId,
				sessionId: session.sessionId,
				assurance: session.assurance,
			}
		}),
	)

	const browserLogin = BrowserLogin.make(HazelAuth.sessions, {
		basePath: "/auth/browser-login",
		clients: browserLoginClients,
		// The longest allowed: the browser may need a full OAuth sign-in (or registration) first.
		lifetimeMillis: 300_000,
	})

	const post = <R>(path: string, handle: (request: Request) => Effect.Effect<Response, never, R>) =>
		HttpRouter.route(
			"POST",
			path as `/${string}`,
			Effect.gen(function* () {
				const request = yield* HttpServerRequest.toWeb(yield* HttpServerRequest.HttpServerRequest)
				return HttpServerResponse.fromWeb(yield* handle(request))
			}),
		)

	return Layer.unwrap(
		Effect.gen(function* () {
			const login = yield* browserLogin.http
			const native = yield* OperationHttpServer.make(nativeSession)

			return HttpRouter.addAll([
				...Object.values(browserLogin.routes).map((route) => post(route.path, login.handle)),
				...Object.values(nativeSession.routes).map((route) =>
					post(route.path, (request) =>
						request.headers.get(nativeHeaders.modeHeader) === "native"
							? native.handle(request)
							: Effect.succeed(new Response(null, { status: 403 })),
					),
				),
			])
		}),
	).pipe(
		HttpRouter.provideRequest(
			Layer.mergeAll(
				HazelAuth.sessions.sessionHandlersLayer,
				browserLogin.layer.pipe(
					Layer.provide(BrowserLoginPersistence.layer.pipe(Layer.provide(hooksLayer))),
				),
			),
		),
		Layer.provide(Layer.mergeAll(configuration, invocation)),
		Layer.provide(HazelAuth.sessions.layer(sessionConfiguration.policy(HazelAuth.sessions.moduleId))),
	)
}

/** Removes expired handoff attempts; run on a schedule (it never revokes issued sessions). */
export const cleanupDesktopLogins = (limit: number) =>
	BrowserLogin.make(HazelAuth.sessions, {
		basePath: "/auth/browser-login",
		clients: browserLoginClients,
	}).cleanup(limit)
