/**
 * Where each HazelRpc method runs (`infra/durable-object-sync-plan.md` §4): the object that owns
 * the rows it writes, or `directory` (the api Worker itself, over D1).
 *
 * - `organizationId` in the payload → `OrgObject`.
 * - `channelId` → the `ChannelObject` (a Connect guest mount resolves to its host channel through
 *   `channel_index`), or the channel's `OrgObject` for channel-level org rows (members,
 *   webhooks, subscriptions).
 * - A payload with only a message, reaction, pin, typing or attachment id carries `channelId`; one
 *   with only an org row id carries `organizationId` (`@hazel/domain/rpc/routing-fields`). Until
 *   the client sends them those calls fail here with `RoutingError`.
 * - User-scoped calls → the caller's `UserObject`.
 *
 * `routes` is total: a method added to HazelRpc without an entry fails to compile. Entries are the
 * current best guess; porting a handler may move it (and its TODO says so).
 *
 * The rate limits the handlers applied run here, once, before the call leaves the Worker; objects
 * and the directory path admit everything (`RateLimiterAllowAll`).
 */
import type { DatabaseError } from "@hazel/db"
import type { CurrentUser, RateLimitExceededError } from "@hazel/domain"
import type { ChannelId, OrganizationId } from "@hazel/schema"
import { Effect, Option, Schema } from "effect"
import type { Rpc } from "effect/rpc"
import { Directory } from "../services/directory"
import {
	checkBotOperationRateLimit,
	checkBotUpdateRateLimit,
	checkMessageRateLimit,
} from "../services/rate-limit-helpers"
import type { RateLimiter } from "../services/rate-limiter"
import {
	channelTarget,
	directoryTarget,
	formatTarget,
	orgTarget,
	type RpcTarget,
	userTarget,
} from "../worker/objects/kinds"
import type { HazelRpc, HazelRpcTag } from "./dispatch"

/** The api Worker could not tell where a call goes. */
export class RoutingError extends Schema.TaggedError<RoutingError>()("RoutingError", {
	method: Schema.String,
	message: Schema.String,
}) {}

type User = CurrentUser.Schema

export type RouteFn<R extends Rpc.Any> = (
	payload: Rpc.Payload<R>,
	user: User,
) => Effect.Effect<RpcTarget, RoutingError | DatabaseError, Directory>

/** One entry per HazelRpc method. */
export type RouteTable = { readonly [R in HazelRpc as R["_tag"]]: RouteFn<R> }

const directory = () => Effect.succeed(directoryTarget)
const user = (_payload: unknown, current: User) => Effect.succeed(userTarget(current.id))
const org = (organizationId: OrganizationId) => Effect.succeed<RpcTarget>(orgTarget(organizationId))

/** The `ChannelObject` holding the channel's messages: the host channel for a Connect guest mount. */
const channel = (channelId: ChannelId) =>
	Effect.gen(function* () {
		const index = yield* (yield* Directory).channel(channelId)
		// Unindexed: route anyway, the object refuses a channel it has no viewers for.
		return channelTarget(
			Option.match(index, { onNone: () => channelId, onSome: (row) => row.hostChannelId ?? channelId }),
		) as RpcTarget
	})

/** The `OrgObject` owning the channel (the mounting org for a Connect mount). */
const orgOfChannel = (method: string, channelId: ChannelId) =>
	Effect.gen(function* () {
		const index = yield* (yield* Directory).channel(channelId)
		if (Option.isNone(index)) {
			return yield* new RoutingError({ method, message: `Channel ${channelId} is not indexed` })
		}
		return orgTarget(index.value.organizationId) as RpcTarget
	})

/** A routing hint the client must send (`routing-fields.ts`). */
const hint = <A>(method: string, field: string, value: A | undefined) =>
	value === undefined
		? Effect.fail(new RoutingError({ method, message: `${method} needs \`${field}\` to be routed` }))
		: Effect.succeed(value)

const channelHint = (method: string) => (payload: { readonly channelId?: ChannelId | undefined }) =>
	Effect.flatMap(hint(method, "channelId", payload.channelId), channel)

const orgHint = (method: string) => (payload: { readonly organizationId?: OrganizationId | undefined }) =>
	Effect.flatMap(hint(method, "organizationId", payload.organizationId), org)

