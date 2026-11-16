/**
 * Who a forwarded call or socket acts for. The api Worker authenticates (session, bot token) and
 * hands objects the result; objects are reachable only through bindings, so it is trusted.
 */
import { CurrentUser } from "@hazel/domain"
import { ApiScope, CurrentBotScopes } from "@hazel/domain/scopes"
import { AgentGrantId, UserId } from "@hazel/schema"
import { Context, Effect, Option, Schema } from "effect"

/**
 * The agent a user's call came through (Hazel's MCP server, `routes/mcp`): the grant and the name
 * chat shows. Writes made with it are marked (`message_agent_marks`). Only the api Worker sets it,
 * from a verified agent token; a client cannot.
 */
export const AgentActor = Schema.Struct({
	grantId: AgentGrantId,
	name: Schema.String,
})
export type AgentActor = typeof AgentActor.Type

/** Provided while a call runs for an agent; absent for the user's own calls. */
export class CurrentAgent extends Context.Service<CurrentAgent, AgentActor>()("CurrentAgent") {}

/**
 * An RPC's principal: the resolved `CurrentUser` (null for the public methods, which carry no
 * `AuthMiddleware`), plus the bot's granted scopes for a bot.
 */
export const InvokePrincipal = Schema.Struct({
	user: Schema.NullOr(CurrentUser.Schema),
	botScopes: Schema.NullOr(Schema.Array(ApiScope)),
	agent: Schema.optional(Schema.NullOr(AgentActor)),
})
export type InvokePrincipal = typeof InvokePrincipal.Type

const InvokePrincipalJson = Schema.toCodecJson(InvokePrincipal)
export const encodeInvokePrincipal = Schema.encodeEffect(InvokePrincipalJson)
export const decodeInvokePrincipal = Schema.decodeUnknownEffect(InvokePrincipalJson)
/** The principal as it crosses a DO call (JSON). */
export type InvokePrincipalEncoded = typeof InvokePrincipalJson.Encoded

/** The principal of the current RPC, from what the auth middleware provided. */
export const currentInvokePrincipal = Effect.gen(function* () {
	const current = yield* Effect.serviceOption(CurrentUser.Context)
	const botScopes = yield* Effect.serviceOption(CurrentBotScopes)
	const scopes = Option.flatten(botScopes)
	const user = Option.getOrNull(current)
	const agent = yield* Effect.serviceOption(CurrentAgent)
	return {
		// The bot-token path provides a plain object; the schema encodes only the class.
		user: user === null || user instanceof CurrentUser.Schema ? user : new CurrentUser.Schema(user),
		botScopes: Option.isSome(scopes) ? [...scopes.value] : null,
		agent: Option.getOrNull(agent),
	} satisfies InvokePrincipal
})

/**
 * Provide `principal` the way the api's `AuthMiddleware` does: `CurrentUser`, a bot's scopes, and
 * the agent it came through.
 */
export const providePrincipal =
	(principal: InvokePrincipal) =>
	<A, E, R>(effect: Effect.Effect<A, E, R>) => {
		const withUser =
			principal.user === null
				? effect
				: effect.pipe(Effect.provideService(CurrentUser.Context, principal.user))
		const withAgent =
			principal.agent === undefined || principal.agent === null
				? withUser
				: withUser.pipe(Effect.provideService(CurrentAgent, principal.agent))
		return withAgent.pipe(
			Effect.provideService(
				CurrentBotScopes,
				principal.botScopes === null ? Option.none() : Option.some(new Set(principal.botScopes)),
			),
		) as Effect.Effect<A, E, Exclude<R, CurrentUser.Context | CurrentBotScopes>>
	}

/**
 * A sync socket's principal, kept small (it rides in the socket attachment, 2 KiB max): the user
 * and when their token expires (epoch ms; the object closes the socket with `Reauth` then).
 */
export const SyncPrincipal = Schema.Struct({
	userId: UserId,
	expiresAt: Schema.NullOr(Schema.Number),
})
export type SyncPrincipal = typeof SyncPrincipal.Type

/** The header the api Worker forwards a sync upgrade with: `SyncPrincipal` as JSON. */
export const PRINCIPAL_HEADER = "x-hazel-principal"
/** The object's own id (DO name), forwarded with every request so the object learns it. */
export const OBJECT_ID_HEADER = "x-hazel-object-id"
/** Set on a request that only wakes the object (`POST /sync/warm`): it answers 204 once activated. */
export const WARM_HEADER = "x-hazel-warm"

export const decodeSyncPrincipal = Schema.decodeUnknownOption(Schema.fromJsonString(SyncPrincipal))
export const encodeSyncPrincipal = Schema.encodeSync(Schema.fromJsonString(SyncPrincipal))
