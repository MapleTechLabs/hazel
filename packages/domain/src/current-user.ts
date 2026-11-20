import { HttpApiMiddleware, HttpApiSecurity } from "effect/http-api"
import { Context as EffectContext, Schema as S } from "effect"
import { UnauthorizedError } from "./errors"
import { UserId } from "@hazel/schema"
import { User } from "./models"
import { InvalidBearerTokenError, SessionLoadError, SessionNotProvidedError } from "./session-errors"

export class Schema extends S.Class<Schema, { readonly brand: unique symbol }>("CurrentUserSchema")({
	id: UserId,
	role: S.Literals(["admin", "member", "owner"]),
	avatarUrl: S.optional(S.String),
	firstName: S.optional(S.String),
	lastName: S.optional(S.String),
	email: S.String,
	isOnboarded: S.Boolean,
	timezone: S.NullOr(S.String),
	settings: S.NullOr(User.UserSettingsSchema),
}) {}

/**
 * The calling actor, provided per request by the auth middleware. Services that act for the caller
 * require it in their methods on purpose: it differs on every call, so no layer could capture it.
 *
 * @effect-leakable-service
 */
export class Context extends EffectContext.Service<Context, Schema>()("CurrentUser") {}

const AuthFailure = S.Union([
	UnauthorizedError,
	SessionLoadError,
	SessionNotProvidedError,
	InvalidBearerTokenError,
])

export class Authorization extends HttpApiMiddleware.Service<
	Authorization,
	{
		provides: Context
	}
>()("Authorization", {
	error: AuthFailure,
	security: {
		bearer: HttpApiSecurity.bearer,
	},
}) {}
