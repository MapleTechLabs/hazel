import { Rpc, RpcGroup } from "effect/rpc"
import { Schema } from "effect"
import { InternalServerError, UnauthorizedError } from "../errors"
import { OrganizationId } from "@hazel/schema"
import { Organization } from "../models"
import { TransactionId } from "@hazel/schema"
import { AuthMiddleware } from "./middleware"
import { RequiredScopes } from "../scopes/required-scopes"

/**
 * Response schema for successful organization operations.
 * Contains the organization data and a transaction ID for optimistic updates.
 */
export class OrganizationResponse extends Schema.Class<OrganizationResponse>("OrganizationResponse")({
	data: Organization.Schema,
	transactionId: TransactionId,
}) {}

/**
 * Error thrown when an organization is not found.
 * Used in update and delete operations.
 */
export class OrganizationNotFoundError extends Schema.TaggedError<OrganizationNotFoundError>()(
	"OrganizationNotFoundError",
	{
		organizationId: OrganizationId,
	},
) {}

/**
 * Error thrown when trying to create or update an organization with a slug that already exists.
 */
export class OrganizationSlugAlreadyExistsError extends Schema.TaggedError<OrganizationSlugAlreadyExistsError>()(
	"OrganizationSlugAlreadyExistsError",
	{
		message: Schema.String,
		slug: Schema.String,
	},
) {}

/**
 * Error thrown when trying to join an organization via public invite but the org has public invites disabled.
 */
export class PublicInviteDisabledError extends Schema.TaggedError<PublicInviteDisabledError>()(
	"PublicInviteDisabledError",
	{
		organizationId: OrganizationId,
	},
) {}

/**
 * Error thrown when a user is already a member of the organization they're trying to join.
 */
export class AlreadyMemberError extends Schema.TaggedError<AlreadyMemberError>()("AlreadyMemberError", {
	organizationId: OrganizationId,
	organizationSlug: Schema.NullOr(Schema.String),
}) {}

/**
 * Public organization info response for unauthenticated users.
 * Contains only public information that's safe to expose.
 */
export class PublicOrganizationInfo extends Schema.Class<PublicOrganizationInfo>("PublicOrganizationInfo")({
	id: OrganizationId,
	name: Schema.String,
	slug: Schema.NullOr(Schema.String),
	logoUrl: Schema.NullOr(Schema.String),
	memberCount: Schema.Number,
}) {}

export class OrganizationRpcs extends RpcGroup.make(
	Rpc.make("organization.create", {
		payload: Organization.Create,
		success: OrganizationResponse,
		error: Schema.Union([OrganizationSlugAlreadyExistsError, UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["organizations:write"])
		.middleware(AuthMiddleware),

	Rpc.make("organization.update", {
		payload: Schema.Struct({
			id: OrganizationId,
		}).pipe(Schema.fieldsAssign(Organization.PatchPartial.fields)),
		success: OrganizationResponse,
		error: Schema.Union([
			OrganizationNotFoundError,
			OrganizationSlugAlreadyExistsError,
			UnauthorizedError,
			InternalServerError,
		]),
	})
		.annotate(RequiredScopes, ["organizations:write"])
		.middleware(AuthMiddleware),

	Rpc.make("organization.delete", {
		payload: Schema.Struct({ id: OrganizationId }),
		success: Schema.Struct({ transactionId: TransactionId }),
		error: Schema.Union([OrganizationNotFoundError, UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["organizations:write"])
		.middleware(AuthMiddleware),

	Rpc.make("organization.setSlug", {
		payload: Schema.Struct({
			id: OrganizationId,
			slug: Schema.String,
		}),
		success: OrganizationResponse,
		error: Schema.Union([
			OrganizationNotFoundError,
			OrganizationSlugAlreadyExistsError,
			UnauthorizedError,
			InternalServerError,
		]),
	})
		.annotate(RequiredScopes, ["organizations:write"])
		.middleware(AuthMiddleware),

	/**
	 * Toggle public invite mode for an organization.
	 * When enabled, anyone with the invite URL can join the workspace.
	 * Only admins/owners can modify this setting.
	 */
	Rpc.make("organization.setPublicMode", {
		payload: Schema.Struct({
			id: OrganizationId,
			isPublic: Schema.Boolean,
		}),
		success: OrganizationResponse,
		error: Schema.Union([OrganizationNotFoundError, UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["organizations:write"])
		.middleware(AuthMiddleware),

	/**
	 * Get public organization info by slug.
	 * Returns limited organization info for the join page.
	 * No authentication required - only returns data if org has isPublic=true.
	 */
	Rpc.make("organization.getBySlugPublic", {
		payload: Schema.Struct({
			slug: Schema.String,
		}),
		success: Schema.NullOr(PublicOrganizationInfo),
		error: InternalServerError,
	}).annotate(RequiredScopes, []),

	/**
	 * Join an organization via public invite link.
	 * Requires authentication. Creates membership with "member" role.
	 */
	Rpc.make("organization.joinViaPublicInvite", {
		payload: Schema.Struct({
			slug: Schema.String,
		}),
		success: OrganizationResponse,
		error: Schema.Union([
			OrganizationNotFoundError,
			PublicInviteDisabledError,
			AlreadyMemberError,
			UnauthorizedError,
			InternalServerError,
		]),
	})
		.annotate(RequiredScopes, ["organizations:write"])
		.middleware(AuthMiddleware),
) {}
