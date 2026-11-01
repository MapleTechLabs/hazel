import { OAuth, Schema as AuthSchema, Sessions } from "@yielded/auth"
import {
	AuthPersistence,
	PersistenceConfigurationError,
	PersistenceMappingError,
} from "@yielded/auth-persistence"
import * as Adapter from "@yielded/auth-persistence/Adapter"
import * as Mapping from "@yielded/auth-persistence/OAuthPersistence"
import { Cause, Context, Effect, Layer, Result, Schema } from "effect"
import * as Digest from "effect/crypto/Digest"
import * as SecureRandom from "effect/crypto/SecureRandom"
import { SqlClient } from "effect/sql"

import { HazelAuth, requirement } from "./auth.ts"
import { batchCommit } from "./batch.ts"
import { findUserByEmail, isProvider, linkIdentity, providerIssuers } from "./identities.ts"
import { Registration } from "./contract.ts"
import * as T from "./tables.ts"

const { sql, eq } = Mapping

type Table = ReturnType<typeof AuthPersistence.table>

const describe = (table: Table): Adapter.StorageTable => ({
	name: table.name,
	...(table.schema === undefined ? {} : { schema: table.schema }),
	columns: Object.fromEntries(Object.entries(table.columns).map(([key, column]) => [key, column.options])),
	unique: table.unique,
	indexes: table.indexes,
})

/**
 * The library's SQL backend (`AuthPersistence`) plus a batch owner: auth tables live in the
 * directory D1 database, which has no interactive transactions, so every commit is one atomic
 * batch (`batch.ts`). The same path runs on node SQLite.
 */
const SqlitePersistence = Adapter.createPersistence<Table, never, SqlClient.SqlClient>({
	makeTable: AuthPersistence.table,
	describe,
	acquire: Effect.gen(function* () {
		const client = yield* SqlClient.SqlClient
		if (!client.onDialectOrElse({ sqlite: () => true, orElse: () => false }))
			return yield* PersistenceConfigurationError.make({ reason: "Hazel auth storage is SQLite (D1)" })
		return client
	}),
	nativeTables: (client) => Adapter.makeNativeSqlTables(client),
	batch: batchCommit,
})

/** Composed SQL storage for sessions, pending authentication and passkeys, on Hazel's
 * `users` table. OAuth registration has no composed storage, so it is mapped below. */
export const Persistence = SqlitePersistence.make(HazelAuth)

export const storage = Persistence.map({
	subjects: {
		table: T.users,
		id: "id",
		status: "active",
		activeValue: true,
		securityRevision: "securityRevision",
		idCodec: AuthSchema.SubjectId,
		requirements: () => Effect.succeed(requirement),
	},
	tables: {
		identifiers: T.identifiers,
		credentials: T.credentials,
		sessions: T.sessions,
		pending: T.pending,
		passkeyCredentials: T.passkeyCredentials,
		passkeyFlows: T.passkeyFlows,
	},
})

// ---- OAuth mappings ----

const subjectId: Adapter.SubjectIdCodec<string> = {
	toNative: (id) => Effect.succeed(id),
	toSubject: (id) =>
		Schema.decodeEffect(AuthSchema.SubjectId)(id).pipe(
			Effect.mapError((cause) => PersistenceMappingError.make({ operation: "hazel.subject", cause })),
		),
	equals: (left, right) => left === right,
}

const subject = {
	table: T.oauthUsers,
	id: "id",
	status: "status",
	securityRevision: "securityRevision",
	isActiveStatus: (value: unknown) => value === true,
	activeCondition: eq(T.oauthUsers.columns.status, true),
	decodeAuthenticationRequirement: () => requirement,
	nextSecurityRevision: (_current) => Sessions.SecurityRevision.make(globalThis.crypto.randomUUID()),
} satisfies Mapping.OAuthSubjectTable<typeof T.oauthUsers>

