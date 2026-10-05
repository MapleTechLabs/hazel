import { Rpc, RpcGroup } from "effect/rpc"
import { Schema } from "effect"
import { InternalServerError, UnauthorizedError } from "../errors"
import { ChannelId, ChannelSectionId, OrganizationId } from "@hazel/schema"
import { ChannelSection } from "../models"
import { TransactionId } from "@hazel/schema"
import { ChannelNotFoundError } from "./channels"
import { AuthMiddleware } from "./middleware"
import { RequiredScopes } from "../scopes/required-scopes"

/**
 * Response schema for successful channel section operations.
 * Contains the section data and a transaction ID for optimistic updates.
 */
export class ChannelSectionResponse extends Schema.Class<ChannelSectionResponse>("ChannelSectionResponse")({
	data: ChannelSection.Schema,
	transactionId: TransactionId,
}) {}

/**
 * Error thrown when a channel section is not found.
 * Used in update and delete operations.
 */
export class ChannelSectionNotFoundError extends Schema.TaggedError<ChannelSectionNotFoundError>()(
	"ChannelSectionNotFoundError",
	{
		sectionId: ChannelSectionId,
	},
) {}

/**
 * Request schema for creating channel sections.
 * Uses jsonCreate which includes optional id for optimistic updates.
 */
export const CreateChannelSectionRequest = ChannelSection.Create

export class ChannelSectionRpcs extends RpcGroup.make(
	/**
	 * ChannelSectionCreate
	 *
	 * Creates a new channel section in an organization.
	 * Only organization admins/owners can create sections.
	 * Sections are organization-wide and visible to all members.
	 *
	 * @param payload - Section data (name, organizationId, order) with optional id for optimistic updates
	 * @returns Section data and transaction ID
	 * @throws UnauthorizedError if user lacks admin permission
	 * @throws InternalServerError for unexpected errors
	 */
	Rpc.make("channelSection.create", {
		payload: CreateChannelSectionRequest,
		success: ChannelSectionResponse,
		error: Schema.Union([UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["channel-sections:write"])
		.middleware(AuthMiddleware),

	/**
	 * ChannelSectionUpdate
	 *
	 * Updates an existing channel section (rename, change order).
	 * Only organization admins/owners can update sections.
	 *
	 * @param payload - Section ID and fields to update
	 * @returns Updated section data and transaction ID
	 * @throws ChannelSectionNotFoundError if section doesn't exist
	 * @throws UnauthorizedError if user lacks admin permission
	 * @throws InternalServerError for unexpected errors
	 */
	Rpc.make("channelSection.update", {
		payload: Schema.Struct({
			id: ChannelSectionId,
		}).pipe(Schema.fieldsAssign(ChannelSection.PatchPartial.fields)),
		success: ChannelSectionResponse,
		error: Schema.Union([ChannelSectionNotFoundError, UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["channel-sections:write"])
		.middleware(AuthMiddleware),

	/**
	 * ChannelSectionDelete
	 *
	 * Deletes a channel section (soft delete).
	 * When a section is deleted, all channels in that section are moved to the default section (sectionId = null).
	 * Only organization admins/owners can delete sections.
	 *
	 * @param payload - Section ID to delete
	 * @returns Transaction ID
	 * @throws ChannelSectionNotFoundError if section doesn't exist
	 * @throws UnauthorizedError if user lacks admin permission
	 * @throws InternalServerError for unexpected errors
	 */
	Rpc.make("channelSection.delete", {
		payload: Schema.Struct({ id: ChannelSectionId }),
		success: Schema.Struct({ transactionId: TransactionId }),
		error: Schema.Union([ChannelSectionNotFoundError, UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["channel-sections:write"])
		.middleware(AuthMiddleware),

	/**
	 * ChannelSectionReorder
	 *
	 * Reorders all sections in an organization.
	 * Takes an ordered array of section IDs and updates their order field accordingly.
	 * Only organization admins/owners can reorder sections.
	 *
	 * @param payload - Organization ID and ordered array of section IDs
	 * @returns Transaction ID
	 * @throws UnauthorizedError if user lacks admin permission
	 * @throws InternalServerError for unexpected errors
	 */
	Rpc.make("channelSection.reorder", {
		payload: Schema.Struct({
			organizationId: OrganizationId,
			sectionIds: Schema.Array(ChannelSectionId),
		}),
		success: Schema.Struct({ transactionId: TransactionId }),
		error: Schema.Union([UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["channel-sections:write"])
		.middleware(AuthMiddleware),

	/**
	 * ChannelSectionMoveChannel
	 *
	 * Moves a channel to a different section.
	 * Set sectionId to null to move channel back to the default section.
	 * Only organization admins/owners can move channels between sections.
	 *
	 * @param payload - Channel ID and target section ID (or null for default)
	 * @returns Transaction ID
	 * @throws ChannelNotFoundError if channel doesn't exist
	 * @throws ChannelSectionNotFoundError if section doesn't exist or belongs to different org
	 * @throws UnauthorizedError if user lacks admin permission
	 * @throws InternalServerError for unexpected errors
	 */
	Rpc.make("channelSection.moveChannel", {
		payload: Schema.Struct({
			channelId: ChannelId,
			sectionId: Schema.NullOr(ChannelSectionId),
		}),
		success: Schema.Struct({ transactionId: TransactionId }),
		error: Schema.Union([
			ChannelNotFoundError,
			ChannelSectionNotFoundError,
			UnauthorizedError,
			InternalServerError,
		]),
	})
		.annotate(RequiredScopes, ["channel-sections:write"])
		.middleware(AuthMiddleware),
) {}
