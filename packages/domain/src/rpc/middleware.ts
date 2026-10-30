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
	InvalidBearerTokenError,
	SessionLoadError,
	SessionNotProvidedError,
} from "../session-errors"

/**
 * Authentication middleware that provides CurrentUser context to RPC handlers.
 *
 * Resolves the Hazel session (cookie or bearer credential) or a bot token and
 * populates the `CurrentUser` Effect context for the handler.
 */
const AuthFailure = S.Union([
	UnauthorizedError,
	SessionLoadError,
	SessionNotProvidedError,
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
