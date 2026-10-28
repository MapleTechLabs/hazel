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
	Claims,
	desktopClient,
	desktopLogin,
	HazelAuthApi,
	nativeHeaders,
	nativeSession,
	Registration,
} from "./contract.ts"
export { cleanupDesktopLogins, makeDesktopLoginRoutes } from "./desktop-login.ts"
export {
	CryptoLive,
	type HazelAuthConfig,
	type Keyring,
	makeHazelAuthHttp,
	makeHazelAuthLive,
	sessionCookieName,
} from "./server.ts"
