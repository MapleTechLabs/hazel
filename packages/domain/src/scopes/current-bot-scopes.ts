import { Context, Option } from "effect"
import type { ApiScope } from "./api-scope"

/**
 * Service holding the authenticated bot's granted API scopes.
 *
 * Set by the auth middleware when the actor is a bot.
 * When Option.some, OrgResolver uses these scopes instead of role-based
 * scopes, ensuring the bot's declared permissions are the source of truth.
 *
 * When Option.none (default), OrgResolver falls back to role-based scopes
 * for normal (human) users.
 */
export class CurrentBotScopes extends Context.Service<
	CurrentBotScopes,
	Option.Option<ReadonlySet<ApiScope>>
>()("CurrentBotScopes") {}
