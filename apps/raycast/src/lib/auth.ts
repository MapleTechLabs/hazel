/**
 * Signing in to Hazel: OAuth 2.1 with PKCE against Hazel's authorization server (the one its MCP
 * clients use, `apps/backend/src/routes/agent-oauth.ts`), for the read-only `customers:read`
 * scope. The extension registers itself once per API (`POST /oauth/register`); Raycast keeps the
 * tokens and shows a "Log out" preference once they are stored.
 *
 * Refresh tokens rotate, and Hazel ends the grant when one is presented twice, so a process
 * refreshes at most once at a time (`pending`).
 */
import { LocalStorage, OAuth } from "@raycast/api"
import { apiUrl } from "./config"

/** Raycast's web redirect, the same for every extension; it hands the code back to Raycast. */
const REDIRECT_URI = "https://raycast.com/redirect?packageName=Extension"
const SCOPE = "customers:read"

const client = new OAuth.PKCEClient({
	redirectMethod: OAuth.RedirectMethod.Web,
	providerName: "Hazel",
	providerIcon: "extension-icon.png",
	description: "Connect Hazel to search your organizations' customers. Raycast gets read-only access.",
})

/** Signed out, or the sign-in was refused: only a person can fix it. */
export class SignInRequiredError extends Error {
	constructor(message = "Sign in to Hazel to see your customers") {
		super(message)
		this.name = "SignInRequiredError"
	}
}

/** The OAuth client this extension registered with `api`, registering it the first time. */
const clientId = async (api: string) => {
	const key = `oauth-client:${api}`
	const known = await LocalStorage.getItem<string>(key)
	if (known !== undefined) return known
	const response = await fetch(`${api}/oauth/register`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			client_name: "Raycast",
			client_uri: "https://www.raycast.com",
			redirect_uris: [REDIRECT_URI],
			token_endpoint_auth_method: "none",
		}),
	})
	if (!response.ok) throw new Error(`Hazel refused to register Raycast (${response.status})`)
	const { client_id } = (await response.json()) as { client_id: string }
	await LocalStorage.setItem(key, client_id)
	return client_id
}

/** `POST /oauth/token`; stores and answers the new access token. */
const requestTokens = async (api: string, params: Record<string, string>) => {
	const response = await fetch(`${api}/oauth/token`, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams(params),
	})
	if (!response.ok) {
		const body = (await response.json().catch(() => ({}))) as { error_description?: string }
		if (response.status === 400 || response.status === 401) {
			await client.removeTokens()
			throw new SignInRequiredError(body.error_description)
		}
		throw new Error(body.error_description ?? `Hazel's token endpoint answered ${response.status}`)
	}
	const tokens = (await response.json()) as {
		access_token: string
		refresh_token: string
		expires_in: number
		scope: string
	}
	await client.setTokens({
		accessToken: tokens.access_token,
		refreshToken: tokens.refresh_token,
		expiresIn: tokens.expires_in,
		scope: tokens.scope,
	})
	return tokens.access_token
}

const signIn = async (api: string) => {
	const id = await clientId(api)
	const request = await client.authorizationRequest({
		endpoint: `${api}/oauth/authorize`,
		clientId: id,
		scope: SCOPE,
	})
	const { authorizationCode } = await client.authorize(request)
	return requestTokens(api, {
		grant_type: "authorization_code",
		code: authorizationCode,
		client_id: id,
		redirect_uri: request.redirectURI,
		code_verifier: request.codeVerifier,
	})
}

const refresh = async (api: string, refreshToken: string) =>
	requestTokens(api, {
		grant_type: "refresh_token",
		refresh_token: refreshToken,
		client_id: await clientId(api),
	})

let pending: Promise<string> | undefined

/**
 * A live access token: the stored one, refreshed when expired (or when `forceRefresh`, after the
 * API refused it); without tokens, or when the refresh is refused, signs in through the browser.
 */
export const accessToken = (options: { readonly forceRefresh?: boolean } = {}) => {
	pending ??= (async () => {
		const api = apiUrl()
		const tokens = await client.getTokens()
		if (tokens !== undefined && !options.forceRefresh && !tokens.isExpired()) return tokens.accessToken
		if (tokens?.refreshToken !== undefined) {
			try {
				return await refresh(api, tokens.refreshToken)
			} catch (error) {
				if (!(error instanceof SignInRequiredError)) throw error
			}
		}
		return signIn(api)
	})().finally(() => {
		pending = undefined
	})
	return pending
}

/** Forgets the tokens (Raycast's "Log out" preference does the same). */
export const signOut = () => client.removeTokens()
