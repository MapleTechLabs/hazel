import { OAuth, Schema as AuthSchema, Sessions } from "@yielded/auth"
import { AuthPersistence, PersistenceMappingError } from "@yielded/auth-persistence"
import type { SubjectIdCodec } from "@yielded/auth-persistence/Adapter"
import * as Mapping from "@yielded/auth-persistence/OAuthPersistence"
import { Context, Crypto, Effect, Layer, Schema } from "effect"
import { SqlClient } from "effect/sql"

import { HazelAuth, requirement } from "./auth.ts"
import { findUserByEmail, isProvider, linkIdentity, providerIssuers } from "./identities.ts"
import { Registration } from "./contract.ts"
import * as T from "./tables.ts"

const { sql, eq } = Mapping

/** Composed SQL storage for sessions, pending authentication and passkeys, on Hazel's
 * `users` table. OAuth registration has no composed storage, so it is mapped below. */
export const Persistence = AuthPersistence.make(HazelAuth)

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

const subjectId: SubjectIdCodec<string> = {
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
	nextSecurityRevision: (current) =>
		Sessions.SecurityRevision.make(current === "initial" ? "1" : String(BigInt(current) + 1n)),
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
 * one existing user is linked to that user (users who signed up through Clerk with
 * email). The registration intent is still issued; the callback then sees the link and
 * restarts sign-in, which resolves to the existing account. Matching failures only log:
 * the user falls back to registering.
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
		Effect.catchCause((cause) =>
			Effect.logWarning("[auth] verified-email linking failed; continuing to registration", cause),
		),
	)

export const OAuthStorageLive = Layer.effectContext(
	Effect.gen(function* () {
		const crypto = yield* Crypto.Crypto
		const sqlClient = yield* SqlClient.SqlClient

		const uuid = crypto.randomUUIDv4.pipe(
			Effect.mapError((cause) => PersistenceMappingError.make({ operation: "hazel.allocate", cause })),
		)

		const common = { subject, authority, subjectId, clock: Mapping.clock }

		const signIn = yield* Mapping.makeOAuthSignInServices({
			...common,
			ownership,
			credential,
			flow,
			constraints: Mapping.requiredOAuthSignInConstraints,
		})

		const intents = yield* Mapping.makeOAuthRegistrationIntentServices({
			ownership,
			intent,
			clock: Mapping.clock,
			constraints: {
				intentReference: Mapping.requiredOAuthRegistrationConstraints.intentReference,
				intentFlow: Mapping.requiredOAuthRegistrationConstraints.intentFlow,
				ownership: Mapping.requiredOAuthRegistrationConstraints.ownership,
			},
			eligible: () => sql`true`,
		})

		const registration = yield* Mapping.makeOAuthRegistrationServices({
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

		const accounts = yield* Mapping.makeOAuthAccountsServices({
			...common,
			ownership,
			credential,
			flow,
			constraints: Mapping.requiredOAuthSignInConstraints,
			metadataAccess: ({ invocation, subjectId }) =>
				invocation._tag === "Authenticated" && invocation.subjectId === subjectId
					? sql`true`
					: sql`false`,
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
									Effect.provideService(Crypto.Crypto, crypto),
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
	}),
)
