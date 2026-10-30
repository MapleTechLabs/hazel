import { HttpApiMiddleware, HttpApiSecurity } from "effect/http-api"
import { Context as EffectContext, Schema as S } from "effect"
import { UnauthorizedError } from "./errors"
import { OrganizationId, UserId } from "@hazel/schema"
import { User } from "./models"
import { InvalidBearerTokenError, SessionLoadError, SessionNotProvidedError } from "./session-errors"

export class Schema extends S.Class<Schema>("CurrentUserSchema")({
	id: UserId,
	organizationId: S.NullishOr(OrganizationId),
	role: S.Literals(["admin", "member", "owner"]),
	avatarUrl: S.optional(S.String),
	firstName: S.optional(S.String),
	lastName: S.optional(S.String),
	email: S.String,
	isOnboarded: S.Boolean,
	timezone: S.NullOr(S.String),
	settings: S.NullOr(User.UserSettingsSchema),
}) {}

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