const authority = {
	table: T.oauthAuthority,
	subjectId: "subjectId",
	credentialId: "credentialId",
	revision: "revision",
	status: "status",
	isActiveStatus: (value: unknown) => value === true,
	activeCondition: eq(T.oauthAuthority.columns.status, true),
	encodeInsert: (value) => ({ ...value, status: true }),
} satisfies Mapping.OAuthAuthorityTable<typeof T.oauthAuthority, string>

const credential = {
	table: T.oauthLogins,
	moduleId: "moduleId",
	credentialId: "credentialId",
	subjectId: "subjectId",
	identityKey: "identityKey",
	credentialRevision: "credentialRevision",
	status: "status",
	isActiveStatus: (value: unknown) => value === "active",
	activeCondition: eq(T.oauthLogins.columns.status, "active"),
	removal: "delete",
	encodeInsert: (value) => ({ ...value, status: "active" }),
} satisfies Mapping.OAuthCredentialTable<typeof T.oauthLogins, string>

const ownership = {
	table: T.oauthIdentities,
	identityKey: "identityKey",
	provider: "provider",
	issuer: "issuer",
	externalSubject: "externalSubject",
	subjectId: "subjectId",
	decodeSubjectId: (row) => Schema.decodeUnknownSync(Schema.String)(row.subjectId),
	encodeInsert: ({ identityKey, identity, subjectId }) => ({
		identityKey,
		provider: identity.provider,
		issuer: identity.issuer,
		externalSubject: identity.subject,
		subjectId,
	}),
} satisfies Mapping.OAuthOwnershipTable<typeof T.oauthIdentities, string>

const flow = {
	table: T.oauthFlows,
	moduleId: "moduleId",
	flowId: "flowId",
	purpose: "purpose",
	generation: "generation",
	provider: "provider",
	callbackId: "callbackId",
	issuer: "issuer",
	responseIssuerMode: "responseIssuerMode",
	subjectId: "subjectId",
	stateDigest: "stateDigest",
	binderVerifier: "binderVerifier",
	binderExpiresAt: "binderExpiresAt",
	snapshot: "snapshot",
	issuedAt: "issuedAt",
	expiresAt: "expiresAt",
	encodeInsert: (input) => input,
} satisfies Mapping.OAuthFlowTable<typeof T.oauthFlows>

const intent = {
	table: T.oauthRegistrations,
	moduleId: "moduleId",
	reference: "reference",
	flowId: "flowId",
	identityKey: "identityKey",
	snapshot: "snapshot",
	expiresAt: "expiresAt",
	retentionUntil: "retentionUntil",
	encodeInsert: (value) => ({
		moduleId: value.context.moduleId,
		reference: value.reference,
		flowId: value.context.flowId,
	}),
} satisfies Mapping.OAuthRegistrationIntentTable<typeof T.oauthRegistrations>

const registrationJson = Schema.fromJsonString(Registration)

/** Provider-verified email; GitHub omits it when the user's email is private. */
const emailFromIntent = (intent: OAuth.OAuthRegistrationIntent) =>
	intent.profile?.email ?? `${intent.identity.subject}@${intent.identity.provider}.invalid`

/**
 * A first-time GitHub or Google sign-in whose provider-verified email belongs to exactly
 * one existing user is linked to that user (users who signed up before Hazel sign-in,
 * with email). The registration intent is still issued; the callback then sees the link and
 * restarts sign-in, which resolves to the existing account. If the lookup or the link
 * fails, sign-in fails with OAuthUnavailable rather than continuing to registration.
 */
const linkByVerifiedEmail = (intent: OAuth.OAuthRegistrationIntent) =>
	Effect.gen(function* () {
		const { issuer, subject } = intent.identity
		const provider: string = intent.identity.provider
		const email = intent.profile?.email
		if (!isProvider(provider) || issuer !== providerIssuers[provider]) return
		if (intent.profile?.emailVerified !== true || email === undefined) return

		const userId = yield* findUserByEmail(email)
		if (userId === undefined) return
		const linked = yield* linkIdentity({ provider, subject, userId })
		yield* Effect.logInfo("[auth] linked a provider account by verified email", {
			provider,
			userId,
			result: linked._tag,
		})
	}).pipe(
		// Linking must not quietly fall through: registering instead would create a second
		// account for the same email (`users.email` is not unique). An unavailable sign-in the
		// user can retry is the honest answer.
		Effect.catchTags({
			SqlError: (cause) =>
				Effect.logError("[auth] verified-email linking failed", Cause.fail(cause)).pipe(
					Effect.andThen(Effect.fail(OAuth.OAuthUnavailable.make({}))),
				),
		}),
	)

