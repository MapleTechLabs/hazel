import { UserId } from "@hazel/schema"
import * as SQLite from "@maple-dev/effect-orm/sqlite"
import { uuid } from "./columns"

/** Auth storage metadata. The additive SQL migrations create these tables. */
export const authCredentialsTable = SQLite.table("auth_credentials", {
	columns: {
		credentialId: SQLite.text,
		subjectId: uuid(UserId),
		revision: SQLite.text,
		active: SQLite.boolean,
	},
	indexes: [
		SQLite.uniqueIndex("auth_credentials_credentialId_unique", ["credentialId"]),
		SQLite.uniqueIndex("auth_credentials_subject_credential", ["subjectId", "credentialId"]),
	],
})

export const authIdentifiersTable = SQLite.table("auth_identifiers", {
	columns: {
		moduleId: SQLite.nullable(SQLite.text),
		credentialId: SQLite.nullable(SQLite.text),
		namespace: SQLite.text,
		value: SQLite.text,
		subjectId: uuid(UserId),
		revision: SQLite.text,
		verifiedAt: SQLite.nullable(SQLite.integer),
		active: SQLite.boolean,
	},
	indexes: [SQLite.uniqueIndex("auth_identifiers_namespace_value", ["namespace", "value"])],
})

export const authSessionsTable = SQLite.table("auth_sessions", {
	columns: {
		sessionId: SQLite.text,
		subjectId: uuid(UserId),
		digest: SQLite.text,
		securityRevision: SQLite.text,
		issuedAt: SQLite.integer,
		expiresAt: SQLite.integer,
		absoluteExpiresAt: SQLite.integer,
		record: SQLite.text,
	},
	indexes: [
		SQLite.uniqueIndex("auth_sessions_sessionId_unique", ["sessionId"]),
		SQLite.uniqueIndex("auth_sessions_digest_unique", ["digest"]),
		SQLite.index("auth_sessions_subject_idx", ["subjectId"]),
	],
})

export const authPendingTable = SQLite.table("auth_pending", {
	columns: {
		moduleId: SQLite.text,
		kind: SQLite.text,
		digest: SQLite.text,
		version: SQLite.text,
		flowId: SQLite.text,
		subjectId: uuid(UserId),
		bindingDigest: SQLite.text,
		snapshot: SQLite.text,
		expiresAt: SQLite.integer,
		attemptLimit: SQLite.integer,
		failedAttempts: SQLite.integer,
		consumed: SQLite.boolean,
	},
	indexes: [SQLite.uniqueIndex("auth_pending_digest_unique", ["digest"])],
})

export const authPasskeyCredentialsTable = SQLite.table("auth_passkey_credentials", {
	columns: {
		credentialId: SQLite.text,
		subjectId: uuid(UserId),
		rpId: SQLite.text,
		protocolCredentialId: SQLite.text,
		credentialKey: SQLite.text,
		userHandle: SQLite.text,
		publicKey: SQLite.text,
		algorithm: SQLite.integer,
		profile: SQLite.text,
		credentialRevision: SQLite.text,
		active: SQLite.boolean,
		primarySignIn: SQLite.boolean,
		enrollmentUserVerified: SQLite.boolean,
		backupEligible: SQLite.boolean,
		backupState: SQLite.boolean,
		counter: SQLite.integer,
		name: SQLite.text,
		createdAt: SQLite.integer,
		lastUsedAt: SQLite.nullable(SQLite.integer),
	},
	indexes: [
		SQLite.uniqueIndex("auth_passkey_credentials_credentialId_unique", ["credentialId"]),
		SQLite.uniqueIndex("auth_passkey_credentials_credentialKey_unique", ["credentialKey"]),
		SQLite.index("auth_passkey_credentials_subject_idx", ["subjectId"]),
	],
})

export const authPasskeyFlowsTable = SQLite.table("auth_passkey_flows", {
	columns: {
		moduleId: SQLite.text,
		flowId: SQLite.text,
		purpose: SQLite.text,
		snapshot: SQLite.text,
		requestBindingVerifier: SQLite.text,
		requestBindingExpiresAt: SQLite.integer,
		issuedAt: SQLite.integer,
		expiresAt: SQLite.integer,
	},
	indexes: [SQLite.uniqueIndex("auth_passkey_flows_module_flow", ["moduleId", "flowId"])],
})

export const authOAuthIdentitiesTable = SQLite.table("auth_oauth_identities", {
	columns: {
		identityKey: SQLite.text,
		provider: SQLite.text,
		issuer: SQLite.text,
		externalSubject: SQLite.text,
		subjectId: uuid(UserId),
	},
	primaryKey: ["identityKey"],
	indexes: [SQLite.index("auth_oauth_identities_subject_idx", ["subjectId"])],
})

export const authOAuthLoginsTable = SQLite.table("auth_oauth_logins", {
	columns: {
		moduleId: SQLite.text,
		credentialId: SQLite.text,
		subjectId: uuid(UserId),
		identityKey: SQLite.text,
		credentialRevision: SQLite.text,
		status: SQLite.text,
	},
	primaryKey: ["credentialId"],
	indexes: [
		SQLite.uniqueIndex("auth_oauth_logins_identityKey_unique", ["identityKey"]),
		SQLite.index("auth_oauth_logins_owner_idx", ["identityKey", "subjectId"]),
	],
})

export const authOAuthFlowsTable = SQLite.table("auth_oauth_flows", {
	columns: {
		moduleId: SQLite.text,
		flowId: SQLite.text,
		purpose: SQLite.text,
		generation: SQLite.nullable(SQLite.integer),
		provider: SQLite.nullable(SQLite.text),
		callbackId: SQLite.nullable(SQLite.text),
		issuer: SQLite.nullable(SQLite.text),
		responseIssuerMode: SQLite.nullable(SQLite.text),
		subjectId: SQLite.nullable(uuid(UserId)),
		stateDigest: SQLite.nullable(SQLite.text),
		binderVerifier: SQLite.nullable(SQLite.text),
		binderExpiresAt: SQLite.nullable(SQLite.integer),
		snapshot: SQLite.nullable(SQLite.text),
		issuedAt: SQLite.nullable(SQLite.integer),
		expiresAt: SQLite.nullable(SQLite.integer),
	},
	indexes: [
		SQLite.uniqueIndex("auth_oauth_flows_stateDigest_unique", ["stateDigest"]),
		SQLite.uniqueIndex("auth_oauth_flows_module_flow", ["moduleId", "flowId"]),
	],
})

export const authOAuthRegistrationsTable = SQLite.table("auth_oauth_registrations", {
	columns: {
		moduleId: SQLite.text,
		reference: SQLite.text,
		flowId: SQLite.text,
		identityKey: SQLite.nullable(SQLite.text),
		snapshot: SQLite.nullable(SQLite.text),
		expiresAt: SQLite.nullable(SQLite.integer),
		retentionUntil: SQLite.nullable(SQLite.integer),
	},
	indexes: [
		SQLite.uniqueIndex("auth_oauth_registrations_module_reference", ["moduleId", "reference"]),
		SQLite.uniqueIndex("auth_oauth_registrations_module_flow", ["moduleId", "flowId"]),
	],
})

export const yieldedBrowserLoginTable = SQLite.table("yielded_browser_login", {
	columns: {
		namespace: SQLite.text,
		attempt_id: SQLite.text,
		version: SQLite.text,
		expires_at_millis: SQLite.integer,
		payload: SQLite.text,
	},
	primaryKey: ["namespace", "attempt_id"],
})