const byOrg = (payload: { readonly organizationId: OrganizationId }) => org(payload.organizationId)
const byChannel = (payload: { readonly channelId: ChannelId }) => channel(payload.channelId)
const byOrgOfChannel = (method: string) => (payload: { readonly channelId: ChannelId }) =>
	orgOfChannel(method, payload.channelId)

export const routes: RouteTable = {
	// ChannelObject
	"message.create": byChannel,
	"message.update": channelHint("message.update"),
	"message.delete": channelHint("message.delete"),
	"messageReaction.toggle": byChannel,
	"messageReaction.create": byChannel,
	"messageReaction.update": channelHint("messageReaction.update"),
	"messageReaction.delete": channelHint("messageReaction.delete"),
	"typingIndicator.create": byChannel,
	"typingIndicator.update": channelHint("typingIndicator.update"),
	"typingIndicator.delete": channelHint("typingIndicator.delete"),
	"pinnedMessage.create": byChannel,
	"pinnedMessage.update": channelHint("pinnedMessage.update"),
	"pinnedMessage.delete": channelHint("pinnedMessage.delete"),
	"attachment.delete": channelHint("attachment.delete"),
	"attachment.complete": channelHint("attachment.complete"),
	"attachment.fail": channelHint("attachment.fail"),
	"channel.generateName": byChannel,

	// UserObject (the caller's)
	"notification.create": user,
	"notification.update": user,
	"notification.delete": user,
	"notification.deleteByMessageIds": user,
	"userPresenceStatus.update": user,
	"userPresenceStatus.heartbeat": user,
	"userPresenceStatus.clearStatus": user,

	// OrgObject
	"integrationRequest.create": byOrg,
	"organization.update": (payload) => org(payload.id),
	"organization.delete": (payload) => org(payload.id),
	"organization.setSlug": (payload) => org(payload.id),
	"organization.setPublicMode": (payload) => org(payload.id),
	"organizationMember.create": byOrg,
	"organizationMember.update": orgHint("organizationMember.update"),
	"organizationMember.updateMetadata": orgHint("organizationMember.updateMetadata"),
	"organizationMember.delete": orgHint("organizationMember.delete"),
	"channel.create": byOrg,
	"channel.update": (payload) => orgOfChannel("channel.update", payload.id),
	"channel.delete": (payload) => orgOfChannel("channel.delete", payload.id),
	"channel.createDm": byOrg,
	"channel.createThread": (payload) =>
		payload.organizationId === undefined
			? Effect.fail(
					new RoutingError({ method: "channel.createThread", message: "needs `organizationId`" }),
				)
			: org(payload.organizationId),
	"channelMember.create": byOrgOfChannel("channelMember.create"),
	"channelMember.update": orgHint("channelMember.update"),
	"channelMember.delete": orgHint("channelMember.delete"),
	"channelMember.clearNotifications": byOrgOfChannel("channelMember.clearNotifications"),
	"channelSection.create": byOrg,
	"channelSection.update": orgHint("channelSection.update"),
	"channelSection.delete": orgHint("channelSection.delete"),
	"channelSection.reorder": byOrg,
	"channelSection.moveChannel": byOrgOfChannel("channelSection.moveChannel"),
	"channelWebhook.create": byOrgOfChannel("channelWebhook.create"),
	"channelWebhook.list": byOrgOfChannel("channelWebhook.list"),
	"channelWebhook.update": orgHint("channelWebhook.update"),
	"channelWebhook.regenerateToken": orgHint("channelWebhook.regenerateToken"),
	"channelWebhook.delete": orgHint("channelWebhook.delete"),
	"channelWebhook.listByOrganization": orgHint("channelWebhook.listByOrganization"),
	"githubSubscription.create": byOrgOfChannel("githubSubscription.create"),
	"githubSubscription.list": byOrgOfChannel("githubSubscription.list"),
	"githubSubscription.listByOrganization": orgHint("githubSubscription.listByOrganization"),
	"githubSubscription.update": orgHint("githubSubscription.update"),
	"githubSubscription.delete": orgHint("githubSubscription.delete"),
	"rssSubscription.create": byOrgOfChannel("rssSubscription.create"),
	"rssSubscription.list": byOrgOfChannel("rssSubscription.list"),
	"rssSubscription.listByOrganization": orgHint("rssSubscription.listByOrganization"),
	"rssSubscription.update": orgHint("rssSubscription.update"),
	"rssSubscription.delete": orgHint("rssSubscription.delete"),
	"customEmoji.create": byOrg,
	"customEmoji.update": orgHint("customEmoji.update"),
	"customEmoji.delete": orgHint("customEmoji.delete"),
	"customEmoji.restore": orgHint("customEmoji.restore"),
	"connectShare.invite.create": byOrgOfChannel("connectShare.invite.create"),
	"connectShare.member.add": byOrgOfChannel("connectShare.member.add"),
	"connectShare.member.remove": byOrgOfChannel("connectShare.member.remove"),
	"connectShare.organization.disconnect": byOrg,
	"chatSync.connection.create": byOrg,
	"chatSync.connection.list": byOrg,
	"chatSync.connection.delete": orgHint("chatSync.connection.delete"),
	"chatSync.channelLink.create": orgHint("chatSync.channelLink.create"),
	"chatSync.channelLink.list": orgHint("chatSync.channelLink.list"),
	"chatSync.channelLink.update": orgHint("chatSync.channelLink.update"),
	"chatSync.channelLink.delete": orgHint("chatSync.channelLink.delete"),

	// Directory (D1, in the api Worker). TODO(do-sync): the ones marked * write org rows too and
	// must fan out through the outbox (or move to the org) when ported.
	"organization.create": directory, // * creates the OrgObject's first rows
	"organization.getBySlugPublic": directory,
	"organization.joinViaPublicInvite": directory, // * adds an org member
	"user.me": directory,
	"user.update": directory, // * projects to each OrgObject (membership_index)
	"user.finalizeOnboarding": directory,
	"bot.create": directory,
	"bot.list": directory,
	"bot.get": directory,
	"bot.update": directory,
	"bot.delete": directory,
	"bot.regenerateToken": directory,
	"bot.getCommands": directory,
	"bot.listPublic": directory,
	"bot.listInstalled": directory, // * installations are org rows: needs `organizationId`
	"bot.install": directory, // *
	"bot.uninstall": directory, // *
	"bot.installById": directory, // *
	"bot.updateAvatar": directory,
	"invitation.create": directory,
	"invitation.list": directory,
	"invitation.revoke": directory,
	"invitation.preview": directory,
	"invitation.accept": directory, // * adds an org member
	"connectShare.workspace.search": directory,
	"connectShare.invite.accept": directory, // * mounts in the guest org, participants in the host
	"connectShare.invite.decline": directory,
	"connectShare.invite.revoke": directory,
	"connectShare.invite.listIncoming": directory,
	"connectShare.invite.listOutgoing": directory,
	"connectShare.settings.update": directory, // * conversation lives in the host OrgObject
}

