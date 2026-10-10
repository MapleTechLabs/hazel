import { AuthPersistence } from "@yielded/auth-persistence"
import * as Mapping from "@yielded/auth-persistence/OAuthPersistence"

/**
 * The library's view of Hazel's auth tables. The physical tables are the Drizzle schema in
 * `packages/db/src/schema/auth.ts` (plus `users`); keep names and unique keys in step.
 */

// ---- AuthPersistence (sessions, pending authentication, passkeys) ----

export const users = AuthPersistence.table({
	name: "users",
	columns: {
		id: { name: "id", type: "text" },
		active: { name: "authActive", type: "boolean" },
		securityRevision: { name: "securityRevision", type: "text" },
	},
	unique: [["id"]],
})

export const identifiers = AuthPersistence.table({
	name: "auth_identifiers",
	columns: {
		moduleId: { name: "moduleId", type: "text", nullable: true },
		credentialId: { name: "credentialId", type: "text", nullable: true },
		namespace: { name: "namespace", type: "text" },
		value: { name: "value", type: "text" },
		subjectId: { name: "subjectId", type: "text" },
		revision: { name: "revision", type: "text" },
		verifiedAt: { name: "verifiedAt", type: "integer", nullable: true },
		active: { name: "active", type: "boolean" },
	},
	unique: [["namespace", "value"]],
})

export const credentials = AuthPersistence.table({
	name: "auth_credentials",
	columns: {
		credentialId: { name: "credentialId", type: "text" },
		subjectId: { name: "subjectId", type: "text" },
		revision: { name: "revision", type: "text" },
		active: { name: "active", type: "boolean" },
	},
	unique: [["credentialId"]],
})

export const sessions = AuthPersistence.table({
	name: "auth_sessions",
	columns: {
		sessionId: { name: "sessionId", type: "text" },
		subjectId: { name: "subjectId", type: "text" },
		digest: { name: "digest", type: "text" },
		securityRevision: { name: "securityRevision", type: "text" },
		issuedAt: { name: "issuedAt", type: "integer" },
		expiresAt: { name: "expiresAt", type: "integer" },
		absoluteExpiresAt: { name: "absoluteExpiresAt", type: "integer" },
		record: { name: "record", type: "text" },
	},
	unique: [["sessionId"], ["digest"]],
})

export const pending = AuthPersistence.table({
	name: "auth_pending",
	columns: {
		moduleId: { name: "moduleId", type: "text" },
		kind: { name: "kind", type: "text" },
		digest: { name: "digest", type: "text" },
		version: { name: "version", type: "text" },
		flowId: { name: "flowId", type: "text" },
		subjectId: { name: "subjectId", type: "text" },
		bindingDigest: { name: "bindingDigest", type: "text" },
		snapshot: { name: "snapshot", type: "text" },
		expiresAt: { name: "expiresAt", type: "integer" },
		attemptLimit: { name: "attemptLimit", type: "integer" },
		failedAttempts: { name: "failedAttempts", type: "integer" },
		consumed: { name: "consumed", type: "boolean" },
	},
	unique: [["digest"]],
})

export const passkeyCredentials = AuthPersistence.table({
	name: "auth_passkey_credentials",
	columns: {
		credentialId: { name: "credentialId", type: "text" },
		subjectId: { name: "subjectId", type: "text" },
		rpId: { name: "rpId", type: "text" },
		protocolCredentialId: { name: "protocolCredentialId", type: "text" },
		credentialKey: { name: "credentialKey", type: "text" },
		userHandle: { name: "userHandle", type: "text" },
		publicKey: { name: "publicKey", type: "text" },
		algorithm: { name: "algorithm", type: "integer" },
		profile: { name: "profile", type: "text" },
		credentialRevision: { name: "credentialRevision", type: "text" },
		active: { name: "active", type: "boolean" },
		primarySignIn: { name: "primarySignIn", type: "boolean" },
		enrollmentUserVerified: { name: "enrollmentUserVerified", type: "boolean" },
		backupEligible: { name: "backupEligible", type: "boolean" },
		backupState: { name: "backupState", type: "boolean" },
		counter: { name: "counter", type: "integer" },
		name: { name: "name", type: "text" },
		createdAt: { name: "createdAt", type: "integer" },
		lastUsedAt: { name: "lastUsedAt", type: "integer", nullable: true },
	},
	unique: [["credentialId"], ["credentialKey"]],
})

