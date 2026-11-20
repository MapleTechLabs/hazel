import { SQLite, schema } from "@hazel/db"
import { UserId } from "@hazel/schema"
import * as Orm from "@maple-dev/effect-orm/database"
import { Effect } from "effect"
import * as Digest from "effect/crypto/Digest"
import * as SecureRandom from "effect/crypto/SecureRandom"
import { Base64Url } from "effect/encoding"
import { SqlClient } from "effect/sql"

import { oauthNamespace } from "./auth.ts"
import { isD1 } from "./batch.ts"

/** What a query over the auth store can fail with, by tag. */
export const QUERY_ERROR_TAGS = [
	"@maple-dev/effect-orm/DatabaseError",
	"@maple-dev/effect-orm/QueryBuilderError",
	"@maple-dev/effect-orm/CompiledQueryDecodeError",
] as const

/** What a batch over the auth store can fail with, by tag (outside D1 it runs in a transaction). */
export const STORE_ERROR_TAGS = [
	...QUERY_ERROR_TAGS,
	"@maple-dev/effect-orm/TransactionClosed",
	"@maple-dev/effect-orm/TransactionCommitFailed",
	"@maple-dev/effect-orm/TransactionOptionsRejected",
	"@maple-dev/effect-orm/TransactionRollbackFailed",
	"@maple-dev/effect-orm/TransactionUnsupported",
] as const

/** effect-orm over the auth store's client: D1 on the Worker, node SQLite in Bun and tests. */
export const ormOf = (sql: SqlClient.SqlClient) =>
	Orm.fromSqlClient(sql, { dialect: isD1(sql) ? SQLite.d1Dialect : SQLite.sqliteDialect })

/**
 * Links a GitHub or Google account to an existing Hazel user, so that signing in with it
 * resolves to that user instead of starting a registration. Used to carry users over
 * from Clerk (their linked accounts are imported ahead of time) and to match a
 * provider-verified email to an existing account at sign-in.
 *
 * Writes the same three rows as a registration through the library: the identity's
 * owner, its login credential and the matching authority row.
 */

/** The issuers the library records for each provider. */
export const providerIssuers = {
	github: "https://github.com/login/oauth",
	google: "https://accounts.google.com",
} as const

export type Provider = keyof typeof providerIssuers

export interface ExternalIdentity {
	readonly provider: Provider
	/** GitHub's numeric user id, or Google's `sub`. */
	readonly subject: string
}

const encoder = new TextEncoder()

/**
 * The library's identity key (`oauthIdentityKey` in @yielded/auth-persistence, not
 * exported): SHA-256 over length-prefixed UTF-8 fields. Tested against keys the library
 * writes itself; yielded-dev/auth#200 asks for an exported import path.
 */
export const identityKey = (identity: ExternalIdentity) =>
	Effect.gen(function* () {
		const fields = [
			"effect-auth/oauth-identity-key/v1",
			identity.provider,
			providerIssuers[identity.provider],
			identity.subject,
		].map((field) => encoder.encode(field))

		const packed = new Uint8Array(fields.reduce((size, value) => size + 4 + value.length, 0))
		const view = new DataView(packed.buffer)
		let offset = 0
		for (const value of fields) {
			view.setUint32(offset, value.length, false)
			packed.set(value, offset + 4)
			offset += 4 + value.length
		}

		const digest = yield* Digest.Digest
		return "v1:" + Base64Url.encode(yield* digest.digest(Digest.sha256, packed))
	})

export type LinkResult =
	| { readonly _tag: "Linked" }
	| { readonly _tag: "AlreadyLinked" }
	/** The account already belongs to another Hazel user; nothing was written. */
	| { readonly _tag: "Conflict"; readonly ownerId: string }

/**
 * Idempotent: re-linking the same account to the same user is a no-op. One atomic batch (D1
 * has no transactions): the owner row is inserted unless the identity has one, the login
 * credential and its authority row only when this user owns the identity and it has no login
 * yet, and the last statement reads back who owns it and which credential its login holds.
 */
export const linkIdentity = Effect.fn("HazelAuth.linkIdentity")(function* (
	input: ExternalIdentity & { readonly userId: string },
) {
	const sql = yield* SqlClient.SqlClient
	const random = yield* SecureRandom.SecureRandom
	const key = yield* identityKey(input)
	const credentialId = yield* random.uuidV4()
	const userId = UserId.make(input.userId)

	const identityOwned = SQLite.exists(
		SQLite.from(schema.authOAuthIdentitiesTable)
			.select("identityKey")
			.where(($) => [$.identityKey.eq(key), $.subjectId.eq(userId)]),
	)
	const hasLogin = SQLite.exists(
		SQLite.from(schema.authOAuthLoginsTable)
			.select("credentialId")
			.where(($) => [$.identityKey.eq(key)]),
	)
	const subject = SQLite.param.of(schema.typed<UserId>()(SQLite.text), "userId")

	const [, , , owners] = yield* ormOf(sql).batch(
		[
			SQLite.insertInto(schema.authOAuthIdentitiesTable)
				.values({
					identityKey: key,
					provider: input.provider,
					issuer: providerIssuers[input.provider],
					externalSubject: input.subject,
					subjectId: userId,
				})
				.onConflictDoNothing({ target: ["identityKey"] }),
			SQLite.insertInto(schema.authCredentialsTable).select(
				SQLite.selectNoFrom(() => ({
					credentialId: SQLite.lit(credentialId),
					subjectId: subject,
					revision: SQLite.lit("initial"),
					active: SQLite.param.of(SQLite.boolean, "active"),
				})).where(() => [identityOwned, SQLite.not(hasLogin)]),
			),
			SQLite.insertInto(schema.authOAuthLoginsTable).select(
				SQLite.selectNoFrom(() => ({
					moduleId: SQLite.lit(oauthNamespace),
					credentialId: SQLite.lit(credentialId),
					subjectId: subject,
					identityKey: SQLite.lit(key),
					credentialRevision: SQLite.lit("initial"),
					status: SQLite.lit("active"),
				})).where(() => [
					SQLite.exists(
						SQLite.from(schema.authCredentialsTable)
							.select("credentialId")
							.where(($) => [$.credentialId.eq(credentialId)]),
					),
					SQLite.not(hasLogin),
				]),
			),
			SQLite.from(schema.authOAuthIdentitiesTable, "i")
				.leftJoin(schema.authOAuthLoginsTable, "l", (i, l) => l.identityKey.eq(i.identityKey))
				.select(($) => ({ ownerId: $.subjectId, loginId: $.l.credentialId }))
				.where(($) => [$.identityKey.eq(key)]),
		] as const,
		{ userId, active: true },
	)

	const [owner] = owners
	if (owner?.ownerId !== userId) return { _tag: "Conflict", ownerId: owner?.ownerId ?? "" } as LinkResult
	return (owner.loginId === credentialId ? { _tag: "Linked" } : { _tag: "AlreadyLinked" }) as LinkResult
})

/**
 * The one active person (not a bot) with this email, compared case-insensitively.
 * `undefined` when there is none or more than one: an ambiguous match never links.
 */
export const findUserByEmail = (email: string) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const rows = yield* ormOf(sql).run(
			SQLite.from(schema.usersTable)
				.select("id")
				.where(($) => [
					SQLite.lower($.email).eq(SQLite.lower(SQLite.lit(email))),
					$.deletedAt.isNull(),
					$.userType.eq("user"),
				])
				.limit(2),
		)
		return rows.length === 1 ? rows[0]!.id : undefined
	})

export const isProvider = (value: string): value is Provider => value === "github" || value === "google"
