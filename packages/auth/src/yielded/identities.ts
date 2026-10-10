import { Crypto, Effect } from "effect"
import { Base64Url } from "effect/encoding"
import { SqlClient } from "effect/sql"

import { oauthNamespace } from "./auth.ts"

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

		const crypto = yield* Crypto.Crypto
		return "v1:" + Base64Url.encode(yield* crypto.digest("SHA-256", packed))
	})

export type LinkResult =
	| { readonly _tag: "Linked" }
	| { readonly _tag: "AlreadyLinked" }
	/** The account already belongs to another Hazel user; nothing was written. */
	| { readonly _tag: "Conflict"; readonly ownerId: string }

/** Idempotent: re-linking the same account to the same user is a no-op. */
export const linkIdentity = (input: ExternalIdentity & { readonly userId: string }) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const crypto = yield* Crypto.Crypto
		const key = yield* identityKey(input)
		const credentialId = yield* crypto.randomUUIDv4

		return yield* sql.withTransaction(
			Effect.gen(function* () {
				const inserted = yield* sql<{ identityKey: string }>`
					insert into auth_oauth_identities ("identityKey", provider, issuer, "externalSubject", "subjectId")
					values (${key}, ${input.provider}, ${providerIssuers[input.provider]}, ${input.subject}, ${input.userId}::uuid)
					on conflict ("identityKey") do nothing
					returning "identityKey"`

				if (inserted.length === 0) {
					const [owner] = yield* sql<{ subjectId: string }>`
						select "subjectId"::text as "subjectId" from auth_oauth_identities where "identityKey" = ${key}`
					return owner?.subjectId === input.userId
						? ({ _tag: "AlreadyLinked" } as const)
						: ({ _tag: "Conflict", ownerId: owner?.subjectId ?? "" } as const)
				}

				yield* sql`
					insert into auth_credentials ("credentialId", "subjectId", revision, active)
					values (${credentialId}, ${input.userId}::uuid, 'initial', true)`
				yield* sql`
					insert into auth_oauth_logins ("moduleId", "credentialId", "subjectId", "identityKey", "credentialRevision", status)
					values (${oauthNamespace}, ${credentialId}, ${input.userId}::uuid, ${key}, 'initial', 'active')`
				return { _tag: "Linked" } as const
			}),
		)
	})

/**
 * The one active person (not a bot) with this email, compared case-insensitively.
 * `undefined` when there is none or more than one: an ambiguous match never links.
 */
export const findUserByEmail = (email: string) =>
	Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const rows = yield* sql<{ id: string }>`
			select id::text as id from users
			where lower(email) = lower(${email}) and "deletedAt" is null and "userType" = 'user'
			limit 2`
		return rows.length === 1 ? rows[0]!.id : undefined
	})

export const isProvider = (value: string): value is Provider => value === "github" || value === "google"
