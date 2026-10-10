/**
 * Server side of Hazel's authentication on `@yielded/auth`: GitHub and Google sign-in,
 * passkeys and stateful sessions stored in Postgres. The browser-safe contract is
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
export { Claims, HazelAuthApi, Registration } from "./contract.ts"
export {
	CryptoLive,
	type HazelAuthConfig,
	type Keyring,
	makeHazelAuthHttp,
	makeHazelAuthLive,
	sessionCookieName,
} from "./server.ts"
export { AuthSqlConnection, AuthSqlDirect, layerDirect, layerPool, makeRequestConnection } from "./sql.ts"
