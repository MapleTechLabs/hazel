import { Auth, OAuth, Passkey, Sessions } from "@yielded/auth"
import * as GitHub from "@yielded/auth/GitHub"
import * as Google from "@yielded/auth/Google"

import { HazelAuthApi, Registration } from "./contract.ts"

/** One namespace for sign-in, registration and linked-account management, so all
 * three share the same login credentials. */
export const oauthNamespace = "hazel/oauth"

export const oauthPolicy = {
	generation: 1,
	lifetimeMillis: 300_000,
	exchangeTimeoutMillis: 30_000,
}

export const sessionConfiguration = Sessions.stateful({
	maxAge: "30 days",
	idleTimeout: "14 days",
})

export const HazelAuth = Auth.make(HazelAuthApi, {
	sessions: sessionConfiguration,
	strategies: {
		social: OAuth.makeRegistration({
			namespace: oauthNamespace,
			profiles: { github: GitHub.GitHubUserProfile, google: Google.GoogleUserProfile },
			registration: Registration,
			authenticate: true,
			policy: oauthPolicy,
			registrationPolicy: {
				lifetimeMillis: 300_000,
				maximumVerificationAgeMillis: 300_000,
				retentionMillis: 600_000,
			},
		}),
		accounts: OAuth.makeAccounts({
			namespace: oauthNamespace,
			policy: {
				...oauthPolicy,
				maximumEvidenceAgeMillis: 300_000,
				requireImmediateInvalidation: true,
			},
		}),
		passkey: Passkey.make(),
		passkeys: Passkey.makeManagement({
			management: {
				maximumCredentials: 10,
				maximumEvidenceAgeMillis: 300_000,
				requireImmediateInvalidation: true,
			},
		}),
	},
	defaultStrategy: "social",
})

/** Either an OAuth login (possession) or a user-verified passkey satisfies sign-in. */
export const requirement = Sessions.AuthenticationRequirement.make({
	alternatives: [
		{
			factors: ["possession"],
			userVerified: false,
			phishingResistant: false,
			minimumCredentials: 1,
		},
	],
	maximumAgeMillis: 300_000,
})
