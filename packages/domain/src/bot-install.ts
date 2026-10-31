/**
 * Installing a bot from outside Hazel, the way a chat platform installs an app: the bot's service
 * sends an org admin to `/oauth/bot-install?bot_id=&redirect_uri=&state=`, the admin picks an
 * organization and approves, Hazel installs the bot there and sends the browser back to
 * `redirect_uri?code=&state=`, and the service redeems the code with its own bot token
 * (`POST /api/v1/bot-installs/token`) for the organization it was installed in.
 *
 * The organization comes from the redeemed code, never from the redirect: a code is bound to the
 * bot, the redirect URI and the org at approval, is single-use and lives ten minutes. The redirect
 * URI must be one the bot's owner registered (`bots.installRedirectUris`), compared exactly.
 */
import { Schema } from "effect"

/** How long a grant can wait to be redeemed. */
export const BOT_INSTALL_GRANT_TTL_MS = 10 * 60 * 1_000

export const BOT_INSTALL_MAX_REDIRECT_URIS = 10

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"])

/**
 * A redirect URI a bot may register: absolute `https:` (or `http:` on loopback, for local
 * development), with no fragment and no credentials.
 */
export const isValidInstallRedirectUri = (value: string): boolean => {
	if (value.length > 2048 || !URL.canParse(value)) return false
	const url = new URL(value)
	if (url.hash !== "" || url.username !== "" || url.password !== "") return false
	if (url.protocol === "https:") return true
	return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname)
}

export const InstallRedirectUri = Schema.String.check(
	Schema.makeFilter((value: string) => isValidInstallRedirectUri(value) || "Expected an https URL"),
)

export const InstallRedirectUris = Schema.Array(InstallRedirectUri).check(
	Schema.isMaxLength(BOT_INSTALL_MAX_REDIRECT_URIS),
)

/** Where the consent page sends the browser: the registered URI with `params` added to its query. */
export const installRedirectUrl = (redirectUri: string, params: Readonly<Record<string, string>>): string => {
	const url = new URL(redirectUri)
	for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
	return url.toString()
}

/** `true` when `redirectUri` is one of the bot's registered URIs. */
export const isRegisteredInstallRedirect = (
	registered: ReadonlyArray<string> | null,
	redirectUri: string,
): boolean => registered !== null && registered.includes(redirectUri)
