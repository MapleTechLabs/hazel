/**
 * Auth Middleware Class Definition (Client-Safe)
 *
 * This file contains ONLY the middleware class definition that is safe to import
 * in browser code. The server-side implementation is in auth.ts.
 *
 * This separation prevents accidentally bundling server-side code (UserRepo, etc.)
 * when frontend imports RPC group definitions that reference this middleware.
 */

import { RpcMiddleware } from "effect/rpc"
import {
	CurrentUser,
	InvalidBearerTokenError,
	InvalidJwtPayloadError,
	SessionAuthenticationError,
	SessionExpiredError,
	SessionLoadError,
	SessionNotProvidedError,
	SessionRefreshError,
	UnauthorizedError,
} from "@hazel/domain"
import { Schema as S } from "effect"

/**
 * Authentication middleware that provides CurrentUser context to RPC handlers.
 *
 * Verifies a Clerk bearer JWT from the `Authorization` header, loads the
 * matching Hazel user, and exposes it to the handler via Effect context.
 */
const AuthFailure = S.Union([
	UnauthorizedError,
	SessionLoadError,
	SessionAuthenticationError,
	InvalidJwtPayloadError,
	SessionNotProvidedError,
	SessionRefreshError,
	SessionExpiredError,
	InvalidBearerTokenError,
])

export class AuthMiddleware extends RpcMiddleware.Service<
	AuthMiddleware,
	{
		provides: CurrentUser.Context
	}
>()("AuthMiddleware", {
	error: AuthFailure,
	requiredForClient: true,
}) {}
