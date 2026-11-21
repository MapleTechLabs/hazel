import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api"
import { Schema } from "effect"
import { CurrentUser, InternalServerError, UnauthorizedError } from "../"
import { attachCause } from "../errors"
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
	fileSize: Schema.Finite.check(
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

// Defined here, not in a module of its own that this one re-exports: the api Worker imports the
// route graph on demand (a chunk of its own), and a side-effect-free module re-exported from a
// module both chunks load is placed in the on-demand chunk, which the shared one then imports
// at start (rolldown, under `strictExecutionOrder`).

/** One `type/subtype`, optionally with parameters: no lists, quotes or blanks. */
const SINGLE_MIME_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*(?:\s*;[^,"]*)?$/i

/**
 * Types a browser runs as a document (HTML, XML, SVG, XSL), and anything that is not a single
 * well-formed type (a browser takes the last of a comma list, and sniffs an empty one). Attachments
 * are public on the uploads domain, so one stored with such a type would run script there: clients
 * upload these files as `application/octet-stream`, and the attachment presign refuses them.
 */
export const isActiveContentType = (contentType: string): boolean => {
	if (!SINGLE_MIME_TYPE.test(contentType.trim())) return true
	const [type = ""] = contentType.split(";", 1).map((part) => part.trim().toLowerCase())
	return (
		type === "text/html" ||
		type === "application/xhtml+xml" ||
		type === "text/xml" ||
		type === "application/xml" ||
		type === "text/xsl" ||
		type === "application/xslt+xml" ||
		type.endsWith("+xml") ||
		type === "multipart/x-mixed-replace"
	)
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
export class PresignUploadResponse extends Schema.Class<
	PresignUploadResponse,
	{ readonly brand: unique symbol }
>("PresignUploadResponse")({
	uploadUrl: Schema.String,
	key: Schema.String,
	publicUrl: Schema.String,
	resourceId: Schema.optional(AttachmentId),
}) {}

// ============ Error Schemas ============

/** The upload could not be prepared. `cause` stays server-side, as on `InternalServerError`. */
export class UploadError extends Schema.TaggedError<UploadError, { readonly brand: unique symbol }>()(
	"UploadError",
	{
		message: Schema.String,
	},
	{ httpApiStatus: 500 },
) {
	/** The error with the underlying failure attached as its server-side `cause`. */
	static withCause({
		cause,
		...fields
	}: {
		readonly message: string
		readonly cause: unknown
	}): UploadError {
		const error = new UploadError(fields)
		attachCause(error, cause)
		return error
	}
}

export class BotNotFoundForUploadError extends Schema.TaggedError<
	BotNotFoundForUploadError,
	{ readonly brand: unique symbol }
>()(
	"BotNotFoundForUploadError",
	{
		botId: BotId,
	},
	{ httpApiStatus: 404 },
) {}

export class OrganizationNotFoundForUploadError extends Schema.TaggedError<
	OrganizationNotFoundForUploadError,
	{ readonly brand: unique symbol }
>()(
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
