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
	 * Updates the user's profile (name, avatar) and preferences (timezone, settings).
	 * The email comes from the sign-in provider and is not editable here. The avatar is
	 * uploaded first (`type: "user-avatar"`), then its public URL is set; `null` removes it.
	 *
	 * @param payload - User ID and the fields to update
	 * @returns Updated user data and transaction ID
	 * @throws UserNotFoundError if user doesn't exist
	 * @throws UnauthorizedError if user lacks permission
	 * @throws InternalServerError for unexpected errors
	 */
	Rpc.make("user.update", {
		payload: Schema.Struct({
			id: UserId,
			firstName: Schema.optional(Schema.Trim.check(Schema.isNonEmpty(), Schema.isMaxLength(100))),
			lastName: Schema.optional(Schema.Trim.check(Schema.isMaxLength(100))),
			avatarUrl: Schema.optional(Schema.NullOr(Schema.NonEmptyString)),
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
