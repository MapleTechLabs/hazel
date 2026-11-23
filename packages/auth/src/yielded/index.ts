/**
 * Server side of Hazel's authentication on `@yielded/auth`: GitHub and Google sign-in,
 * passkeys and stateful sessions stored in SQL (the directory D1 database); the `SqlClient` is
 * provided by the entry point. The browser-safe contract is
 * `@hazel/auth/contract`.
 */
export * as AccessToken from "./access-token.ts"
export { HazelAuth, requirement } from "./auth.ts"
export {
	type ExternalIdentity,
	findUserByEmail,
	identityKey,
	isProvider,
	type LinkResult,
	linkIdentity,
	type Provider,
	providerIssuers,
} from "./identities.ts"
export {
	type AuthProviders,
	authProviders,
	Claims,
	desktopClient,
	nativeClient,
	desktopLogin,
	HazelAuthApi,
	nativeHeaders,
	nativeSession,
	Registration,
	SignInProvider,
} from "./contract.ts"
export { enabledProviders, makeProvidersRoute } from "./providers.ts"
export {
	domainRestrictionMessage,
	emailDomain,
	type InstanceAccess,
	InstanceAccessConfig,
	isEmailDomainAllowed,
	isInstanceAdmin,
	ORG_CREATION_REFUSED_MESSAGE,
	type OrgCreation,
	parseAdminEmails,
	parseEmailDomains,
	parseInstanceAccess,
	parseOrgCreation,
} from "./instance-access.ts"
export { cleanupDesktopLogins, makeDesktopLoginRoutes } from "./desktop-login.ts"
export {
	type DevSignIn,
	DevSignInError,
	type DevSignInInput,
	type DevSignInPlatform,
	type DevSignInResult,
	devGitHubId,
	makeDevSignIn,
} from "./dev-sign-in.ts"
export {
	CryptoLive,
	devSignInGitHubClient,
	type HazelAuthConfig,
	type Keyring,
	makeHazelAuthHttp,
	makeHazelAuthLive,
	type OAuthClient,
	sessionCookieName,
} from "./server.ts"