/**
 * The OAuth mappings above over the library's native factories in batch mode. The
 * `OAuthPersistence` facade needs interactive transactions and refuses D1; these are the
 * factories its D1 adapter binds, without Drizzle.
 */
const signInMapping: Mapping.OAuthSignInMapping<Table, Table, Table, Table, Table, string> = {
	subject,
	authority,
	subjectId,
	clock: Mapping.clock,
	ownership,
	credential,
	flow,
	constraints: Mapping.requiredOAuthSignInConstraints,
}

const intentMapping: Mapping.OAuthRegistrationIntentMapping<Table, Table, string> = {
	ownership,
	intent,
	clock: Mapping.clock,
	constraints: {
		intentReference: Mapping.requiredOAuthRegistrationConstraints.intentReference,
		intentFlow: Mapping.requiredOAuthRegistrationConstraints.intentFlow,
		ownership: Mapping.requiredOAuthRegistrationConstraints.ownership,
	},
	eligible: () => sql`true`,
}

const makeRegistrationMapping = (
	uuid: Effect.Effect<string, PersistenceMappingError>,
): Mapping.OAuthRegistrationMapping<typeof Registration.Type, Table, Table, Table, Table, Table, string> => ({
	registration: Registration,
	ownership,
	intent,
	subject,
	credential,
	authority,
	subjectId,
	clock: Mapping.clock,
	constraints: Mapping.requiredOAuthRegistrationConstraints,
	inspect: ({ registration }) =>
		Effect.succeed({
			fingerprint: `hazel-v1:${Schema.encodeSync(registrationJson)(registration)}`,
			eligible: true,
		}),
	eligibility: { admission: () => sql`true`, postcondition: () => sql`true` },
	allocateSubjectId: uuid,
	allocateCredentialId: uuid,
	allocateRevision: Effect.succeed(Sessions.SecurityRevision.make("initial")),
	encodeSubjectInsert: ({ intent, registration }, ids) => ({
		id: ids.subjectId,
		// externalId is the Clerk user id for users who signed up through Clerk; it stays
		// NOT NULL and unique, so users created here get a value in their own namespace.
		externalId: `hazel:${ids.subjectId}`,
		status: true,
		securityRevision: ids.securityRevision,
		email: emailFromIntent(intent),
		firstName: registration.firstName,
		lastName: registration.lastName,
		avatarUrl: intent.profile?.avatarUrl ?? null,
	}),
})

const makeAccountsMapping = (
	uuid: Effect.Effect<string, PersistenceMappingError>,
): Mapping.OAuthAccountsMapping<Table, Table, Table, Table, Table, string> => ({
	subject,
	authority,
	subjectId,
	clock: Mapping.clock,
	ownership,
	credential,
	flow,
	constraints: Mapping.requiredOAuthSignInConstraints,
	metadataAccess: ({ invocation, subjectId }) =>
		invocation._tag === "Authenticated" && invocation.subjectId === subjectId ? sql`true` : sql`false`,
	eligibility: [
		Mapping.oauthEligibilityTable<typeof T.oauthLogins, string>({
			table: T.oauthLogins,
			subjectId: "subjectId",
			credentialId: "credentialId",
			revision: "credentialRevision",
			scope: "hazel-oauth-logins",
			condition: () => eq(T.oauthLogins.columns.status, "active"),
			decode: (row) => ({
				credentialId: Schema.decodeUnknownSync(Schema.String)(row.credentialId),
				revision: Schema.decodeUnknownSync(Sessions.SecurityRevision)(row.credentialRevision),
				usablePrimary: row.status === "active",
				factors: ["possession"],
				userVerified: false,
				phishingResistant: false,
			}),
		}),
	],
	cleanup: [],
	sessionInvalidation: "same-authority-immediate",
	otherReferences: () => sql`false`,
	allocateCredentialId: uuid,
	allocateRevision: uuid.pipe(Effect.map((value) => Sessions.SecurityRevision.make(value))),
})

