import { Rpc, RpcGroup } from "effect/rpc"
import { Schema } from "effect"
import * as CurrentUser from "../current-user"
import { InternalServerError, UnauthorizedError } from "../errors"
import { UserId } from "@hazel/schema"
import { User } from "../models"
import { TransactionId } from "@hazel/schema"
import { AuthMiddleware } from "./middleware"
import { RequiredScopes } from "../scopes/required-scopes"

/**
 * Response schema for successful user operations.
 * Contains the user data and a transaction ID for optimistic updates.
 */
export class UserResponse extends Schema.Class<UserResponse>("UserResponse")({
	data: User.Schema,
	transactionId: TransactionId,
}) {}

/**
 * Error thrown when a user is not found.
 * Used in update operations.
 */
export class UserNotFoundError extends Schema.TaggedError<UserNotFoundError>()("UserNotFoundError", {
	userId: UserId,
}) {}

export class UserRpcs extends RpcGroup.make(
	/**
	 * UserMe
	 *
	 * Get the currently authenticated user.
	 *
	 * @returns Current user data
	 * @throws UnauthorizedError if user is not authenticated
	 * @throws InternalServerError for unexpected errors
	 */
	Rpc.make("user.me", {
		payload: Schema.Void,
		success: CurrentUser.Schema,
		error: Schema.Union([UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["users:read"])
		.middleware(AuthMiddleware),

	/**
	 * UserUpdate
	 *
	 * Updates Hazel-specific user preferences (timezone, settings).
	 * Identity fields (firstName, lastName, avatarUrl, email) are owned by Clerk
	 * and synced via the Clerk webhook — update them with the Clerk client SDK.
	 *
	 * @param payload - User ID and Hazel-specific fields to update
	 * @returns Updated user data and transaction ID
	 * @throws UserNotFoundError if user doesn't exist
	 * @throws UnauthorizedError if user lacks permission
	 * @throws InternalServerError for unexpected errors
	 */
	Rpc.make("user.update", {
		payload: Schema.Struct({
			id: UserId,
			timezone: Schema.optional(User.PatchPartial.fields.timezone),
			settings: Schema.optional(User.PatchPartial.fields.settings),
		}),
		success: UserResponse,
		error: Schema.Union([UserNotFoundError, UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["users:write"])
		.middleware(AuthMiddleware),

	/**
	 * UserFinalizeOnboarding
	 *
	 * Marks the current authenticated user as having completed onboarding.
	 * This sets the isOnboarded flag to true.
	 *
	 * @returns Updated user data and transaction ID
	 * @throws UnauthorizedError if user is not authenticated
	 * @throws InternalServerError for unexpected errors
	 */
	Rpc.make("user.finalizeOnboarding", {
		payload: Schema.Void,
		success: UserResponse,
		error: Schema.Union([UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["users:write"])
		.middleware(AuthMiddleware),
) {}
