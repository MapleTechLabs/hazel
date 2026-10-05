import { Rpc, RpcGroup } from "effect/rpc"
import { Schema } from "effect"
import { InternalServerError, UnauthorizedError } from "../errors"
import { OrganizationMemberId } from "@hazel/schema"
import { OrganizationMember } from "../models"
import { TransactionId } from "@hazel/schema"
import { AuthMiddleware } from "./middleware"
import { RequiredScopes } from "../scopes/required-scopes"
import { OrganizationNotFoundError } from "./organizations"

/**
 * Response schema for successful organization member operations.
 * Contains the organization member data and a transaction ID for optimistic updates.
 */
export class OrganizationMemberResponse extends Schema.Class<OrganizationMemberResponse>(
	"OrganizationMemberResponse",
)({
	data: OrganizationMember.Schema,
	transactionId: TransactionId,
}) {}

/**
 * Error thrown when an organization member is not found.
 * Used in update and delete operations.
 */
export class OrganizationMemberNotFoundError extends Schema.TaggedError<OrganizationMemberNotFoundError>()(
	"OrganizationMemberNotFoundError",
	{
		organizationMemberId: OrganizationMemberId,
	},
) {}

/**
 * Organization Member RPC Group
 *
 * Defines all RPC methods for organization member operations:
 * - OrganizationMemberCreate: Add a user to an organization
 * - OrganizationMemberUpdate: Update an organization member's role and settings
 * - OrganizationMemberDelete: Remove a user from an organization
 *
 * All methods require authentication via AuthMiddleware.
 *
 * Example usage from frontend:
 * ```typescript
 * const client = yield* RpcClient
 *
 * // Create organization member
 * const result = yield* client.OrganizationMemberCreate({
 *   organizationId: "...",
 *   role: "member"
 * })
 *
 * // Update organization member
 * yield* client.OrganizationMemberUpdate({
 *   id: "...",
 *   role: "admin"
 * })
 *
 * // Delete organization member
 * yield* client.OrganizationMemberDelete({ id: "..." })
 * ```
 */
export class OrganizationMemberRpcs extends RpcGroup.make(
	/**
	 * OrganizationMemberCreate
	 *
	 * Adds a user to an organization.
	 * The userId is automatically set from the authenticated user (CurrentUser).
	 * Requires appropriate permissions to add members to the organization.
	 *
	 * @param payload - Organization member data (organizationId, role, etc.)
	 * @returns Organization member data and transaction ID
	 * @throws OrganizationNotFoundError if organization doesn't exist
	 * @throws UnauthorizedError if user lacks permission
	 * @throws InternalServerError for unexpected errors
	 */
	Rpc.make("organizationMember.create", {
		payload: OrganizationMember.Create,
		success: OrganizationMemberResponse,
		error: Schema.Union([OrganizationNotFoundError, UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["organization-members:write"])
		.middleware(AuthMiddleware),

	/**
	 * OrganizationMemberUpdate
	 *
	 * Updates an existing organization member's role and settings.
	 * Only users with appropriate permissions can update organization members.
	 *
	 * @param payload - Organization member ID and fields to update
	 * @returns Updated organization member data and transaction ID
	 * @throws OrganizationMemberNotFoundError if organization member doesn't exist
	 * @throws UnauthorizedError if user lacks permission
	 * @throws InternalServerError for unexpected errors
	 */
	Rpc.make("organizationMember.update", {
		payload: Schema.Struct({
			id: OrganizationMemberId,
		}).pipe(Schema.fieldsAssign(OrganizationMember.PatchPartial.fields)),
		success: OrganizationMemberResponse,
		error: Schema.Union([OrganizationMemberNotFoundError, UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["organization-members:write"])
		.middleware(AuthMiddleware),

	/**
	 * OrganizationMemberUpdateMetadata
	 *
	 * Updates an organization member's metadata (e.g., onboarding data).
	 * Used to store additional information like role preferences and use cases from onboarding.
	 *
	 * @param payload - Organization member ID and metadata to update
	 * @returns Updated organization member data and transaction ID
	 * @throws OrganizationMemberNotFoundError if organization member doesn't exist
	 * @throws UnauthorizedError if user lacks permission
	 * @throws InternalServerError for unexpected errors
	 */
	Rpc.make("organizationMember.updateMetadata", {
		payload: Schema.Struct({
			id: OrganizationMemberId,
			metadata: Schema.Struct({
				role: Schema.optional(Schema.String),
				useCases: Schema.optional(Schema.Array(Schema.String)),
			}),
		}),
		success: OrganizationMemberResponse,
		error: Schema.Union([OrganizationMemberNotFoundError, UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["organization-members:write"])
		.middleware(AuthMiddleware),

	/**
	 * OrganizationMemberDelete
	 *
	 * Removes a user from an organization (soft delete).
	 * Only users with appropriate permissions can remove organization members.
	 *
	 * @param payload - Organization member ID to delete
	 * @returns Transaction ID
	 * @throws OrganizationMemberNotFoundError if organization member doesn't exist
	 * @throws UnauthorizedError if user lacks permission
	 * @throws InternalServerError for unexpected errors
	 */
	Rpc.make("organizationMember.delete", {
		payload: Schema.Struct({ id: OrganizationMemberId }),
		success: Schema.Struct({ transactionId: TransactionId }),
		error: Schema.Union([OrganizationMemberNotFoundError, UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["organization-members:write"])
		.middleware(AuthMiddleware),
) {}