/** The unique keys each mapping declares exist on the physical tables (what the facade checks). */
const validateMappings = (mappings: ReadonlyArray<unknown>) =>
	Effect.gen(function* () {
		const plans: Array<{ readonly table: object; readonly keys: ReadonlyArray<string> }> = []
		for (const mapping of mappings) {
			const planned = Adapter.storageKeyPlans(mapping, (table) => Result.succeed((table as Table).columns))
			if (Result.isFailure(planned)) {
				return yield* PersistenceConfigurationError.make({
					reason: `Invalid OAuth mapping: ${planned.failure}`,
				})
			}
			plans.push(...planned.success)
		}
		yield* Adapter.validateStorageBatch(
			"sqlite",
			plans.map(({ table, keys }) => ({ table: describe(table as Table), required: [keys] })),
		)
	}).pipe(Adapter.withStorageValidation, Effect.withSpan("HazelAuth.validateOAuthStorage"))

export const OAuthStorageLive = Layer.effectContext(
	Effect.gen(function* () {
		const digest = yield* Digest.Digest
		const random = yield* SecureRandom.SecureRandom
		const sqlClient = yield* SqlClient.SqlClient
		const tables = Adapter.makeNativeSqlTables(sqlClient)
		const batch = batchCommit(sqlClient)

		const uuid = random.uuidV4()
		const registrationMapping = makeRegistrationMapping(uuid)
		const accountsMapping = makeAccountsMapping(uuid)

		yield* validateMappings([signInMapping, intentMapping, registrationMapping, accountsMapping])

		const signIn = yield* Adapter.makeNativeOAuthSignInServices(
			tables,
			Adapter.captureOAuthMapping(signInMapping) as unknown as Adapter.OAuthNativeReadMapping,
			batch,
		)
		const intents = yield* Adapter.makeNativeOAuthRegistrationIntentServices(
			tables,
			Adapter.captureOAuthMapping(
				intentMapping,
			) as unknown as Adapter.OAuthNativeRegistrationIntentMapping,
			batch,
		)
		const registration = yield* Adapter.makeNativeOAuthRegistrationServices(
			tables,
			Adapter.captureOAuthMapping(
				registrationMapping,
			) as unknown as Adapter.OAuthNativeRegistrationMapping<typeof Registration.Type>,
			batch,
		)
		const accounts = yield* Adapter.makeNativeOAuthAccountsServices(
			tables,
			Adapter.captureOAuthMapping(accountsMapping) as unknown as Adapter.OAuthNativeAccountsMapping,
			batch,
		)

		return Context.make(OAuth.OAuthSignInPersistence, signIn.oauthSignInPersistence).pipe(
			Context.add(OAuth.OAuthRegistrationIntents, {
				...intents.oauthRegistrationIntents,
				issue: (input, prepare) =>
					intents.oauthRegistrationIntents
						.issue(input, prepare)
						.pipe(
							Effect.tap(() =>
								linkByVerifiedEmail(input.intent).pipe(
									Effect.provideService(SqlClient.SqlClient, sqlClient),
									Effect.provideService(Digest.Digest, digest),
									Effect.provideService(SecureRandom.SecureRandom, random),
								),
							),
						),
			}),
			Context.add(OAuth.OAuthAccountsPersistence, accounts.oauthAccountsPersistence),
			Context.add(
				HazelAuth.strategies.social.registration.RegistrationAuthority,
				registration.registrationAuthority,
			),
		)
	}).pipe(Effect.withSpan("HazelAuth.oauthStorage")),
)
