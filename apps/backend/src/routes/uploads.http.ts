import { HttpApiBuilder } from "effect/http-api"
import { BotRepo } from "@hazel/backend-core"
import { CurrentUser, UnauthorizedError, withRemapDbErrors } from "@hazel/domain"
import {
	ALLOWED_AVATAR_TYPES,
	ALLOWED_EMOJI_TYPES,
	BotNotFoundForUploadError,
	MAX_AVATAR_SIZE,
	MAX_EMOJI_SIZE,
	OrganizationNotFoundForUploadError,
	PresignUploadResponse,
	UploadError,
} from "@hazel/domain/http"
import { AttachmentId, type OrganizationId, type UserId } from "@hazel/schema"
import { v7 as randomUUIDv7 } from "uuid"
import { Effect, Match, Option, Schema } from "effect"
import { HazelApi } from "../api"
import { AttachmentPolicy } from "../policies/attachment-policy"
import { ObjectStorage } from "../services/object-storage"
import { checkAvatarRateLimit } from "../services/rate-limit-helpers"
import { Directory } from "../services/directory"
import { AttachmentEffects, type CreateAttachmentPayload } from "../worker/objects/channel/attachments"
import { callObject } from "../worker/objects/calls"
import { channelTarget, orgTarget } from "../worker/objects/kinds"
import { IsOrgAdminCall } from "../worker/objects/org/api-v1"
import { ObjectStubs } from "../worker/objects/protocol"

/**
 * Get the public URL base for uploaded files.
 * Falls back to empty string if not configured (frontend can still construct URL).
 */
const getPublicUrlBase = (): string => {
	return process.env.S3_PUBLIC_URL ?? ""
}

const makePresignUploadResponse = (input: {
	uploadUrl: string
	key: string
	publicUrl: string
	resourceId?: AttachmentId
}) => new PresignUploadResponse(input)

