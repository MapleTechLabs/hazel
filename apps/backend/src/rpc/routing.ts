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
import { type DatabaseError, SQLite, schema } from "@hazel/db"
import type { CurrentUser, RateLimitExceededError } from "@hazel/domain"
import type { ChannelId, ConnectConversationId, ConnectInviteId, OrganizationId } from "@hazel/schema"
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

/**
 * The org a bot call acts in: the payload's `organizationId`, else the caller's active org; with
 * neither, the directory path (which answers `ActiveOrganizationRequiredError`, or `[]`).
 */
const activeOrg = (payload: { readonly organizationId?: OrganizationId | undefined }, current: User) => {
	const organizationId = payload.organizationId ?? current.organizationId ?? undefined
	return organizationId === undefined ? directory() : org(organizationId)
}

const byOrg = (payload: { readonly organizationId: OrganizationId }) => org(payload.organizationId)
const byChannel = (payload: { readonly channelId: ChannelId }) => channel(payload.channelId)
const byOrgOfChannel = (method: string) => (payload: { readonly channelId: ChannelId }) =>
	orgOfChannel(method, payload.channelId)

/** A Connect invite's host or guest org (D1); unknown, the directory path answers not found. */
const byInvite = (inviteId: ConnectInviteId, side: "host" | "guest") =>
	Effect.gen(function* () {
		const { db } = yield* Directory
		const invite = yield* db.first(
			SQLite.from(schema.connectInvitesTable)
				.select("hostOrganizationId", "guestOrganizationId")
				.where(($) => [$.id.eq(inviteId)])
				.limit(1),
		)
		const organizationId = Option.flatMap(invite, (row) =>
			Option.fromNullishOr(side === "host" ? row.hostOrganizationId : row.guestOrganizationId),
		)
		return Option.match(organizationId, {
			onNone: () => directoryTarget,
			onSome: (id) => orgTarget(id) as RpcTarget,
		})
	})

/** The org hosting a Connect conversation, from its invites (D1). */
const hostOfConversation = (conversationId: ConnectConversationId) =>
	Effect.gen(function* () {
		const { db } = yield* Directory
		const invite = yield* db.first(
			SQLite.from(schema.connectInvitesTable)
				.select("hostOrganizationId")
				.where(($) => [$.conversationId.eq(conversationId)])
				.limit(1),
		)
		return Option.map(invite, (row) => row.hostOrganizationId)
	})

/**
 * `connectShare.organization.disconnect`: the host org ends it or removes a guest; a guest org's
 * own member (an admin there, checked by the object) leaves from the guest org.
 */
const connectDisconnect = (
	payload: { readonly conversationId: ConnectConversationId; readonly organizationId: OrganizationId },
	current: User,
) =>
	Effect.gen(function* () {
		const host = yield* hostOfConversation(payload.conversationId)
		if (Option.isNone(host)) return directoryTarget
		if (payload.organizationId === host.value) return orgTarget(host.value) as RpcTarget
		const membership = yield* (yield* Directory).membership(current.id, payload.organizationId)
		const inGuest = Option.isSome(membership) && membership.value.deletedAt === null
		return orgTarget(inGuest ? payload.organizationId : host.value) as RpcTarget
	})

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
	// The org's search index, filtered by the caller's `channel_access` there.
	"message.search": byOrg,
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
	// Connect: the host org (invites out, settings), the guest org (accepting), the channel's org
	// (members), the caller's org (search, lists; the rows are D1's).
	"connectShare.invite.create": byOrgOfChannel("connectShare.invite.create"),
	"connectShare.member.add": byOrgOfChannel("connectShare.member.add"),
	"connectShare.member.remove": byOrgOfChannel("connectShare.member.remove"),
	"connectShare.organization.disconnect": (payload, current) => connectDisconnect(payload, current),
	"connectShare.workspace.search": byOrg,
	"connectShare.invite.accept": (payload) => org(payload.guestOrganizationId),
	"connectShare.invite.decline": (payload) => byInvite(payload.inviteId, "guest"),
	"connectShare.invite.revoke": (payload) => byInvite(payload.inviteId, "host"),
	"connectShare.invite.listIncoming": byOrg,
	"connectShare.invite.listOutgoing": byOrg,
	"connectShare.settings.update": (payload) =>
		Effect.map(hostOfConversation(payload.conversationId), (host) =>
			Option.match(host, { onNone: () => directoryTarget, onSome: (id) => orgTarget(id) as RpcTarget }),
		),
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
	"user.update": directory, // projects to each OrgObject (applied from the Worker)
	"user.finalizeOnboarding": directory,
	"bot.create": activeOrg, // writes the installation; the directory row goes through its outbox
	"bot.list": directory,
	"bot.get": directory,
	"bot.update": directory, // projects to the bot's orgs
	"bot.delete": directory, // projects to the bot's orgs
	"bot.regenerateToken": directory,
	"bot.getCommands": directory,
	"bot.listPublic": directory,
	"bot.listInstalled": activeOrg,
	"bot.install": activeOrg,
	"bot.uninstall": activeOrg,
	"bot.installById": activeOrg,
	"bot.updateAvatar": directory, // projects the bot user to its orgs
	// Invitation rows are the directory's; the admin check needs the org's members.
	"invitation.create": byOrg,
	"invitation.list": byOrg,
	"invitation.revoke": (payload) =>
		Effect.gen(function* () {
			const { db } = yield* Directory
			const row = yield* db.first(
				SQLite.from(schema.organizationInvitationsTable)
					.select("organizationId")
					.where(($) => [$.id.eq(payload.id)])
					.limit(1),
			)
			// Unknown: the directory path answers InvitationNotFoundError.
			return Option.match(row, {
				onNone: () => directoryTarget,
				onSome: (invitation) => orgTarget(invitation.organizationId) as RpcTarget,
			})
		}),
	"invitation.preview": directory,
	"invitation.accept": directory, // applies `org.acceptInvitation` from the Worker
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
