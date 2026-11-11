import { Auth, OAuth, Passkey, Sessions } from "@yielded/auth"
import { Effect, Layer, Option, Schema } from "effect"

import { HazelAuth, requirement, sessionConfiguration } from "./auth.ts"

/**
 * Sensitive account actions (linking a provider, adding/removing a passkey) must be
 * authorised by the application against the caller's current session. The library
 * supplies the challenge; Hazel decides whether this session's original evidence still
 * matches the account's current credentials and security revision.
 */

const SessionReader = HazelAuth.sessions.statefulLayer(
	sessionConfiguration.policy(HazelAuth.sessions.moduleId),
)

type Revision = {
	readonly subjectId: string
	readonly securityRevision: string
	readonly credentials: ReadonlyArray<{ readonly credentialId: string; readonly revision: string }>
}

const sameAuthority = (original: Revision, current: Revision) =>
	original.subjectId === current.subjectId &&
	original.securityRevision === current.securityRevision &&
	original.credentials.every((old) =>
		current.credentials.some(
			(now) => now.credentialId === old.credentialId && now.revision === old.revision,
		),
	)

const currentSessionToken = Effect.serviceOption(Auth.AuthRequest).pipe(
	Effect.map((request) => (Option.isSome(request) ? request.value.credentials.session : undefined)),
)

const PasskeyActionsLive = Layer.effect(
	Passkey.PasskeyActionEvidence,
	Effect.gen(function* () {
		const sessions = yield* HazelAuth.sessions.SessionStrategy

		return Passkey.PasskeyActionEvidence.of({
			verify: Effect.fn("HazelAuth.authorizePasskeyAction")(
				function* ({ invocation, challenge }) {
					const token = yield* currentSessionToken
					if (invocation._tag !== "Authenticated" || token === undefined)
						return yield* Passkey.PasskeyActionRequired.make({})

					const { inspection } = yield* HazelAuth.sessions
						.inspectInvocation(invocation, token)
						.pipe(Effect.provideService(HazelAuth.sessions.SessionStrategy, sessions))
					const original = inspection.provenance.evidence

					if (
						inspection.session.sessionId !== invocation.sessionId ||
						inspection.session.subjectId !== invocation.subjectId ||
						!sameAuthority(original.revision, challenge.revision)
					)
						return yield* Passkey.PasskeyActionRequired.make({})

					return {
						evidence: {
							...original,
							revision: challenge.revision,
							flowId: Sessions.AuthenticationFlowId.make(challenge.flowId),
							bindingDigest: challenge.bindingDigest,
						},
						requirement,
					}
				},
				Effect.mapError((error) =>
					Schema.is(Passkey.PasskeyActionRequired)(error)
						? error
						: Passkey.PasskeyUnavailable.make({}),
				),
			),
		})
	}),
)

const OAuthActionsLive = Layer.effect(
	OAuth.OAuthActionEvidence,
	Effect.gen(function* () {
		const sessions = yield* HazelAuth.sessions.SessionStrategy

		return OAuth.OAuthActionEvidence.of({
			verify: Effect.fn("HazelAuth.authorizeOAuthAction")(
				function* ({ invocation, challenge }) {
					const token = yield* currentSessionToken
					if (invocation._tag !== "Authenticated" || token === undefined)
						return yield* OAuth.OAuthActionRequired.make({})

					const { inspection } = yield* HazelAuth.sessions
						.inspectInvocation(invocation, token)
						.pipe(Effect.provideService(HazelAuth.sessions.SessionStrategy, sessions))
					const original = inspection.provenance.evidence

					if (!sameAuthority(original.revision, challenge.revision))
						return yield* OAuth.OAuthActionRequired.make({})

					return {
						source: {
							_tag: "Session" as const,
							sessionId: inspection.session.sessionId,
							authenticatedAt: inspection.session.assurance.authenticatedAt,
						},
						evidence: {
							...original,
							revision: challenge.revision,
							flowId: Sessions.AuthenticationFlowId.make(challenge.flowId),
							bindingDigest: challenge.bindingDigest,
						},
						requirement,
					}
				},
				Effect.mapError((error) =>
					Schema.is(OAuth.OAuthActionRequired)(error) || Schema.is(Sessions.SessionInvalid)(error)
						? OAuth.OAuthActionRequired.make({})
						: OAuth.OAuthUnavailable.make({}),
				),
			),
		})
	}),
)

export const ActionPoliciesLive = Layer.mergeAll(PasskeyActionsLive, OAuthActionsLive).pipe(
	Layer.provide(SessionReader),
)
