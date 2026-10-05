/**
 * RPC Middleware Definitions (Client-Safe)
 *
 * This file contains ONLY middleware class definitions that are safe to import
 * in browser code. Server-side implementations live in the backend package.
 */

import { RpcMiddleware } from "effect/rpc"
import { Schema as S } from "effect"
import * as CurrentUser from "../current-user"
import { UnauthorizedError } from "../errors"
import {
	ClerkUserFetchError,
	InvalidBearerTokenError,
	InvalidJwtPayloadError,
	SessionAuthenticationError,
	SessionExpiredError,
	SessionLoadError,
	SessionNotProvidedError,
	SessionRefreshError,
} from "../session-errors"

/**
 * Authentication middleware that provides CurrentUser context to RPC handlers.
 *
 * Verifies a Clerk bearer JWT from the `Authorization` header and populates
 * the `CurrentUser` Effect context for the handler.
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
	ClerkUserFetchError,
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
