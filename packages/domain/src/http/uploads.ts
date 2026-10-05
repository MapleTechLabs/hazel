import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api"
import { Schema } from "effect"
import { CurrentUser, InternalServerError, UnauthorizedError } from "../"
import { AttachmentId, BotId, ChannelId, OrganizationId } from "@hazel/schema"
import { RateLimitExceededError } from "../rate-limit-errors"
import { RequiredScopes } from "../scopes/required-scopes"

// ============ Constants ============

export const MAX_AVATAR_SIZE = 5 * 1024 * 1024 // 5MB
export const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024 // 10MB
export const MAX_EMOJI_SIZE = 256 * 1024 // 256KB

export const ALLOWED_AVATAR_TYPES = ["image/jpeg", "image/png", "image/webp"] as const
export const ALLOWED_EMOJI_TYPES = ["image/png", "image/gif", "image/webp"] as const

// ============ Upload Type Schema ============

export const UploadType = Schema.Literals([
	"user-avatar",
	"bot-avatar",
	"organization-avatar",
	"attachment",
	"custom-emoji",
])
export type UploadType = typeof UploadType.Type

// ============ Request Schemas ============

/**
 * Unified presign upload request.
 *
 * Flat struct with optional per-type fields, discriminated by `type`. We use a
 * single `Schema.Struct` (instead of a `Schema.Union` of `Schema.Class`) because
 * `HttpApiClient` encodes payloads via `Schema.encodeUnknown`, and class schemas
 * require actual class instances — plain JSON payloads fail the encode step
 * client-side with "Expected X, got {...}" before any network request is made.
 *
 * Per-type required fields (e.g. `botId` for bot-avatar, `channelId` +
 * `organizationId` + `fileName` for attachment) are validated in the backend
 * handler branches in `apps/backend/src/routes/uploads.http.ts`.
 */
export const PresignUploadRequest = Schema.Struct({
	type: UploadType,
	contentType: Schema.String,
	fileSize: Schema.Number.check(
		Schema.isBetween(
			{ minimum: 1, maximum: MAX_ATTACHMENT_SIZE },
			{ message: "File size must be between 1 byte and 10MB" },
		),
	),
	botId: Schema.optional(BotId),
	organizationId: Schema.optional(OrganizationId),
	channelId: Schema.optional(ChannelId),
	fileName: Schema.optional(Schema.String),
})
export type PresignUploadRequest = typeof PresignUploadRequest.Type

// ============ Per-type DTO shapes (TS-only) ============
// These are convenience types for callers that build narrower payloads.
// They intentionally do not exist as runtime Schemas — see the note above.

export type UserAvatarUploadRequest = {
	type: "user-avatar"
	contentType: string
	fileSize: number
}

export type BotAvatarUploadRequest = {
	type: "bot-avatar"
	botId: BotId
	contentType: string
	fileSize: number
}

export type OrganizationAvatarUploadRequest = {
	type: "organization-avatar"
	organizationId: OrganizationId
	contentType: string
	fileSize: number
}

export type AttachmentUploadRequest = {
	type: "attachment"
	fileName: string
	contentType: string
	fileSize: number
	organizationId: OrganizationId
	channelId: ChannelId
}

export type CustomEmojiUploadRequest = {
	type: "custom-emoji"
	organizationId: OrganizationId
	contentType: string
	fileSize: number
}

// ============ Response Schema ============

/**
 * Unified presign upload response
 *
 * - uploadUrl: The presigned URL to upload the file to
 * - key: The storage key (path) where the file will be stored
 * - publicUrl: The public URL to access the file after upload
 * - resourceId: For attachments, the AttachmentId; undefined for avatars
 */
export class PresignUploadResponse extends Schema.Class<PresignUploadResponse>("PresignUploadResponse")({
	uploadUrl: Schema.String,
	key: Schema.String,
	publicUrl: Schema.String,
	resourceId: Schema.optional(AttachmentId),
}) {}

// ============ Error Schemas ============

export class UploadError extends Schema.TaggedError<UploadError>("UploadError")(
	"UploadError",
	{
		message: Schema.String,
	},
	{ httpApiStatus: 500 },
) {}

export class BotNotFoundForUploadError extends Schema.TaggedError<BotNotFoundForUploadError>(
	"BotNotFoundForUploadError",
)(
	"BotNotFoundForUploadError",
	{
		botId: BotId,
	},
	{ httpApiStatus: 404 },
) {}

export class OrganizationNotFoundForUploadError extends Schema.TaggedError<OrganizationNotFoundForUploadError>(
	"OrganizationNotFoundForUploadError",
)(
	"OrganizationNotFoundForUploadError",
	{
		organizationId: OrganizationId,
	},
	{ httpApiStatus: 404 },
) {}

// ============ API Group ============

/**
 * Uploads API Group
 *
 * Unified endpoint for all file uploads (user avatars, bot avatars, attachments).
 * Rate limiting for avatars (5 req/hour per user) is applied in the handler.
 */
export class UploadsGroup extends HttpApiGroup.make("uploads")
	.add(
		HttpApiEndpoint.post("presign", "/presign", {
			payload: PresignUploadRequest,
			success: PresignUploadResponse,
			error: [
				UploadError,
				BotNotFoundForUploadError,
				OrganizationNotFoundForUploadError,
				UnauthorizedError,
				InternalServerError,
				RateLimitExceededError,
			],
		}).annotate(RequiredScopes, ["attachments:write"]),
	)
	.prefix("/uploads")
	.middleware(CurrentUser.Authorization) {}
