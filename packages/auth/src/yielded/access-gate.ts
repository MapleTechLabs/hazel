import { SQLite, schema } from "@hazel/db"
import { UserId } from "@hazel/schema"
import { Hooks, type OAuth } from "@yielded/auth"
import { Effect, Layer } from "effect"
import { SqlClient } from "effect/sql"

import { ormOf, QUERY_ERROR_TAGS } from "./identities.ts"
import { type InstanceAccess, isEmailDomainAllowed } from "./instance-access.ts"

/**
 * Enforces `ALLOWED_EMAIL_DOMAINS` (`instance-access.ts`) on every way into a Hazel account:
 *
 * - A first-time GitHub/Google sign-in is refused before its registration intent is issued
 *   (`admitRegistration`, in `storage.ts`), so no user row is ever created and no existing account
 *   is linked by email. Registration checks it again (`registrationEligible`) for an intent issued
 *   before the restriction.
 * - Every session issuance (OAuth sign-in of a known identity, passkey sign-in, registration's own
 *   session) and every credential change (adding a passkey, linking a provider) runs the lifecycle
 *   hook below, which refuses a user whose recorded email is outside the allowed domains.
 *
 * A refusal is the library's `HookDenied`, which the sign-in pages show as "Denied".
 */

const denied = Hooks.HookDenied.make({ reason: "policy" })

/** Whether a registration intent's provider-verified email may become (or link to) an account. */
export const registrationEmailAllowed = (access: InstanceAccess, intent: OAuth.OAuthRegistrationIntent) => {
	if (access.allowedEmailDomains.length === 0) return true
	const email = intent.profile?.email
	// Without a verified address there is no domain to trust.
	if (intent.profile?.emailVerified !== true || email === undefined) return false
	return isEmailDomainAllowed(access.allowedEmailDomains, email)
}

/**
 * Refuses a first-time sign-in outside the allowed domains, before the library issues its
 * registration intent. `OAuthRegistrationIntents.issue` declares only `OAuthUnavailable`, but its
 * caller (the OAuth callback) passes any failure through to the operation, whose failure union
 * includes `HookDenied`: that is what the sign-in page should explain, not "unavailable".
 */
export const admitRegistration = (
	access: InstanceAccess,
	intent: OAuth.OAuthRegistrationIntent,
): Effect.Effect<void, OAuth.OAuthUnavailable> => {
	if (registrationEmailAllowed(access, intent)) return Effect.void
	// SAFETY: the OAuth callback rethrows this failure unchanged into its operation, whose declared
	// failures include `HookDenied` (see above); only the port's signature names fewer.
	const refusal = denied as never as OAuth.OAuthUnavailable
	return Effect.logInfo("[auth] refused a sign-up outside the allowed email domains", {
		provider: intent.identity.provider,
		domains: access.allowedEmailDomains,
	}).pipe(Effect.andThen(Effect.fail(refusal)))
}

/** The lifecycle actions that start a session or change how an existing user signs in. */
const GATED_ACTIONS: ReadonlySet<Hooks.LifecycleAction> = new Set([
	"sign-in",
	"credential-change",
	"factor-change",
	"linking",
])

const contribution = Hooks.hookContribution("hazel/instance-access")

/**
 * The lifecycle hooks the auth routes run under: the allowed-domain check on the subject's recorded
 * email, or none when every domain is allowed. Reads `users` over the ambient `SqlClient`.
 */
export const makeAccessHooks = (access: InstanceAccess) =>
	access.allowedEmailDomains.length === 0
		? Hooks.LifecycleHooks.empty
		: Hooks.composeHooks(contribution).pipe(
				Layer.provide(
					contribution.layer({
						before: ({ action, subjectId }) =>
							subjectId === undefined || !GATED_ACTIONS.has(action)
								? Effect.void
								: Effect.gen(function* () {
										const sql = yield* SqlClient.SqlClient
										const rows = yield* ormOf(sql).run(
											SQLite.from(schema.usersTable)
												.select("email")
												.where(($) => [
													$.id.eq(UserId.make(subjectId)),
													$.deletedAt.isNull(),
												])
												.limit(1),
										)
										const email = rows[0]?.email
										// No row yet: a registration committing with this session, whose
										// email was checked when its intent was issued.
										if (email === undefined) return
										if (isEmailDomainAllowed(access.allowedEmailDomains, email)) return
										yield* Effect.logInfo(
											"[auth] refused a sign-in outside the allowed email domains",
											{ action, userId: subjectId },
										)
										return yield* denied
									}).pipe(
										Effect.catchTag(QUERY_ERROR_TAGS, (error) =>
											Effect.logError(
												"[auth] could not check the allowed email domains",
												error,
											).pipe(
												Effect.andThen(
													Effect.fail(
														Hooks.HookDenied.make({ reason: "unavailable" }),
													),
												),
											),
										),
									),
					}),
				),
			)
