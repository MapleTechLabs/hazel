/**
 * T3 Code: a member links their T3 Code environment (its MCP server, reached over T3 Connect) and
 * drives its threads from Hazel through the T3 Code bot (`bots/t3code-bot`). The link is a
 * user-level `t3code` integration connection; its token is T3's MCP OAuth credential (30 days,
 * no refresh). Who else may drive the environment is the owner's {@link T3CodeSharing}.
 */
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/http-api"
import { Schema } from "effect"
import { OrganizationId, UserId } from "@hazel/schema"
import * as CurrentUser from "../current-user"
import { InternalServerError, UnauthorizedError } from "../errors"
import { IntegrationConnection } from "../models"
import { RequiredScopes } from "../scopes/required-scopes"
import { InvalidOAuthStateError, OAuthUrlResponse } from "./integrations"

/** Who besides the owner may drive the environment: nobody, every org member, or the listed members. */
export const T3CodeSharingMode = Schema.Literals(["private", "organization", "members"])
export type T3CodeSharingMode = typeof T3CodeSharingMode.Type

export const T3CodeSharing = Schema.Struct({
	mode: T3CodeSharingMode,
	/** The members allowed in `members` mode; ignored otherwise. */
	userIds: Schema.Array(UserId),
})
export type T3CodeSharing = typeof T3CodeSharing.Type

export const defaultT3CodeSharing: T3CodeSharing = { mode: "private", userIds: [] }

/** Whether `actorId` may drive `ownerId`'s environment under `sharing`. */
export const canDriveT3Code = (sharing: T3CodeSharing, ownerId: UserId, actorId: UserId) =>
	actorId === ownerId ||
	sharing.mode === "organization" ||
	(sharing.mode === "members" && sharing.userIds.includes(actorId))

export class T3CodeConnection extends Schema.Class<T3CodeConnection>("T3CodeConnection")({
	/** The environment's label (its machine name), from `/.well-known/t3/environment`. */
	environmentLabel: Schema.String,
	/** The environment's origin, e.g. its T3 Connect address. */
	environmentUrl: Schema.String,
	status: IntegrationConnection.ConnectionStatus,
	/** When T3's credential lapses; after it the member signs in again. */
	expiresAt: Schema.NullOr(Schema.DateTimeUtcFromString),
	connectedAt: Schema.DateTimeUtcFromString,
	sharing: T3CodeSharing,
}) {}

export class T3CodeConnectionResponse extends Schema.Class<T3CodeConnectionResponse>(
	"T3CodeConnectionResponse",
)({
	connection: Schema.NullOr(T3CodeConnection),
}) {}

export class T3CodeConnectRequest extends Schema.Class<T3CodeConnectRequest>("T3CodeConnectRequest")({
	/** The environment address or its MCP URL (`https://<environment-address>/mcp`). */
	environmentUrl: Schema.String,
}) {}

/** The address is not a reachable T3 Code environment (bad URL, not https, no MCP OAuth). */
export class T3CodeEnvironmentError extends Schema.TaggedError<T3CodeEnvironmentError>()(
	"T3CodeEnvironmentError",
	{ message: Schema.String },
	{ httpApiStatus: 400 },
) {}

export class T3CodeNotConnectedError extends Schema.TaggedError<T3CodeNotConnectedError>()(
	"T3CodeNotConnectedError",
	{ ownerId: UserId },
	{ httpApiStatus: 404 },
) {}

/** The owner's credential lapsed or was revoked; they reconnect in settings. */
export class T3CodeExpiredError extends Schema.TaggedError<T3CodeExpiredError>()(
	"T3CodeExpiredError",
	{ ownerId: UserId },
	{ httpApiStatus: 409 },
) {}

/** The owner does not share their environment with the actor. */
export class T3CodeAccessDeniedError extends Schema.TaggedError<T3CodeAccessDeniedError>()(
	"T3CodeAccessDeniedError",
	{ ownerId: UserId, actorId: UserId },
	{ httpApiStatus: 403 },
) {}

export class T3CodeAccessRequest extends Schema.Class<T3CodeAccessRequest>("T3CodeAccessRequest")({
	organizationId: OrganizationId,
	/** Whose environment. */
	ownerId: UserId,
	/** Who acts: the member who ran the command or replied in the thread. */
	actorId: UserId,
}) {}

/** What the T3 Code bot needs to call an owner's environment for an allowed actor. */
export class T3CodeAccessResponse extends Schema.Class<T3CodeAccessResponse>("T3CodeAccessResponse")({
	mcpUrl: Schema.String,
	environmentUrl: Schema.String,
	environmentLabel: Schema.String,
	accessToken: Schema.String,
	expiresAt: Schema.NullOr(Schema.DateTimeUtcFromString),
}) {}

