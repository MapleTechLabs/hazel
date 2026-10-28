import { Schema } from "effect"

/** A delivery attempt failed; the outbox retries it with backoff unless `retryable` is false. */
export class OutboxDeliveryError extends Schema.TaggedError<OutboxDeliveryError>()("OutboxDeliveryError", {
	message: Schema.String,
	/** `false` marks the row dead right away (the receiver will never accept it). */
	retryable: Schema.optional(Schema.Boolean),
}) {}

/** The socket attachment would exceed workerd's 2 KiB limit (the principal is too large). */
export class SyncAttachmentTooLargeError extends Schema.TaggedError<SyncAttachmentTooLargeError>()(
	"SyncAttachmentTooLargeError",
	{
		bytes: Schema.Number,
	},
) {}
