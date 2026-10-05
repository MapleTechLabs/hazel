import { Rpc, RpcGroup } from "effect/rpc"
import { Schema } from "effect"
import { InternalServerError, UnauthorizedError } from "../errors"
import { CustomEmojiId, OrganizationId, TransactionId } from "@hazel/schema"
import { CustomEmoji } from "../models"
import { AuthMiddleware } from "./middleware"
import { RequiredScopes } from "../scopes/required-scopes"

/**
 * Response schema for successful custom emoji operations.
 * Contains the custom emoji data and a transaction ID for optimistic updates.
 */
export class CustomEmojiResponse extends Schema.Class<CustomEmojiResponse>("CustomEmojiResponse")({
	data: CustomEmoji.Schema,
	transactionId: TransactionId,
}) {}

/**
 * Error thrown when a custom emoji is not found.
 */
export class CustomEmojiNotFoundError extends Schema.TaggedError<CustomEmojiNotFoundError>()(
	"CustomEmojiNotFoundError",
	{
		customEmojiId: CustomEmojiId,
	},
) {}

/**
 * Error thrown when a custom emoji name conflicts with an existing one in the same org.
 */
export class CustomEmojiNameConflictError extends Schema.TaggedError<CustomEmojiNameConflictError>()(
	"CustomEmojiNameConflictError",
	{
		name: Schema.String,
		organizationId: OrganizationId,
	},
) {}

/**
 * Error thrown when a custom emoji with the same name exists but was soft-deleted.
 * Contains the deleted emoji's info so the frontend can offer to restore it.
 */
export class CustomEmojiDeletedExistsError extends Schema.TaggedError<CustomEmojiDeletedExistsError>()(
	"CustomEmojiDeletedExistsError",
	{
		customEmojiId: CustomEmojiId,
		name: Schema.String,
		imageUrl: Schema.String,
		organizationId: OrganizationId,
	},
) {}

export class CustomEmojiRpcs extends RpcGroup.make(
	/**
	 * CustomEmojiCreate
	 *
	 * Creates a new custom emoji for an organization.
	 *
	 * @param payload - Custom emoji data (organizationId, name, imageUrl)
	 * @returns Custom emoji data and transaction ID
	 * @throws CustomEmojiNameConflictError if name already exists in org
	 * @throws CustomEmojiDeletedExistsError if a deleted emoji with the same name exists
	 * @throws UnauthorizedError if user lacks permission
	 * @throws InternalServerError for unexpected errors
	 */
	Rpc.make("customEmoji.create", {
		payload: Schema.Struct({
			organizationId: OrganizationId,
			name: Schema.String,
			imageUrl: Schema.String,
		}),
		success: CustomEmojiResponse,
		error: Schema.Union([
			CustomEmojiNameConflictError,
			CustomEmojiDeletedExistsError,
			UnauthorizedError,
			InternalServerError,
		]),
	})
		.annotate(RequiredScopes, ["custom-emojis:write"])
		.middleware(AuthMiddleware),

	/**
	 * CustomEmojiUpdate
	 *
	 * Updates an existing custom emoji (rename).
	 *
	 * @param payload - Custom emoji ID and optional new name
	 * @returns Updated custom emoji data and transaction ID
	 * @throws CustomEmojiNotFoundError if emoji doesn't exist
	 * @throws CustomEmojiNameConflictError if new name conflicts
	 * @throws UnauthorizedError if user lacks permission
	 * @throws InternalServerError for unexpected errors
	 */
	Rpc.make("customEmoji.update", {
		payload: Schema.Struct({
			id: CustomEmojiId,
			name: Schema.optional(Schema.String),
		}),
		success: CustomEmojiResponse,
		error: Schema.Union([
			CustomEmojiNotFoundError,
			CustomEmojiNameConflictError,
			UnauthorizedError,
			InternalServerError,
		]),
	})
		.annotate(RequiredScopes, ["custom-emojis:write"])
		.middleware(AuthMiddleware),

	/**
	 * CustomEmojiDelete
	 *
	 * Soft-deletes a custom emoji.
	 *
	 * @param payload - Custom emoji ID
	 * @returns Transaction ID
	 * @throws CustomEmojiNotFoundError if emoji doesn't exist
	 * @throws UnauthorizedError if user lacks permission
	 * @throws InternalServerError for unexpected errors
	 */
	Rpc.make("customEmoji.delete", {
		payload: Schema.Struct({ id: CustomEmojiId }),
		success: Schema.Struct({ transactionId: TransactionId }),
		error: Schema.Union([CustomEmojiNotFoundError, UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["custom-emojis:write"])
		.middleware(AuthMiddleware),

	/**
	 * CustomEmojiRestore
	 *
	 * Restores a previously soft-deleted custom emoji.
	 *
	 * @param payload - Custom emoji ID and optional new image URL
	 * @returns Restored custom emoji data and transaction ID
	 * @throws CustomEmojiNotFoundError if emoji doesn't exist
	 * @throws CustomEmojiNameConflictError if an active emoji with the same name exists
	 * @throws UnauthorizedError if user lacks permission
	 * @throws InternalServerError for unexpected errors
	 */
	Rpc.make("customEmoji.restore", {
		payload: Schema.Struct({
			id: CustomEmojiId,
			imageUrl: Schema.optional(Schema.String),
		}),
		success: CustomEmojiResponse,
		error: Schema.Union([
			CustomEmojiNotFoundError,
			CustomEmojiNameConflictError,
			UnauthorizedError,
			InternalServerError,
		]),
	})
		.annotate(RequiredScopes, ["custom-emojis:write"])
		.middleware(AuthMiddleware),
) {}