export class T3CodeGroup extends HttpApiGroup.make("t3code")
	.add(
		HttpApiEndpoint.get("getT3CodeConnection", `/:orgId`, {
			params: { orgId: OrganizationId },
			success: T3CodeConnectionResponse,
			error: [UnauthorizedError, InternalServerError],
		})
			.middleware(CurrentUser.Authorization)
			.annotateMerge(
				OpenApi.annotations({
					title: "Get T3 Code Connection",
					description:
						"The current member's T3 Code environment link in this organization, if any.",
					summary: "Get T3 Code connection",
				}),
			)
			.annotate(RequiredScopes, ["integration-connections:read"]),
	)
	.add(
		HttpApiEndpoint.post("startT3CodeConnect", `/:orgId/connect`, {
			params: { orgId: OrganizationId },
			payload: T3CodeConnectRequest,
			success: OAuthUrlResponse,
			error: [T3CodeEnvironmentError, UnauthorizedError, InternalServerError],
		})
			.middleware(CurrentUser.Authorization)
			.annotateMerge(
				OpenApi.annotations({
					title: "Start T3 Code Connect",
					description:
						"Registers Hazel with the environment's MCP OAuth server and returns its sign-in page. Sets a short-lived cookie carrying the PKCE verifier for the callback.",
					summary: "Start T3 Code sign-in",
				}),
			)
			.annotate(RequiredScopes, ["integration-connections:write"]),
	)
	.add(
		HttpApiEndpoint.get("t3CodeCallback", `/callback`, {
			query: {
				code: Schema.optional(Schema.String),
				state: Schema.optional(Schema.String),
				iss: Schema.optional(Schema.String),
				error: Schema.optional(Schema.String),
			},
			success: Schema.Void.pipe(HttpApiSchema.status(302)),
			error: [InvalidOAuthStateError, UnauthorizedError, InternalServerError],
		})
			// The member who started must finish, in their own session.
			.middleware(CurrentUser.Authorization)
			.annotateMerge(
				OpenApi.annotations({
					title: "T3 Code OAuth Callback",
					description: "Exchanges T3's authorization code and saves the link.",
					summary: "T3 Code OAuth callback",
				}),
			)
			.annotate(RequiredScopes, []),
	)
	.add(
		HttpApiEndpoint.put("updateT3CodeSharing", `/:orgId/sharing`, {
			params: { orgId: OrganizationId },
			payload: T3CodeSharing,
			success: T3CodeConnectionResponse,
			error: [T3CodeNotConnectedError, UnauthorizedError, InternalServerError],
		})
			.middleware(CurrentUser.Authorization)
			.annotateMerge(
				OpenApi.annotations({
					title: "Update T3 Code Sharing",
					description: "Choose who else in the organization may drive your T3 Code environment.",
					summary: "Update T3 Code sharing",
				}),
			)
			.annotate(RequiredScopes, ["integration-connections:write"]),
	)
	.add(
		HttpApiEndpoint.delete("disconnectT3Code", `/:orgId`, {
			params: { orgId: OrganizationId },
			success: Schema.Void,
			error: [T3CodeNotConnectedError, UnauthorizedError, InternalServerError],
		})
			.middleware(CurrentUser.Authorization)
			.annotateMerge(
				OpenApi.annotations({
					title: "Disconnect T3 Code",
					description:
						"Remove your T3 Code link. Revoke Hazel in T3's Settings → Sharing & access too.",
					summary: "Disconnect T3 Code",
				}),
			)
			.annotate(RequiredScopes, ["integration-connections:write"]),
	)
	// Bot token auth: only the T3 Code bot (`internal-bot-t3code`) may call it.
	.add(
		HttpApiEndpoint.post("getT3CodeAccess", `/bot/access`, {
			payload: T3CodeAccessRequest,
			success: T3CodeAccessResponse,
			error: [
				T3CodeNotConnectedError,
				T3CodeExpiredError,
				T3CodeAccessDeniedError,
				UnauthorizedError,
				InternalServerError,
			],
		})
			.annotateMerge(
				OpenApi.annotations({
					title: "Get T3 Code Access",
					description:
						"The owner's environment and credential, when the owner shares it with the actor. T3 Code bot only.",
					summary: "Get T3 Code access",
				}),
			)
			.annotate(RequiredScopes, []),
	)
	.prefix("/integrations/t3code") {}
