/**
 * The consent links' parameters (OAuth consent and bot install), read from their routes for the
 * native pages (`root/native-pages.ts`). `null` is a link that cannot be honoured.
 */
import { parseAgentScopes } from "@hazel/domain/http"
import { AgentClientId, BotId } from "@hazel/schema"
import type { AgentRequest } from "@hazel/shared-screens/auth/pages/oauth/authorize/OAuthAuthorizePage"
import type { InstallRequest } from "@hazel/shared-screens/auth/pages/oauth/bot-install/BotInstallPage"
import { Option, Schema } from "effect"
import type { RouteOf } from "../route"

const decodeClientId = Schema.decodeUnknownOption(AgentClientId)
const decodeBotId = Schema.decodeUnknownOption(BotId)

/** Only `code` with S256 PKCE. */
export const agentRequestOf = (route: RouteOf<"OAuthAuthorize">): AgentRequest | null => {
	const clientId = Option.flatMap(route.clientId, decodeClientId)
	const method = Option.getOrElse(route.codeChallengeMethod, () => "S256")
	if (
		Option.isNone(clientId) ||
		Option.isNone(route.redirectUri) ||
		Option.isNone(route.codeChallenge) ||
		Option.getOrNull(route.responseType) !== "code" ||
		method !== "S256"
	)
		return null
	const scope = Option.getOrNull(route.scope)
	return {
		clientId: clientId.value,
		redirectUri: route.redirectUri.value,
		codeChallenge: route.codeChallenge.value,
		codeChallengeMethod: method,
		scope,
		state: Option.getOrNull(route.state),
		scopes: parseAgentScopes(scope),
	}
}

export const installRequestOf = (route: RouteOf<"BotInstall">): InstallRequest | null => {
	const botId = Option.flatMap(route.botId, decodeBotId)
	if (Option.isNone(botId) || Option.isNone(route.redirectUri) || Option.isNone(route.state)) return null
	return { botId: botId.value, redirectUri: route.redirectUri.value, state: route.state.value }
}
