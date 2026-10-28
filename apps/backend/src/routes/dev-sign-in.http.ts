/**
 * `POST /internal/dev/sign-in`: signs in as any email without an OAuth app, for local dev and
 * PR previews (`scripts/dev-sign-in.ts`). Mounted only when `DEV_SIGNIN_SECRET` is set on a non-prd
 * stage (`worker/env.ts` never passes it to prd, and `HazelAuthInstance` drops it there,
 * `lib/stage.ts`); without it, and for a missing or wrong `Authorization: Bearer <secret>`, it
 * answers 404 like an unknown route.
 *
 * Body `{ email, name? }`. Finds or creates the user through the real GitHub sign-in flow
 * (`@hazel/auth/server` `makeDevSignIn`) and answers `{ userId, sessionToken }` with the session
 * cookie the browser flow sets; `sessionToken` is the bearer native clients send.
 */
import { makeDevSignIn } from "@hazel/auth/server"
import { Effect, Layer, Option, Redacted, Schema } from "effect"
import { Cookies, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http"
import { HazelAuthInstance } from "../services/hazel-auth"
import { HazelSession } from "../services/hazel-session"

const DevSignInBody = Schema.Struct({
	email: Schema.Trim.check(
		Schema.isMinLength(3),
		Schema.isMaxLength(320),
		Schema.isPattern(/^[^@\s]+@[^@\s]+$/),
	),
	name: Schema.optional(Schema.String.check(Schema.isMaxLength(200))),
})

const decodeBody = Schema.decodeUnknownEffect(DevSignInBody)

/** Constant-time comparison: both sides are hashed first, so neither length nor content leaks. */
const sameSecret = (given: string, expected: string) =>
	Effect.promise(async () => {
		const digest = (value: string) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
		const [a, b] = await Promise.all([digest(given), digest(expected)])
		const left = new Uint8Array(a)
		const right = new Uint8Array(b)
		let diff = 0
		for (let i = 0; i < left.length; i++) diff |= left[i]! ^ right[i]!
		return diff === 0
	})

const notFound = HttpServerResponse.empty({ status: 404 })

export const DevSignInRoutes = Layer.unwrap(
	Effect.gen(function* () {
		const instance = yield* HazelAuthInstance
		if (Option.isNone(instance) || Option.isNone(instance.value.devSignInSecret)) return Layer.empty
		const secret = Redacted.value(instance.value.devSignInSecret.value)
		const sessions = yield* HazelSession
		const signIn = yield* makeDevSignIn(instance.value.config)
		yield* Effect.logWarning("[auth] DEV_SIGNIN_SECRET is set: POST /internal/dev/sign-in is enabled")

		return HttpRouter.add(
			"POST",
			"/internal/dev/sign-in",
			Effect.gen(function* () {
				const request = yield* HttpServerRequest.HttpServerRequest
				const authorization = request.headers.authorization ?? ""
				const bearer = authorization.startsWith("Bearer ") ? authorization.slice(7) : ""
				if (!(yield* sameSecret(bearer, secret))) return notFound

				const body = yield* request.json.pipe(Effect.flatMap(decodeBody), Effect.option)
				if (Option.isNone(body))
					return HttpServerResponse.text("Expected { email, name? }", { status: 400 })

				const result = yield* signIn(body.value)
				// The session must be one the RPC and HttpApi middleware accept.
				const user = yield* sessions.verify(Redacted.value(result.sessionToken))
				if (Option.isNone(user))
					return HttpServerResponse.text("The issued session did not verify", { status: 500 })

				return yield* HttpServerResponse.json({
					userId: user.value.id,
					sessionToken: Redacted.value(result.sessionToken),
				}).pipe(Effect.map(HttpServerResponse.mergeCookies(Cookies.fromSetCookie(result.setCookie))))
			}).pipe(
				Effect.catchTags({
					DevSignInError: (error) =>
						Effect.logError("[auth] dev sign-in failed", { reason: error.reason }).pipe(
							Effect.as(HttpServerResponse.text(error.reason, { status: 500 })),
						),
					InvalidBearerTokenError: (error) =>
						Effect.succeed(
							HttpServerResponse.text(error.detail ?? error.message, { status: 500 }),
						),
					SessionLoadError: () =>
						Effect.succeed(
							HttpServerResponse.text("The session store is unavailable", {
								status: 503,
								headers: { "retry-after": "1" },
							}),
						),
				}),
				Effect.withSpan("DevSignIn.signIn"),
			),
		)
	}),
)
