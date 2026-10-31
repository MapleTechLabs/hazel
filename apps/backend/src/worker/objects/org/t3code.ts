/**
 * T3 Code links in the `OrgObject`: a member's link is their user-level `t3code` integration
 * connection. `metadata` is {@link T3CodeMetadata} (the environment and when T3's credential
 * lapses), `settings` is their {@link T3CodeSharing}; the credential is the connection's
 * encrypted token. The T3 Code bot reaches an owner's environment only through
 * {@link T3CodeAccessCall}, which applies the owner's sharing to the acting member.
 */
import { IntegrationConnectionRepo } from "@hazel/backend-core"
import { Database, SQLite, schema } from "@hazel/db"
import {
	canDriveT3Code,
	defaultT3CodeSharing,
	T3CodeAccessDeniedError,
	T3CodeExpiredError,
	T3CodeNotConnectedError,
	T3CodeSharing,
} from "@hazel/domain/http"
import { IntegrationConnection } from "@hazel/domain/models"
import { UserId } from "@hazel/schema"
import { Effect, Option, Schema } from "effect"
import { IntegrationTokenService } from "../../../services/integration-token-service"
import { defineCall } from "../calls"
import { requireOrganizationId } from "./integrations"

/** What a `t3code` connection's `metadata` holds. */
export const T3CodeMetadata = Schema.Struct({
	environmentUrl: Schema.String,
	mcpUrl: Schema.String,
	environmentId: Schema.String,
	environmentLabel: Schema.String,
	/** ISO time T3's credential lapses; null when T3 gave no lifetime. */
	expiresAt: Schema.NullOr(Schema.String),
})
export type T3CodeMetadata = typeof T3CodeMetadata.Type

const decodeMetadata = Schema.decodeUnknownOption(T3CodeMetadata)
const decodeSharing = Schema.decodeUnknownOption(T3CodeSharing)

/** The link's environment, sharing and status; `None` for a row that is not a well-formed link. */
export const t3CodeLinkOf = (connection: IntegrationConnection.Type) =>
	Option.map(decodeMetadata(connection.metadata), (metadata) => ({
		metadata,
		sharing: Option.getOrElse(decodeSharing(connection.settings), () => defaultT3CodeSharing),
		status:
			isLapsed(metadata) && connection.status === "active" ? ("expired" as const) : connection.status,
	}))

const isLapsed = (metadata: T3CodeMetadata) =>
	metadata.expiresAt !== null && Date.parse(metadata.expiresAt) <= Date.now()

const LinkView = Schema.Struct({
	connection: IntegrationConnection.Schema,
	metadata: T3CodeMetadata,
	sharing: T3CodeSharing,
	status: IntegrationConnection.ConnectionStatus,
})

export const T3CodeLinkCall = defineCall("org.t3codeLink", "org", {
	payload: Schema.Struct({ userId: UserId }),
	success: Schema.NullOr(LinkView),
	error: Schema.Never,
})

export const UpdateT3CodeSharingCall = defineCall("org.updateT3codeSharing", "org", {
	payload: Schema.Struct({ userId: UserId, sharing: T3CodeSharing }),
	success: LinkView,
	error: T3CodeNotConnectedError,
})

export const T3CodeAccessCall = defineCall("org.t3codeAccess", "org", {
	payload: Schema.Struct({ ownerId: UserId, actorId: UserId }),
	success: Schema.Struct({ metadata: T3CodeMetadata, accessToken: Schema.String }),
	error: Schema.Union([T3CodeNotConnectedError, T3CodeExpiredError, T3CodeAccessDeniedError]),
})

const findLink = Effect.fn("OrgObject.t3codeFindLink")(function* (userId: UserId) {
	const organizationId = yield* requireOrganizationId
	const repo = yield* IntegrationConnectionRepo
	const connection = yield* repo.findUserConnection(organizationId, userId, "t3code").pipe(Effect.orDie)
	return Option.flatMap(connection, (row) =>
		Option.map(t3CodeLinkOf(row), (link) => ({ connection: row, ...link })),
	)
})

export const t3CodeLink = Effect.fn("OrgObject.t3codeLink")(function* (payload: { readonly userId: UserId }) {
	return Option.getOrNull(yield* findLink(payload.userId))
})

export const updateT3CodeSharing = Effect.fn("OrgObject.updateT3codeSharing")(function* (payload: {
	readonly userId: UserId
	readonly sharing: T3CodeSharing
}) {
	const db = yield* Database.Database
	const found = yield* findLink(payload.userId)
	if (Option.isNone(found)) return yield* new T3CodeNotConnectedError({ ownerId: payload.userId })
	// The owner is always allowed; listing them, or listing nobody in `members` mode, means nothing.
	const userIds = [...new Set(payload.sharing.userIds)].filter((id) => id !== payload.userId)
	const sharing: T3CodeSharing = { mode: payload.sharing.mode, userIds }
	yield* db
		.run(
			SQLite.update(schema.integrationConnectionsTable)
				.set({ settings: { ...sharing }, updatedAt: new Date() })
				.where(($) => [$.id.eq(found.value.connection.id)]),
		)
		.pipe(Effect.orDie)
	yield* Effect.annotateCurrentSpan({ "t3code.sharing.mode": sharing.mode })
	return { ...found.value, sharing }
})

export const t3CodeAccess = Effect.fn("OrgObject.t3codeAccess")(function* (payload: {
	readonly ownerId: UserId
	readonly actorId: UserId
}) {
	const { ownerId, actorId } = payload
	yield* Effect.annotateCurrentSpan({ "t3code.owner_id": ownerId, "t3code.actor_id": actorId })
	const found = yield* findLink(ownerId)
	if (Option.isNone(found)) return yield* new T3CodeNotConnectedError({ ownerId })
	const link = found.value
	// Sharing first: a member the owner does not share with learns nothing about the link's state.
	if (!canDriveT3Code(link.sharing, ownerId, actorId)) {
		return yield* new T3CodeAccessDeniedError({ ownerId, actorId })
	}
	if (link.status !== "active") return yield* new T3CodeExpiredError({ ownerId })
	const tokens = yield* IntegrationTokenService
	const accessToken = yield* tokens.getValidAccessToken(link.connection.id).pipe(
		Effect.catchTags({
			TokenNotFoundError: () => Effect.fail(new T3CodeExpiredError({ ownerId })),
			ConnectionNotFoundError: () => Effect.fail(new T3CodeNotConnectedError({ ownerId })),
			TokenRefreshError: Effect.die,
			IntegrationEncryptionError: Effect.die,
			KeyVersionNotFoundError: Effect.die,
			DatabaseError: Effect.die,
		}),
	)
	return { metadata: link.metadata, accessToken }
})

/** Mark a link expired: T3 refused its credential (revoked in T3, or lapsed early). */
export const MarkT3CodeExpiredCall = defineCall("org.markT3codeExpired", "org", {
	payload: Schema.Struct({ ownerId: UserId }),
	success: Schema.Void,
	error: Schema.Never,
})

export const markT3CodeExpired = Effect.fn("OrgObject.markT3codeExpired")(function* (payload: {
	readonly ownerId: UserId
}) {
	const db = yield* Database.Database
	const found = yield* findLink(payload.ownerId)
	if (Option.isNone(found)) return
	yield* db
		.run(
			SQLite.update(schema.integrationConnectionsTable)
				.set({ status: "expired", updatedAt: new Date() })
				.where(($) => [$.id.eq(found.value.connection.id)]),
		)
		.pipe(Effect.orDie)
})
