import { InvitationId, OrganizationId, UserId } from "@hazel/schema"
import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"
import { InternalServerError, UnauthorizedError } from "../errors"
import { RequiredScopes } from "../scopes/required-scopes"
import { AuthMiddleware } from "./middleware"
import { OrganizationNotFoundError } from "./organizations"

/** Roles an invitation can grant; ownership is never handed out by email. */
export const InvitationRole = Schema.Literals(["admin", "member"])
export type InvitationRole = typeof InvitationRole.Type

export const InvitationEmail = Schema.Trim.check(
	Schema.isMaxLength(320),
	Schema.isPattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/),
)

/** A pending invitation as admins see it. */
export class Invitation extends Schema.Class<Invitation>("Invitation")({
	id: InvitationId,
	organizationId: OrganizationId,
	email: Schema.String,
	role: InvitationRole,
	invitedBy: UserId,
	createdAt: Schema.DateTimeUtcFromString,
	expiresAt: Schema.DateTimeUtcFromString,
}) {}

/** One address `invitation.create` could not invite, and why. */
export const InvitationSkip = Schema.Struct({
	email: Schema.String,
	reason: Schema.Literals(["AlreadyMember", "EmailFailed"]),
})
export type InvitationSkip = typeof InvitationSkip.Type

export class InvitationCreateResult extends Schema.Class<InvitationCreateResult>("InvitationCreateResult")({
	invited: Schema.Array(Invitation),
	skipped: Schema.Array(InvitationSkip),
}) {}

/** What the invite link shows before it is accepted. Public: the token is the secret. */
export class InvitationPreview extends Schema.Class<InvitationPreview>("InvitationPreview")({
	organizationName: Schema.String,
	organizationLogoUrl: Schema.NullOr(Schema.String),
	email: Schema.String,
	status: Schema.Literals(["Pending", "Accepted", "Revoked", "Expired"]),
}) {}

export class InvitationAccepted extends Schema.Class<InvitationAccepted>("InvitationAccepted")({
	organizationId: OrganizationId,
	slug: Schema.NullOr(Schema.String),
}) {}

export class InvitationNotFoundError extends Schema.TaggedError<InvitationNotFoundError>()(
	"InvitationNotFoundError",
	{},
) {}

/** The invitation was revoked, has expired, or was already used. */
export class InvitationUnavailableError extends Schema.TaggedError<InvitationUnavailableError>()(
	"InvitationUnavailableError",
	{ status: Schema.Literals(["Accepted", "Revoked", "Expired"]) },
) {}

/** The signed-in account's email is not the invited one. */
export class InvitationEmailMismatchError extends Schema.TaggedError<InvitationEmailMismatchError>()(
	"InvitationEmailMismatchError",
	{ invitedEmail: Schema.String },
) {}

const Token = Schema.String.check(Schema.isMinLength(16), Schema.isMaxLength(128))

export class InvitationRpcs extends RpcGroup.make(
	/**
	 * Invites each address to the organization by email. Addresses that already belong to a
	 * member are skipped; an address with a pending invitation gets a fresh link instead.
	 * Admins and owners only.
	 */
	Rpc.make("invitation.create", {
		payload: Schema.Struct({
			organizationId: OrganizationId,
			emails: Schema.Array(InvitationEmail).check(Schema.isMinLength(1), Schema.isMaxLength(20)),
			role: InvitationRole,
		}),
		success: InvitationCreateResult,
		error: Schema.Union([OrganizationNotFoundError, UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["organization-members:write"])
		.middleware(AuthMiddleware),

	/** The organization's pending, unexpired invitations, newest first. Admins and owners only. */
	Rpc.make("invitation.list", {
		payload: Schema.Struct({ organizationId: OrganizationId }),
		success: Schema.Array(Invitation),
		error: Schema.Union([UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["organization-members:read"])
		.middleware(AuthMiddleware),

	/** Revokes a pending invitation; its link stops working. Admins and owners only. */
	Rpc.make("invitation.revoke", {
		payload: Schema.Struct({ id: InvitationId }),
		success: Schema.Void,
		error: Schema.Union([InvitationNotFoundError, UnauthorizedError, InternalServerError]),
	})
		.annotate(RequiredScopes, ["organization-members:write"])
		.middleware(AuthMiddleware),

	/** The invite link's organization and status. No authentication: the token is the secret. */
	Rpc.make("invitation.preview", {
		payload: Schema.Struct({ token: Token }),
		success: InvitationPreview,
		error: Schema.Union([InvitationNotFoundError, InternalServerError]),
	}).annotate(RequiredScopes, []),

	/**
	 * Joins the organization with the invited role. The signed-in user's email must be the
	 * invited address (case-insensitive). A user who is already a member just uses it up.
	 */
	Rpc.make("invitation.accept", {
		payload: Schema.Struct({ token: Token }),
		success: InvitationAccepted,
		error: Schema.Union([
			InvitationNotFoundError,
			InvitationUnavailableError,
			InvitationEmailMismatchError,
			OrganizationNotFoundError,
			UnauthorizedError,
			InternalServerError,
		]),
	})
		.annotate(RequiredScopes, ["organizations:write"])
		.middleware(AuthMiddleware),
) {}
