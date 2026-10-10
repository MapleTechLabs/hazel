import type { UserId } from "@hazel/schema"
import { bigint, boolean, index, pgTable, text, unique, uuid } from "drizzle-orm/pg-core"

/**
 * Storage for Hazel's own authentication (`@hazel/auth/server`, built on `@yielded/auth`).
 * `users` is the auth subject (its `authActive` and `securityRevision` columns live in
 * users.ts); these tables hold sessions, pending sign-ins, passkeys and OAuth identities.
 *
 * Column names, types and unique constraints are read by the library's SQL mappings in
 * `packages/auth/src/yielded/tables.ts`, so change both together. Times are epoch
 * milliseconds. `subjectId` columns are uuid so they join `users.id` directly.
 */

const millis = (name?: string) =>
	name === undefined ? bigint({ mode: "number" }) : bigint(name, { mode: "number" })
const subjectId = () => uuid().$type<UserId>()

/** Credentials that make up a user's current security revision (one row per login). */
export const authCredentialsTable = pgTable(
	"auth_credentials",
	{
		credentialId: text().notNull().unique(),
		subjectId: subjectId().notNull(),
		revision: text().notNull(),
		active: boolean().notNull(),
	},
	(table) => [unique("auth_credentials_subject_credential").on(table.subjectId, table.credentialId)],
)

/** Verified identifiers (unused while sign-in is OAuth and passkeys only). */
export const authIdentifiersTable = pgTable(
	"auth_identifiers",
	{
		moduleId: text(),
		credentialId: text(),
		namespace: text().notNull(),
		value: text().notNull(),
		subjectId: subjectId().notNull(),
		revision: text().notNull(),
		verifiedAt: millis(),
		active: boolean().notNull(),
	},
	(table) => [unique("auth_identifiers_namespace_value").on(table.namespace, table.value)],
)

export const authSessionsTable = pgTable(
	"auth_sessions",
	{
		sessionId: text().notNull().unique(),
		subjectId: subjectId().notNull(),
		digest: text().notNull().unique(),
		securityRevision: text().notNull(),
		issuedAt: millis().notNull(),
		expiresAt: millis().notNull(),
		absoluteExpiresAt: millis().notNull(),
		record: text().notNull(),
	},
	(table) => [index("auth_sessions_subject_idx").on(table.subjectId)],
)

/** Sign-ins waiting on a further step. */
export const authPendingTable = pgTable("auth_pending", {
	moduleId: text().notNull(),
	kind: text().notNull(),
	digest: text().notNull().unique(),
	version: text().notNull(),
	flowId: text().notNull(),
	subjectId: subjectId().notNull(),
	bindingDigest: text().notNull(),
	snapshot: text().notNull(),
	expiresAt: millis().notNull(),
	attemptLimit: millis().notNull(),
	failedAttempts: millis().notNull(),
	consumed: boolean().notNull(),
})

export const authPasskeyCredentialsTable = pgTable(
	"auth_passkey_credentials",
	{
		credentialId: text().notNull().unique(),
		subjectId: subjectId().notNull(),
		rpId: text().notNull(),
		protocolCredentialId: text().notNull(),
		credentialKey: text().notNull().unique(),
		userHandle: text().notNull(),
		publicKey: text().notNull(),
		algorithm: millis().notNull(),
		profile: text().notNull(),
		credentialRevision: text().notNull(),
		active: boolean().notNull(),
		primarySignIn: boolean().notNull(),
		enrollmentUserVerified: boolean().notNull(),
		backupEligible: boolean().notNull(),
		backupState: boolean().notNull(),
		counter: millis().notNull(),
		name: text().notNull(),
		createdAt: millis().notNull(),
		lastUsedAt: millis(),
	},
	(table) => [index("auth_passkey_credentials_subject_idx").on(table.subjectId)],
)

/** Passkey ceremonies in progress. */
export const authPasskeyFlowsTable = pgTable(
	"auth_passkey_flows",
	{
		moduleId: text().notNull(),
		flowId: text().notNull(),
		purpose: text().notNull(),
		snapshot: text().notNull(),
		requestBindingVerifier: text().notNull(),
		requestBindingExpiresAt: millis().notNull(),
		issuedAt: millis().notNull(),
		expiresAt: millis().notNull(),
	},
	(table) => [unique("auth_passkey_flows_module_flow").on(table.moduleId, table.flowId)],
)

/** Which Hazel user owns each provider account (GitHub user id, Google `sub`). */
export const authOAuthIdentitiesTable = pgTable(
	"auth_oauth_identities",
	{
		identityKey: text().primaryKey(),
		provider: text().notNull(),
		issuer: text().notNull(),
		externalSubject: text().notNull(),
		subjectId: subjectId().notNull(),
	},
	(table) => [index("auth_oauth_identities_subject_idx").on(table.subjectId)],
)

/** Provider accounts usable for sign-in. */
export const authOAuthLoginsTable = pgTable(
	"auth_oauth_logins",
	{
		moduleId: text().notNull(),
		credentialId: text().primaryKey(),
		subjectId: subjectId().notNull(),
		identityKey: text().notNull().unique(),
		credentialRevision: text().notNull(),
		status: text().notNull(),
	},
	(table) => [index("auth_oauth_logins_owner_idx").on(table.identityKey, table.subjectId)],
)

/** OAuth redirects in progress. */
export const authOAuthFlowsTable = pgTable(
	"auth_oauth_flows",
	{
		moduleId: text().notNull(),
		flowId: text().notNull(),
		purpose: text().notNull(),
		generation: millis(),
		provider: text(),
		callbackId: text(),
		issuer: text(),
		responseIssuerMode: text(),
		subjectId: subjectId(),
		stateDigest: text().unique(),
		binderVerifier: text(),
		binderExpiresAt: millis(),
		snapshot: text(),
		issuedAt: millis(),
		expiresAt: millis(),
	},
	(table) => [unique("auth_oauth_flows_module_flow").on(table.moduleId, table.flowId)],
)

/** First-time provider sign-ins waiting for the registration form. */
export const authOAuthRegistrationsTable = pgTable(
	"auth_oauth_registrations",
	{
		moduleId: text().notNull(),
		reference: text().notNull(),
		flowId: text().notNull(),
		identityKey: text(),
		snapshot: text(),
		expiresAt: millis(),
		retentionUntil: millis(),
	},
	(table) => [
		unique("auth_oauth_registrations_module_reference").on(table.moduleId, table.reference),
		unique("auth_oauth_registrations_module_flow").on(table.moduleId, table.flowId),
	],
)
