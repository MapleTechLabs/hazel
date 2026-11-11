/**
 * Who a forwarded call or socket acts for. The api Worker authenticates (session, bot token) and
 * hands objects the result; objects are reachable only through bindings, so it is trusted.
 */
import { CurrentUser } from "@hazel/domain"
import { ApiScope, CurrentBotScopes } from "@hazel/domain/scopes"
import { UserId } from "@hazel/schema"
import { Effect, Option, Schema } from "effect"

/**
 * An RPC's principal: the resolved `CurrentUser` (null for the public methods, which carry no
 * `AuthMiddleware`), plus the bot's granted scopes for a bot.
 */
export const InvokePrincipal = Schema.Struct({
	user: Schema.NullOr(CurrentUser.Schema),
	botScopes: Schema.NullOr(Schema.Array(ApiScope)),
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
	return {
		// The bot-token path provides a plain object; the schema encodes only the class.
		user: user === null || user instanceof CurrentUser.Schema ? user : new CurrentUser.Schema(user),
		botScopes: Option.isSome(scopes) ? [...scopes.value] : null,
	} satisfies InvokePrincipal
})

/** Provide `principal` the way the api's `AuthMiddleware` does: `CurrentUser`, and a bot's scopes. */
export const providePrincipal =
	(principal: InvokePrincipal) =>
	<A, E, R>(effect: Effect.Effect<A, E, R>) =>
		(principal.user === null
			? effect
			: effect.pipe(Effect.provideService(CurrentUser.Context, principal.user))
		).pipe(
			Effect.provideService(
				CurrentBotScopes,
				principal.botScopes === null ? Option.none() : Option.some(new Set(principal.botScopes)),
			),
		) as Effect.Effect<A, E, Exclude<R, CurrentUser.Context | CurrentBotScopes>>

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