/** The limits the handlers used to apply themselves, now applied once in the api Worker. */
export const rateLimits: Partial<
	Record<HazelRpcTag, (user: User) => Effect.Effect<void, RateLimitExceededError, RateLimiter>>
> = {
	"message.create": (current) => checkMessageRateLimit(current.id),
	"message.update": (current) => checkMessageRateLimit(current.id),
	"message.delete": (current) => checkMessageRateLimit(current.id),
	"bot.create": (current) => checkBotOperationRateLimit(current.id),
	"bot.update": (current) => checkBotUpdateRateLimit(current.id),
	"bot.regenerateToken": (current) => checkBotOperationRateLimit(current.id),
	"bot.install": (current) => checkBotOperationRateLimit(current.id),
	"bot.uninstall": (current) => checkBotOperationRateLimit(current.id),
	"bot.installById": (current) => checkBotOperationRateLimit(current.id),
}

/** Where `tag` runs for `payload` (decoded) and `user`. */
export const resolveTarget = (
	tag: HazelRpcTag,
	payload: unknown,
	current: User,
): Effect.Effect<RpcTarget, RoutingError | DatabaseError, Directory> => {
	const route = routes[tag] as RouteFn<Rpc.Any> | undefined
	if (route === undefined) return Effect.fail(new RoutingError({ method: tag, message: "No route" }))
	return route(payload as never, current).pipe(
		Effect.tap((target) => Effect.annotateCurrentSpan({ "rpc.target": formatTarget(target) })),
		Effect.withSpan("HazelRpc.route", { attributes: { "rpc.method": tag } }),
	)
}
