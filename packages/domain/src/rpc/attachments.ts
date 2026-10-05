import { Rpc, RpcGroup } from "effect/rpc"
import { Schema } from "effect"
import { InternalServerError, UnauthorizedError } from "../errors"
import { AttachmentId } from "@hazel/schema"
import { Attachment } from "../models"
import { TransactionId } from "@hazel/schema"
import { AuthMiddleware } from "./middleware"
import { RequiredScopes } from "../scopes/required-scopes"

/**
 * Error thrown when an attachment is not found.
 * Used in delete operations.
 */
export class AttachmentNotFoundError extends Schema.TaggedError<AttachmentNotFoundError>()(
	"AttachmentNotFoundError",
	{
		attachmentId: AttachmentId,
	},
) {}

/**
 * Attachment RPC Group
 *
 * Defines RPC methods for attachment operations:
 * - AttachmentDelete: Delete an attachment
 *
 * All methods require authentication via AuthMiddleware.
 *
 * Example usage from frontend:
 * ```typescript
 * const client = yield* RpcClient
 *
 * // Delete attachment
 * yield* client.AttachmentDelete({ id: "..." })
 * ```
 */
export class AttachmentRpcs extends RpcGroup.make(
	/**
	 * AttachmentDelete
	 *
	 * Deletes an attachment (soft delete).
	 * Only the uploader or users with appropriate permissions can delete.
	 *
	 * @param payload - Attachment ID to delete
	 * @returns Transaction ID
	 * @throws AttachmentNotFoundError if attachment doesn't exist
	 * @throws UnauthorizedError if user lacks permission
	 * @throws InternalServerError for unexpected errors
	 */
	Rpc.make("attachment.delete", {
		payload: Schema.Struct({ id: AttachmentId }),
		success: Schema.Struct({ transactionId: TransactionId }),
		error: Schema.Union([AttachmentNotFoundError, UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["attachments:write"])
		.middleware(AuthMiddleware),

	/**
	 * AttachmentComplete
	 *
	 * Marks an attachment as complete after direct upload to R2.
	 * Only the original uploader can mark as complete.
	 *
	 * @param payload - Attachment ID to mark complete
	 * @returns The completed attachment model
	 * @throws AttachmentNotFoundError if attachment doesn't exist
	 * @throws UnauthorizedError if user is not the uploader
	 * @throws InternalServerError for unexpected errors
	 */
	Rpc.make("attachment.complete", {
		payload: Schema.Struct({ id: AttachmentId }),
		success: Attachment.Schema,
		error: Schema.Union([AttachmentNotFoundError, UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["attachments:write"])
		.middleware(AuthMiddleware),

	/**
	 * AttachmentFail
	 *
	 * Marks an attachment as failed after an upload error.
	 * Only the original uploader can mark as failed.
	 *
	 * @param payload - Attachment ID and optional failure reason
	 * @returns void
	 * @throws AttachmentNotFoundError if attachment doesn't exist
	 * @throws UnauthorizedError if user is not the uploader
	 * @throws InternalServerError for unexpected errors
	 */
	Rpc.make("attachment.fail", {
		payload: Schema.Struct({
			id: AttachmentId,
			reason: Schema.optional(Schema.String),
		}),
		success: Schema.Void,
		error: Schema.Union([AttachmentNotFoundError, UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["attachments:write"])
		.middleware(AuthMiddleware),
) {}