export const passkeyFlows = AuthPersistence.table({
	name: "auth_passkey_flows",
	columns: {
		moduleId: { name: "moduleId", type: "text" },
		flowId: { name: "flowId", type: "text" },
		purpose: { name: "purpose", type: "text" },
		snapshot: { name: "snapshot", type: "text" },
		requestBindingVerifier: { name: "requestBindingVerifier", type: "text" },
		requestBindingExpiresAt: { name: "requestBindingExpiresAt", type: "integer" },
		issuedAt: { name: "issuedAt", type: "integer" },
		expiresAt: { name: "expiresAt", type: "integer" },
	},
	unique: [["moduleId", "flowId"]],
})

// ---- OAuthPersistence (provider identities, login credentials, flows) ----

export const oauthUsers = Mapping.table({
	name: "users",
	columns: {
		id: { name: "id", type: "text" },
		status: { name: "authActive", type: "boolean" },
		securityRevision: { name: "securityRevision", type: "text" },
		// Application columns written when OAuth registration provisions a user.
		externalId: { name: "externalId", type: "text" },
		email: { name: "email", type: "text" },
		firstName: { name: "firstName", type: "text" },
		lastName: { name: "lastName", type: "text" },
		avatarUrl: { name: "avatarUrl", type: "text", nullable: true },
	},
	unique: [["id"]],
})

export const oauthAuthority = Mapping.table({
	name: "auth_credentials",
	columns: {
		subjectId: { name: "subjectId", type: "text" },
		credentialId: { name: "credentialId", type: "text" },
		revision: { name: "revision", type: "text" },
		status: { name: "active", type: "boolean" },
	},
	unique: [["subjectId", "credentialId"]],
})

export const oauthIdentities = Mapping.table({
	name: "auth_oauth_identities",
	columns: {
		identityKey: { name: "identityKey", type: "text" },
		provider: { name: "provider", type: "text" },
		issuer: { name: "issuer", type: "text" },
		externalSubject: { name: "externalSubject", type: "text" },
		subjectId: { name: "subjectId", type: "text" },
	},
	unique: [["identityKey"]],
})

export const oauthLogins = Mapping.table({
	name: "auth_oauth_logins",
	columns: {
		moduleId: { name: "moduleId", type: "text" },
		credentialId: { name: "credentialId", type: "text" },
		subjectId: { name: "subjectId", type: "text" },
		identityKey: { name: "identityKey", type: "text" },
		credentialRevision: { name: "credentialRevision", type: "text" },
		status: { name: "status", type: "text" },
	},
	unique: [["credentialId"], ["identityKey"]],
})

export const oauthFlows = Mapping.table({
	name: "auth_oauth_flows",
	columns: {
		moduleId: { name: "moduleId", type: "text" },
		flowId: { name: "flowId", type: "text" },
		purpose: { name: "purpose", type: "text" },
		generation: { name: "generation", type: "integer", nullable: true },
		provider: { name: "provider", type: "text", nullable: true },
		callbackId: { name: "callbackId", type: "text", nullable: true },
		issuer: { name: "issuer", type: "text", nullable: true },
		responseIssuerMode: { name: "responseIssuerMode", type: "text", nullable: true },
		subjectId: { name: "subjectId", type: "text", nullable: true },
		stateDigest: { name: "stateDigest", type: "text", nullable: true },
		binderVerifier: { name: "binderVerifier", type: "text", nullable: true },
		binderExpiresAt: { name: "binderExpiresAt", type: "integer", nullable: true },
		snapshot: { name: "snapshot", type: "text", nullable: true },
		issuedAt: { name: "issuedAt", type: "integer", nullable: true },
		expiresAt: { name: "expiresAt", type: "integer", nullable: true },
	},
	unique: [["moduleId", "flowId"], ["stateDigest"]],
})

export const oauthRegistrations = Mapping.table({
	name: "auth_oauth_registrations",
	columns: {
		moduleId: { name: "moduleId", type: "text" },
		reference: { name: "reference", type: "text" },
		flowId: { name: "flowId", type: "text" },
		identityKey: { name: "identityKey", type: "text", nullable: true },
		snapshot: { name: "snapshot", type: "text", nullable: true },
		expiresAt: { name: "expiresAt", type: "integer", nullable: true },
		retentionUntil: { name: "retentionUntil", type: "integer", nullable: true },
	},
	unique: [
		["moduleId", "reference"],
		["moduleId", "flowId"],
	],
})
