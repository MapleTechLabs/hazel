/** The app's side of `@hazel/client-data`'s platform services: its auth and its server. */
import { ClientDataConfig, Session } from "@hazel/client-data"
import { PlatformWeb } from "@hazel/client-data/web"
import { SessionLoadError } from "@hazel/domain/errors"
import { Effect, Layer } from "effect"
import { invalidateAccessToken, peekAccessToken, readAccessToken } from "~/lib/access-token"
import { isRetryableError } from "~/lib/error-messages"
import { sessionAuthorizationEffect } from "~/lib/session-bearer"
import { apiUrl } from "~/config/server"

/**
 * The desktop app's bearer; in a browser, the cached access token when there is one (the API
 * verifies it without the session store's D1 round trips) and the cookie session otherwise. The
 * cookie still rides along, so an access token the API refuses falls back to it.
 */
export const SessionWeb = Layer.succeed(Session, {
	getAccessToken: readAccessToken,
	invalidateAccessToken,
	authorization: sessionAuthorizationEffect.pipe(
		Effect.map((authorization) => {
			if (authorization !== null) return authorization
			const token = peekAccessToken()
			return token === null ? null : `Bearer ${token}`
		}),
		// An unreadable desktop session is the auth middleware's own "could not load the session".
		Effect.catchTag("SessionBearerError", () =>
			Effect.fail(
				new SessionLoadError({
					message: "Could not read the desktop session",
					detail: "The session store did not answer",
				}),
			),
		),
	),
})

export const ClientDataConfigWeb = Layer.sync(ClientDataConfig, () => ({
	apiUrl: apiUrl(),
	isRetryableError,
}))

/** Everything `@hazel/client-data` needs in the browser. */
export const ClientPlatformWeb = Layer.mergeAll(PlatformWeb, SessionWeb, ClientDataConfigWeb)
