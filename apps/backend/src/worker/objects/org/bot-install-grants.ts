/**
 * Bot-install grants in the `OrgObject` (`@hazel/domain/bot-install`): `bot.authorizeInstall`
 * mints one beside the installation, and the bot redeems it with its token through the api
 * Worker (`routes/api-v1/bots.http.ts`), which routes by the org id the code starts with. The
 * org's own store holds the grant, so a code works the moment the consent page hands it out.
 *
 * Also the public bot API's user lookup (`GET /api/v1/organizations/:id/users`), read from the
 * org's `users` projection.
 */
import { Database, SQLite, schema } from "@hazel/db"
import { BOT_INSTALL_GRANT_TTL_MS } from "@hazel/domain/bot-install"
import { ApiV1User, BotInstallGrantInvalidError, BotNotInstalledError } from "@hazel/domain/http"
import { BotId, OrganizationId, UserId } from "@hazel/schema"
import { Effect, Option, Schema } from "effect"
import { Hex } from "effect/encoding"
import { defineCall } from "../calls"
import { requireOrganizationId } from "./integrations"

const CODE_SEPARATOR = "."

const sha256 = (value: string) =>
	Effect.promise(async () => {
		const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
		return Hex.encode(new Uint8Array(digest))
	})

/** The grant's code is `<orgId>.<secret>`: the api Worker routes on the org id, the object checks the rest. */
export const organizationOfInstallCode = (code: string): Option.Option<OrganizationId> => {
	const index = code.indexOf(CODE_SEPARATOR)
	if (index <= 0) return Option.none()
	return Schema.decodeUnknownOption(OrganizationId)(code.slice(0, index))
}

export const hashInstallCode = sha256

/** Mint a grant for `botId`, redeemable once at `redirectUri` within the TTL. Answers the code. */
export const mintInstallGrant = Effect.fn("OrgObject.mintInstallGrant")(function* (input: {
	readonly organizationId: OrganizationId
	readonly botId: BotId
	readonly redirectUri: string
	readonly installedBy: UserId
}) {
	const db = yield* Database.Database
	const secret = Hex.encode(crypto.getRandomValues(new Uint8Array(32)))
	const code = `${input.organizationId}${CODE_SEPARATOR}${secret}`
	yield* db.run(
		SQLite.insertInto(schema.botInstallGrantsTable).values({
			codeHash: yield* sha256(code),
			botId: input.botId,
			redirectUri: input.redirectUri,
			installedBy: input.installedBy,
			expiresAt: new Date(Date.now() + BOT_INSTALL_GRANT_TTL_MS),
		}),
	)
	return code
})

export const RedeemBotInstallGrantCall = defineCall("org.redeemBotInstallGrant", "org", {
	payload: Schema.Struct({ botId: BotId, codeHash: Schema.String, redirectUri: Schema.String }),
	success: Schema.Struct({
		organizationId: OrganizationId,
		organizationName: Schema.String,
		installedBy: UserId,
	}),
	error: BotInstallGrantInvalidError,
})

/**
 * Redeem a grant: one conditional update, so a code is spent once however many requests race
 * for it, and only by the bot and redirect URI it was issued to while it is still fresh. One
 * failure for every reason, so the answer says nothing about which codes exist.
 */
export const redeemBotInstallGrant = Effect.fn("OrgObject.redeemBotInstallGrant")(
	function* (payload: typeof RedeemBotInstallGrantCall.payload.Type) {
		const organizationId = yield* requireOrganizationId
		const db = yield* Database.Database
		const now = new Date()
		const [grant] = yield* db.run(
			SQLite.update(schema.botInstallGrantsTable)
				.set({ redeemedAt: now })
				.where(($) => [
					$.codeHash.eq(payload.codeHash),
					$.botId.eq(payload.botId),
					$.redirectUri.eq(payload.redirectUri),
					$.redeemedAt.isNull(),
					$.expiresAt.gt(now),
				])
				.returning(),
		)
		const invalid = new BotInstallGrantInvalidError({
			message: "The install code is invalid, expired or already used",
		})
		if (grant === undefined) return yield* invalid
		// Uninstalled between approving and redeeming: there is nothing to link.
		const installation = yield* db.first(
			SQLite.from(schema.botInstallationsTable)
				.select("id")
				.where(($) => [$.botId.eq(payload.botId), $.organizationId.eq(organizationId)])
				.limit(1),
		)
		if (Option.isNone(installation)) return yield* invalid
		const organization = yield* db.first(
			SQLite.from(schema.organizationsTable)
				.select("name")
				.where(($) => [$.id.eq(organizationId), $.deletedAt.isNull()])
				.limit(1),
		)
		if (Option.isNone(organization)) return yield* invalid
		yield* Effect.annotateCurrentSpan({ "bot.id": payload.botId })
		return { organizationId, organizationName: organization.value.name, installedBy: grant.installedBy }
	},
	Effect.catchTag("DatabaseError", (error) => Effect.die(error)),
)

/** At most this many ids per lookup. */
export const ORGANIZATION_USERS_MAX_IDS = 100

export const OrganizationUsersCall = defineCall("org.botUsers", "org", {
	payload: Schema.Struct({ botId: BotId, botUserId: UserId, ids: Schema.Array(UserId) }),
	success: Schema.Array(ApiV1User),
	error: BotNotInstalledError,
})

/** The org's people (and bots) among `ids`, for a bot that is a member here. */
export const organizationUsers = Effect.fn("OrgObject.botUsers")(
	function* (payload: typeof OrganizationUsersCall.payload.Type) {
		const organizationId = yield* requireOrganizationId
		const db = yield* Database.Database
		const membership = yield* db.first(
			SQLite.from(schema.organizationMembersTable)
				.select("id")
				.where(($) => [
					$.organizationId.eq(organizationId),
					$.userId.eq(payload.botUserId),
					$.deletedAt.isNull(),
				])
				.limit(1),
		)
		if (Option.isNone(membership))
			return yield* new BotNotInstalledError({ botId: payload.botId, orgId: organizationId })
		if (payload.ids.length === 0) return []
		const users = yield* db.run(
			SQLite.from(schema.usersTable)
				.select("id", "firstName", "lastName", "email", "avatarUrl", "userType")
				.where(($) => [$.id.in_(...payload.ids), $.deletedAt.isNull()]),
		)
		return users.map((user) => ({
			id: user.id,
			displayName: [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email,
			avatarUrl: user.avatarUrl ?? null,
			isBot: user.userType === "machine",
		}))
	},
	Effect.catchTag("DatabaseError", (error) => Effect.die(error)),
)