export const HttpUploadsLive = HttpApiBuilder.group(HazelApi, "uploads", (handlers) =>
	Effect.gen(function* () {
		const storage = yield* ObjectStorage
		const attachmentPolicy = yield* AttachmentPolicy
		const stubs = yield* ObjectStubs
		const directory = yield* Directory

		/** Admins and owners only: the org's members are its `OrgObject`'s. */
		const requireOrgAdmin = Effect.fn("Uploads.requireOrgAdmin")(function* (
			organizationId: OrganizationId,
			userId: UserId,
		) {
			const isAdmin = yield* callObject(IsOrgAdminCall, orgTarget(organizationId), { userId }).pipe(
				Effect.mapError(
					(error) => new UploadError({ message: "The organization is unavailable", cause: error }),
				),
			)
			if (!isAdmin) {
				return yield* new UnauthorizedError({
					message: "You can't manage this organization",
					detail: `organizationId=${organizationId}`,
				})
			}
		})

		/** Create the `uploading` row in the channel's `ChannelObject` (a Connect mount's host). */
		const createAttachmentInChannel = Effect.fn("Uploads.createAttachment")(function* (
			payload: CreateAttachmentPayload,
		) {
			const index = yield* directory
				.channel(payload.channelId)
				.pipe(withRemapDbErrors("ChannelIndex", "select"))
			const hostId = Option.match(index, {
				onNone: () => payload.channelId,
				onSome: (row) => row.hostChannelId ?? payload.channelId,
			})
			const kind = AttachmentEffects.createAttachment
			const result = yield* stubs
				.get(channelTarget(hostId))
				.applyEffect({
					objectId: hostId,
					kind: kind.name,
					payload: yield* Schema.encodeEffect(kind.payload)(payload).pipe(Effect.orDie),
					key: `attachment:${payload.id}`,
				})
				.pipe(Effect.mapError(() => new UploadError({ message: "The channel is unreachable" })))
			if (result._tag === "Rejected") {
				yield* Effect.logWarning("Attachment upload refused", { message: result.message })
				return yield* new UploadError({ message: "You can't upload to this channel" })
			}
		})

		return handlers.handle(
			"presign",
			Effect.fn(function* ({ payload }) {
				const user = yield* CurrentUser.Context
				const publicUrlBase = getPublicUrlBase()

				return yield* Match.value(payload).pipe(
					// ============ User Avatar Upload ============
					Match.when({ type: "user-avatar" }, (req) =>
						Effect.gen(function* () {
							if (
								!ALLOWED_AVATAR_TYPES.includes(
									req.contentType as (typeof ALLOWED_AVATAR_TYPES)[number],
								)
							) {
								return yield* Effect.fail(
									new UploadError({
										message: "Content type must be image/jpeg, image/png, or image/webp",
									}),
								)
							}
							if (req.fileSize > MAX_AVATAR_SIZE) {
								return yield* Effect.fail(
									new UploadError({ message: "File size must be between 1 byte and 5MB" }),
								)
							}

							// Check rate limit (5 per hour)
							yield* checkAvatarRateLimit(user.id)

							const key = `avatars/${user.id}/${randomUUIDv7()}`

							yield* Effect.logDebug(
								`Generating presigned URL for user avatar upload: ${key} (size: ${req.fileSize} bytes, type: ${req.contentType})`,
							)

							const uploadUrl = yield* storage
								.presignPut(key, { contentType: req.contentType, expiresIn: 300 })
								.pipe(
									Effect.mapError(
										(error) =>
											new UploadError({
												message: "Failed to generate presigned URL",
												cause: error,
											}),
									),
								)

							yield* Effect.logDebug(`Generated presigned URL for user avatar: ${key}`)

							return makePresignUploadResponse({
								uploadUrl,
								key,
								publicUrl: publicUrlBase ? `${publicUrlBase}/${key}` : key,
							})
						}),
					),

					// ============ Bot Avatar Upload ============
					Match.when({ type: "bot-avatar" }, (req) =>
						Effect.gen(function* () {
							if (!req.botId) {
								return yield* Effect.fail(
									new UploadError({ message: "botId is required for bot-avatar uploads" }),
								)
							}
							if (
								!ALLOWED_AVATAR_TYPES.includes(
									req.contentType as (typeof ALLOWED_AVATAR_TYPES)[number],
								)
							) {
								return yield* Effect.fail(
									new UploadError({
										message: "Content type must be image/jpeg, image/png, or image/webp",
									}),
								)
							}
							if (req.fileSize > MAX_AVATAR_SIZE) {
								return yield* Effect.fail(
									new UploadError({ message: "File size must be between 1 byte and 5MB" }),
								)
							}

							const botRepo = yield* BotRepo

							// Check if bot exists
							const botOption = yield* botRepo.findById(req.botId).pipe(Effect.orDie)
							if (Option.isNone(botOption)) {
								return yield* Effect.fail(new BotNotFoundForUploadError({ botId: req.botId }))
							}

							const bot = botOption.value

							// Check if user is the bot creator (only bot creator can update avatar)
							if (bot.createdBy !== user.id) {
								return yield* Effect.fail(
									new UnauthorizedError({
										message: "Unauthorized",
										detail: "Only the bot creator can update the avatar",
									}),
								)
							}

							// Check rate limit (5 per hour)
							yield* checkAvatarRateLimit(user.id)

							const key = `avatars/bots/${req.botId}/${randomUUIDv7()}`

							yield* Effect.logDebug(
								`Generating presigned URL for bot avatar upload: ${key} (size: ${req.fileSize} bytes, type: ${req.contentType})`,
							)

							const uploadUrl = yield* storage
								.presignPut(key, { contentType: req.contentType, expiresIn: 300 })
								.pipe(
									Effect.mapError(
										(error) =>
											new UploadError({
												message: "Failed to generate presigned URL",
												cause: error,
											}),
									),
								)

							yield* Effect.logDebug(`Generated presigned URL for bot avatar: ${key}`)

							return makePresignUploadResponse({
								uploadUrl,
								key,
								publicUrl: publicUrlBase ? `${publicUrlBase}/${key}` : key,
							})
						}),
					),

					// ============ Organization Avatar Upload ============
					Match.when({ type: "organization-avatar" }, (req) =>
						Effect.gen(function* () {
							if (!req.organizationId) {
								return yield* Effect.fail(
									new UploadError({
										message: "organizationId is required for organization-avatar uploads",
									}),
								)
							}
							if (
								!ALLOWED_AVATAR_TYPES.includes(
									req.contentType as (typeof ALLOWED_AVATAR_TYPES)[number],
								)
							) {
								return yield* Effect.fail(
									new UploadError({
										message: "Content type must be image/jpeg, image/png, or image/webp",
									}),
								)
							}
							if (req.fileSize > MAX_AVATAR_SIZE) {
								return yield* Effect.fail(
									new UploadError({ message: "File size must be between 1 byte and 5MB" }),
								)
							}

							// Check if organization exists (the directory's `org_index`)
							const orgOption = yield* directory.org(req.organizationId).pipe(Effect.orDie)
							if (Option.isNone(orgOption) || orgOption.value.deletedAt !== null) {
								return yield* Effect.fail(
									new OrganizationNotFoundForUploadError({
										organizationId: req.organizationId,
									}),
								)
							}

							// Check if user is an admin or owner of the organization
							yield* requireOrgAdmin(req.organizationId, user.id)

							// Check rate limit (5 per hour)
							yield* checkAvatarRateLimit(user.id)

							const key = `avatars/organizations/${req.organizationId}/${randomUUIDv7()}`

							yield* Effect.logDebug(
								`Generating presigned URL for organization avatar upload: ${key} (size: ${req.fileSize} bytes, type: ${req.contentType})`,
							)

							const uploadUrl = yield* storage
								.presignPut(key, { contentType: req.contentType, expiresIn: 300 })
								.pipe(
									Effect.mapError(
										(error) =>
											new UploadError({
												message: "Failed to generate presigned URL",
												cause: error,
											}),
									),
								)

							yield* Effect.logDebug(`Generated presigned URL for organization avatar: ${key}`)

							return makePresignUploadResponse({
								uploadUrl,
								key,
								publicUrl: publicUrlBase ? `${publicUrlBase}/${key}` : key,
							})
						}),
					),

					// ============ Custom Emoji Upload ============
					Match.when({ type: "custom-emoji" }, (req) =>
						Effect.gen(function* () {
							if (!req.organizationId) {
								return yield* Effect.fail(
									new UploadError({
										message: "organizationId is required for custom-emoji uploads",
									}),
								)
							}
							if (
								!ALLOWED_EMOJI_TYPES.includes(
									req.contentType as (typeof ALLOWED_EMOJI_TYPES)[number],
								)
							) {
								return yield* Effect.fail(
									new UploadError({
										message: "Content type must be image/png, image/gif, or image/webp",
									}),
								)
							}
							if (req.fileSize > MAX_EMOJI_SIZE) {
								return yield* Effect.fail(
									new UploadError({
										message: "File size must be between 1 byte and 256KB",
									}),
								)
							}

							// Check if user is admin/owner of the org
							yield* requireOrgAdmin(req.organizationId, user.id)

							// Check rate limit (reuse avatar rate limit)
							yield* checkAvatarRateLimit(user.id)

							const key = `emojis/${req.organizationId}/${randomUUIDv7()}`

							yield* Effect.logDebug(
								`Generating presigned URL for custom emoji upload: ${key} (size: ${req.fileSize} bytes, type: ${req.contentType})`,
							)

							const uploadUrl = yield* storage
								.presignPut(key, { contentType: req.contentType, expiresIn: 300 })
								.pipe(
									Effect.mapError(
										(error) =>
											new UploadError({
												message: "Failed to generate presigned URL",
												cause: error,
											}),
									),
								)

							yield* Effect.logDebug(`Generated presigned URL for custom emoji: ${key}`)

							return makePresignUploadResponse({
								uploadUrl,
								key,
								publicUrl: publicUrlBase ? `${publicUrlBase}/${key}` : key,
							})
						}),
					),

					// ============ Attachment Upload ============
					Match.when({ type: "attachment" }, (req) =>
						Effect.gen(function* () {
							const { organizationId, channelId, fileName } = req
							if (!organizationId || !channelId || !fileName) {
								return yield* Effect.fail(
									new UploadError({
										message:
											"organizationId, channelId, and fileName are required for attachment uploads",
									}),
								)
							}

							const attachmentId = AttachmentId.make(randomUUIDv7())

							yield* Effect.logDebug(
								`Generating presigned URL for attachment upload: ${attachmentId} (size: ${req.fileSize} bytes, type: ${req.contentType})`,
							)

							// The row lives in the channel's object, which refuses a non-viewer.
							yield* attachmentPolicy.canCreate()
							yield* createAttachmentInChannel({
								id: attachmentId,
								organizationId,
								channelId,
								uploadedBy: user.id,
								fileName,
								fileSize: req.fileSize,
							})

							// Generate presigned URL
							const uploadUrl = yield* storage
								.presignPut(attachmentId, { contentType: req.contentType, expiresIn: 300 })
								.pipe(
									Effect.mapError(
										(error) =>
											new UploadError({
												message: "Failed to generate presigned URL",
												cause: error,
											}),
									),
								)

							yield* Effect.logDebug(`Generated presigned URL for attachment: ${attachmentId}`)

							return makePresignUploadResponse({
								uploadUrl,
								key: attachmentId,
								publicUrl: publicUrlBase ? `${publicUrlBase}/${attachmentId}` : attachmentId,
								resourceId: attachmentId,
							})
						}),
					),

					Match.exhaustive,
				)
			}),
		)
	}),
)
