/**
 * Chat sync inside an `OrgObject`: it owns the connections and channel links, the org's members
 * and the users projection, so it decides where an inbound provider event goes and who wrote it.
 *
 * - `org.chatSyncIngest` (from a provider source, `chat-sync-inbound.ts`): find the active link for
 *   the external channel, drop the provider's echoes of Hazel's own posts, resolve the author (a
 *   linked Hazel account, else the provider user's shadow, made a member here on first sight) and
 *   the mentions, then `channel.chatSyncIngest` to the linked channel. Provider threads become
 *   Hazel threads here, attached to their parent message (`channel.chatSyncAttachThread`).
 * - `org.chatSyncLinkSettings` (from a `ChannelObject`): a webhook identity it provisioned.
 * - `org.chatSyncLinkThread` (from a `ChannelObject`): a provider thread it made for a Hazel thread.
 * - `publishChatSyncLinks` / `indexChatSync*`: project links to the channel, and keep the
 *   directory's `chat_sync_index` current. Call them wherever a connection or link changes.
 */
import { ChannelRepo, OrganizationMemberRepo } from "@hazel/backend-core"
import { Database, SQLite, schema } from "@hazel/db"
import {
	type ChannelId,
	type ExternalChannelId,
	ExternalMessageId,
	ExternalThreadId,
	type ExternalUserId,
	type OrganizationId,
	type SyncChannelLinkId,
	type SyncConnectionId,
	type UserId,
} from "@hazel/schema"
import { withInbox } from "@hazel/sync-do"
import { Effect, Layer, Option } from "effect"
import type { SqlClient } from "effect/sql/SqlClient"
import {
	CurrentEffectSender,
	enqueueEffect,
	type EffectReceivers,
} from "../../worker/objects/effects/registry"
import { channelTarget } from "../../worker/objects/kinds"
import { syncChannelAccess, syncMemberAccess } from "../../worker/objects/org/channel-access"
import { renameChannel } from "../../worker/objects/org/channel-rename"
import { upsertUserProjection } from "../../worker/objects/org/projections"
import { ChannelAccessSyncService } from "../channel-access-sync"
import {
	type ChannelIngestEvent,
	CHAT_SYNC_LINKS_VERSION,
	ChatSyncChannelEffects,
	type ChatSyncChannelTarget,
	ChatSyncDirectoryEffects,
	type ChatSyncIndexPayload,
	type ChatSyncLinkedAccount,
	type ChatSyncMention,
	ChatSyncOrgEffects,
	type LinkSettingsPayload,
	type LinkThreadPayload,
	type OrgChatSyncIngestPayload,
	type RepublishLinksPayload,
} from "./chat-sync-effects"
import { recordChannelAuthor } from "./chat-sync-authors"
import type { ChatSyncProviderDefinition } from "./provider"
import { definitionOf } from "./providers"

/**
 * Whether `parent` is the link `thread`'s link was made under: a thread's link is always made
 * after its parent's, so a parent linked again later (perhaps to another provider channel) is not.
 */
const isParentOf = (parent: { readonly createdAt: Date }, thread: { readonly createdAt: Date }) =>
	parent.createdAt.getTime() <= thread.createdAt.getTime()

/** The channel's own active links (on active connections), with when each was made. */
const activeLinksOf = (channelId: ChannelId) =>
	Effect.flatMap(Database.Database, (db) =>
		db.run(
			SQLite.from(schema.chatSyncChannelLinksTable, "link")
				.innerJoin(schema.chatSyncConnectionsTable, "connection", (link, connection) =>
					connection.id.eq(link.syncConnectionId),
				)
				.select(($) => ({
					channelLinkId: $.id,
					syncConnectionId: $.syncConnectionId,
					organizationId: $.connection.organizationId,
					provider: $.connection.provider,
					externalWorkspaceId: $.connection.externalWorkspaceId,
					externalChannelId: $.externalChannelId,
					direction: $.direction,
					settings: $.settings,
					createdAt: $.createdAt,
				}))
				.where(($) => [
					$.hazelChannelId.eq(channelId),
					$.isActive.eq(true),
					$.deletedAt.isNull(),
					$.connection.status.eq("active"),
					$.connection.deletedAt.isNull(),
				]),
		),
	).pipe(
		Effect.map((rows) =>
			rows.map(({ createdAt, ...row }) => ({
				createdAt,
				target: {
					...row,
					externalChannelId: row.externalChannelId as ExternalChannelId,
				} satisfies ChatSyncChannelTarget,
			})),
		),
	)

/**
 * The channel's active links, as its `ChannelObject` keeps them. A thread's link is its parent's
 * link carried into the thread: direction and settings (the webhook identity) are read from the
 * parent's, so they cannot drift, and a thread whose parent is no longer linked does not sync.
 */
const channelTargets = Effect.fn("OrgObject.chatSyncChannelTargets")(function* (channelId: ChannelId) {
	const db = yield* Database.Database
	const links = yield* activeLinksOf(channelId)
	if (links.length === 0) return []
	const channel = yield* db.first(
		SQLite.from(schema.channelsTable)
			.select("type", "parentChannelId")
			.where(($) => [$.id.eq(channelId)])
			.limit(1),
	)
	if (Option.isNone(channel) || channel.value.type !== "thread" || channel.value.parentChannelId === null) {
		return links.map((link) => link.target)
	}
	const parents = yield* activeLinksOf(channel.value.parentChannelId)
	return links.flatMap(({ target, createdAt }): Array<ChatSyncChannelTarget> => {
		const parent = parents.find(
			(entry) =>
				entry.target.syncConnectionId === target.syncConnectionId && isParentOf(entry, { createdAt }),
		)?.target
		if (parent === undefined) return []
		return [
			{
				...target,
				direction: parent.direction,
				settings: parent.settings,
				parent: { channelLinkId: parent.channelLinkId, externalChannelId: parent.externalChannelId },
			},
		]
	})
})

/** The linked thread channels under `channelId`. */
const linkedThreadsOf = (channelId: ChannelId) =>
	Effect.flatMap(Database.Database, (db) =>
		db.run(
			SQLite.from(schema.chatSyncChannelLinksTable, "link")
				.innerJoin(schema.channelsTable, "channel", (link, channel) =>
					channel.id.eq(link.hazelChannelId),
				)
				.select(($) => ({ id: $.hazelChannelId }))
				.where(($) => [
					$.deletedAt.isNull(),
					$.channel.parentChannelId.eq(channelId),
					$.channel.type.eq("thread"),
					$.channel.deletedAt.isNull(),
				]),
		),
	).pipe(Effect.map((rows) => [...new Set(rows.map((row) => row.id))]))

/** The links of the threads under a channel's link: they go with it when it is unlinked. */
export const threadLinksUnder = (link: {
	readonly syncConnectionId: SyncConnectionId
	readonly hazelChannelId: ChannelId
}) =>
	Effect.flatMap(Database.Database, (db) =>
		db.run(
			SQLite.from(schema.chatSyncChannelLinksTable, "link")
				.innerJoin(schema.channelsTable, "channel", (link, channel) =>
					channel.id.eq(link.hazelChannelId),
				)
				.select(($) => ({
					id: $.id,
					externalChannelId: $.externalChannelId,
					hazelChannelId: $.hazelChannelId,
				}))
				.where(($) => [
					$.syncConnectionId.eq(link.syncConnectionId),
					$.deletedAt.isNull(),
					$.channel.parentChannelId.eq(link.hazelChannelId),
					$.channel.type.eq("thread"),
				]),
		),
	)

/** The org's users with a linked provider account (outbound mentions). */
const linkedAccounts = (providers: ReadonlyArray<string>) =>
	Effect.gen(function* () {
		if (providers.length === 0) return [] as Array<ChatSyncLinkedAccount>
		const db = yield* Database.Database
		const rows = yield* db.run(
			SQLite.from(schema.integrationConnectionsTable)
				.select("userId", "provider", "externalAccountId")
				.where(($) => [
					$.level.eq("user"),
					$.status.eq("active"),
					$.deletedAt.isNull(),
					$.provider.in_(...(providers as Array<never>)),
				]),
		)
		return rows.flatMap((row): Array<ChatSyncLinkedAccount> =>
			row.userId !== null && row.externalAccountId
				? [
						{
							userId: row.userId,
							provider: row.provider,
							externalAccountId: row.externalAccountId,
						},
					]
				: [],
		)
	})

/** Project one channel's active links to its `ChannelObject` (outbox, inside the transaction). */
const publishLinksOf = (channelId: ChannelId) =>
	Effect.gen(function* () {
		const links = yield* channelTargets(channelId)
		const accounts = yield* linkedAccounts([...new Set(links.map((link) => link.provider))])
		yield* enqueueEffect(ChatSyncChannelEffects.setChatSyncLinks, channelTarget(channelId), {
			version: CHAT_SYNC_LINKS_VERSION,
			links,
			accounts,
		})
		return links.length
	})

/**
 * Project `channelId`'s active links to its `ChannelObject`, and its linked threads' (which read
 * the channel's link), so a change to a link reaches every thread under it.
 */
export const publishChatSyncLinks = Effect.fn("OrgObject.publishChatSyncLinks")(function* (
	channelId: ChannelId,
) {
	const links = yield* publishLinksOf(channelId)
	const threads = yield* linkedThreadsOf(channelId)
	yield* Effect.forEach(threads, publishLinksOf, { discard: true })
	yield* Effect.annotateCurrentSpan({ "chat_sync.links": links, "chat_sync.threads": threads.length })
})

/**
 * A user linked or unlinked a `provider` account: re-project every channel linked on that
 * provider, so its outbound mentions use the current accounts. Call after the account row changed.
 */
export const publishChatSyncAccounts = Effect.fn("OrgObject.publishChatSyncAccounts")(function* (
	provider: string,
) {
	const db = yield* Database.Database
	const rows = yield* db.run(
		SQLite.from(schema.chatSyncChannelLinksTable, "link")
			.innerJoin(schema.chatSyncConnectionsTable, "connection", (link, connection) =>
				connection.id.eq(link.syncConnectionId),
			)
			.select(($) => ({ hazelChannelId: $.hazelChannelId }))
			.where(($) => [
				$.deletedAt.isNull(),
				$.connection.provider.eq(provider),
				$.connection.deletedAt.isNull(),
			]),
	)
	const channelIds = [...new Set(rows.map((row) => row.hazelChannelId))]
	// Every linked channel, threads included: each once.
	yield* Effect.forEach(channelIds, publishLinksOf, { discard: true })
	yield* Effect.annotateCurrentSpan({
		"chat_sync.provider": provider,
		"chat_sync.channels": channelIds.length,
	})
	return channelIds.length
})

const indexRow = (
	connection: {
		readonly provider: string
		readonly externalWorkspaceId: string
		readonly organizationId: OrganizationId
	},
	link?: { readonly externalChannelId: string; readonly hazelChannelId: ChannelId },
): ChatSyncIndexPayload => ({
	provider: connection.provider,
	externalWorkspaceId: connection.externalWorkspaceId,
	externalChannelId: link?.externalChannelId ?? null,
	organizationId: connection.organizationId,
	channelId: link?.hazelChannelId ?? null,
})

/** Index (or unindex, `deleted`) a connection, or one of its links, in the directory. */
export const indexChatSync = (
	connection: {
		readonly provider: string
		readonly externalWorkspaceId: string
		readonly organizationId: OrganizationId
	},
	options: {
		readonly link?: { readonly externalChannelId: string; readonly hazelChannelId: ChannelId }
		readonly deleted: boolean
	},
) =>
	enqueueEffect(
		options.deleted
			? ChatSyncDirectoryEffects.deleteChatSyncIndex
			: ChatSyncDirectoryEffects.upsertChatSyncIndex,
		{ kind: "directory" },
		indexRow(connection, options.link),
	)

/** The active link for an external channel in one of the event's workspaces, with its connection. */
const findInboundLink = (
	provider: string,
	externalChannelId: ExternalChannelId,
	externalWorkspaceIds: ReadonlyArray<string> | undefined,
) =>
	Effect.flatMap(Database.Database, (db) =>
		db.first(
			SQLite.from(schema.chatSyncChannelLinksTable, "link")
				.innerJoin(schema.chatSyncConnectionsTable, "connection", (link, connection) =>
					connection.id.eq(link.syncConnectionId),
				)
				.select(($) => ({
					id: $.id,
					syncConnectionId: $.syncConnectionId,
					hazelChannelId: $.hazelChannelId,
					direction: $.direction,
					isActive: $.isActive,
					settings: $.settings,
					createdAt: $.createdAt,
					organizationId: $.connection.organizationId,
					externalWorkspaceId: $.connection.externalWorkspaceId,
					status: $.connection.status,
				}))
				.where(($) => [
					$.externalChannelId.eq(externalChannelId),
					$.deletedAt.isNull(),
					$.connection.provider.eq(provider),
					$.connection.deletedAt.isNull(),
					...(externalWorkspaceIds === undefined
						? []
						: // An event naming no workspace ("" matches none) reaches no link.
							[$.connection.externalWorkspaceId.in_(...externalWorkspaceIds, "")]),
				])
				.limit(1),
		),
	)

type InboundLink = Option.Option.Value<Effect.Success<ReturnType<typeof findInboundLink>>>

/**
 * What decides for `link`: its direction, whether it is active, and its identity (`settings`).
 * A thread's link takes them from its parent channel's link on the same connection, however the
 * event reached it; `None`: that parent is no longer linked, so the thread does not sync.
 */
const ownerOf = Effect.fn("OrgObject.chatSyncOwnerLink")(function* (link: InboundLink) {
	const db = yield* Database.Database
	const channel = yield* db.first(
		SQLite.from(schema.channelsTable)
			.select("type", "parentChannelId")
			.where(($) => [$.id.eq(link.hazelChannelId)])
			.limit(1),
	)
	if (Option.isNone(channel) || channel.value.type !== "thread" || channel.value.parentChannelId === null) {
		return Option.some(link)
	}
	const parentChannelId = channel.value.parentChannelId
	const parent = yield* db.first(
		SQLite.from(schema.chatSyncChannelLinksTable)
			.select("isActive", "direction", "settings", "createdAt")
			.where(($) => [
				$.syncConnectionId.eq(link.syncConnectionId),
				$.hazelChannelId.eq(parentChannelId),
				$.deletedAt.isNull(),
			])
			.limit(1),
	)
	return Option.map(
		Option.filter(parent, (owner) => isParentOf(owner, link)),
		({ isActive, direction, settings }) => ({ ...link, isActive, direction, settings }),
	)
})

/**
 * Who the event's author is here: the Hazel user who linked that provider account, else the
 * provider user's shadow (the directory row the gateway upserted), made a member on first sight.
 */
const resolveAuthor = Effect.fn("OrgObject.chatSyncResolveAuthor")(function* (
	provider: string,
	organizationId: OrganizationId,
	author: NonNullable<OrgChatSyncIngestPayload["author"]>,
) {
	const db = yield* Database.Database
	if (author.externalUserId !== null) {
		const linked = yield* db.first(
			SQLite.from(schema.integrationConnectionsTable)
				.select("userId")
				.where(($) => [
					$.provider.eq(provider as never),
					$.level.eq("user"),
					$.status.eq("active"),
					$.externalAccountId.eq(author.externalUserId!),
					$.deletedAt.isNull(),
				])
				.limit(1),
		)
		if (Option.isSome(linked) && linked.value.userId !== null) return linked.value.userId
	}
	const userId: UserId = author.user.id
	yield* upsertUserProjection(author.user)
	const member = yield* db.first(
		SQLite.from(schema.organizationMembersTable)
			.select("id")
			.where(($) => [$.userId.eq(userId), $.deletedAt.isNull()])
			.limit(1),
	)
	if (Option.isNone(member)) {
		const members = yield* OrganizationMemberRepo
		yield* members.upsertByOrgAndUser({
			organizationId,
			userId,
			role: "member",
			nickname: null,
			joinedAt: new Date(),
			invitedBy: null,
			deletedAt: null,
		})
		yield* syncMemberAccess(userId, organizationId)
		yield* Effect.annotateCurrentSpan({ "chat_sync.new_member": userId })
	}
	return userId
})

/** The name of a thread made by a message in it, before the provider names it. */
const UNNAMED_THREAD = "Thread"

/**
 * A provider thread under a linked channel: a Hazel thread, linked the same way. `name: null`: made
 * by a message in it, which can arrive before the thread's own event; that event names it later.
 */
const ingestThreadCreate = Effect.fn("OrgObject.chatSyncThreadCreate")(function* (
	provider: string,
	parent: InboundLink,
	event: {
		readonly externalThreadId: ExternalThreadId
		readonly name: string | null
		readonly externalParentMessageId?: ExternalMessageId | undefined
	},
) {
	const db = yield* Database.Database
	const existing = yield* db.first(
		SQLite.from(schema.chatSyncChannelLinksTable)
			.select("id", "hazelChannelId", "externalChannelName")
			.where(($) => [
				$.syncConnectionId.eq(parent.syncConnectionId),
				$.externalChannelId.eq(event.externalThreadId),
				$.deletedAt.isNull(),
			])
			.limit(1),
	)
	if (Option.isSome(existing)) {
		const name = event.name?.trim()
		if (!name || existing.value.externalChannelName !== null) return "already_linked"
		yield* db.run(
			SQLite.update(schema.chatSyncChannelLinksTable)
				.set({ externalChannelName: name, updatedAt: new Date() })
				.where(($) => [$.id.eq(existing.value.id)]),
		)
		// Keeps a name someone (or thread naming) gave it since.
		yield* renameChannel({
			channelId: existing.value.hazelChannelId,
			name,
			onlyIfName: UNNAMED_THREAD,
		})
		return "named"
	}
	const channels = yield* ChannelRepo
	const [thread] = yield* channels.insert({
		name: event.name?.trim() || UNNAMED_THREAD,
		icon: null,
		type: "thread",
		organizationId: parent.organizationId,
		parentChannelId: parent.hazelChannelId,
		sectionId: null,
		deletedAt: null,
	})
	yield* syncChannelAccess(thread!.id)
	yield* db.run(
		SQLite.insertInto(schema.chatSyncChannelLinksTable).values({
			syncConnectionId: parent.syncConnectionId,
			hazelChannelId: thread!.id,
			externalChannelId: event.externalThreadId,
			externalChannelName: event.name?.trim() || null,
			direction: parent.direction,
			isActive: true,
			// Read from the parent's link (`channelTargets`).
			settings: null,
			lastSyncedAt: null,
			deletedAt: null,
		}),
	)
	yield* indexChatSync(
		{ provider, externalWorkspaceId: parent.externalWorkspaceId, organizationId: parent.organizationId },
		{ link: { externalChannelId: event.externalThreadId, hazelChannelId: thread!.id }, deleted: false },
	)
	yield* publishChatSyncLinks(thread!.id)
	// Started on a synced message: hang the thread off it in the parent, like a Hazel thread.
	if (event.externalParentMessageId !== undefined) {
		yield* enqueueEffect(
			ChatSyncChannelEffects.chatSyncAttachThread,
			channelTarget(parent.hazelChannelId),
			{
				channelLinkId: parent.id,
				externalMessageId: event.externalParentMessageId,
				threadChannelId: thread!.id,
				externalThreadId: event.externalThreadId,
			},
		)
	}
	return "created"
})

/**
 * The link an event applies to: its channel's, or, for a reply in a provider thread that lives in
 * its channel (Slack), the thread's. A reply in a thread Hazel has not seen yet makes the thread
 * first, hung off the message it replies to. `None`: an edit or delete in an unlinked thread.
 */
const replyThreadLink = Effect.fn("OrgObject.chatSyncReplyThread")(function* (
	definition: ChatSyncProviderDefinition,
	payload: OrgChatSyncIngestPayload,
	channel: InboundLink,
) {
	const { event } = payload
	if (!("inExternalThreadId" in event) || event.inExternalThreadId === undefined)
		return Option.some(channel)
	const threadChannelId = definition.threadChannelId(
		payload.externalChannelId,
		event.inExternalThreadId,
	) as ExternalChannelId
	yield* Effect.annotateCurrentSpan({ "chat_sync.external_thread_id": threadChannelId })
	const existing = yield* findInboundLink(payload.provider, threadChannelId, payload.externalWorkspaceIds)
	if (Option.isSome(existing) || event._tag !== "MessageCreate") return existing
	if (channel.status !== "active" || !channel.isActive || channel.direction === "hazel_to_external") {
		return Option.some(channel)
	}
	yield* ingestThreadCreate(payload.provider, channel, {
		externalThreadId: ExternalThreadId.make(threadChannelId),
		name: event.externalThreadName ?? null,
		externalParentMessageId: ExternalMessageId.make(event.inExternalThreadId),
	})
	return yield* findInboundLink(payload.provider, threadChannelId, payload.externalWorkspaceIds)
})

/**
 * Inbound text as Hazel content. Hazel's own mention syntax typed on the provider side is
 * defused first (a provider user must not mention or broadcast to Hazel users by writing
 * `@[userId:…]`); then provider mentions become `@[userId:…]`: the Hazel user who linked that
 * account, else the provider user's shadow when this org knows them, else `@Name`.
 */
const toHazelContent = Effect.fn("OrgObject.chatSyncContent")(function* (
	definition: ChatSyncProviderDefinition,
	raw: string,
	mentions: ReadonlyArray<ChatSyncMention>,
) {
	const content = raw.replaceAll("@[", "@\u200B[")
	const pattern = new RegExp(definition.mentionPattern.source, "g")
	const externalIds = [...new Set([...content.matchAll(pattern)].map((match) => match[1]!))]
	if (externalIds.length === 0) return content
	const db = yield* Database.Database
	const linked = yield* db.run(
		SQLite.from(schema.integrationConnectionsTable)
			.select("userId", "externalAccountId")
			.where(($) => [
				$.provider.eq(definition.id as never),
				$.level.eq("user"),
				$.status.eq("active"),
				$.deletedAt.isNull(),
				$.externalAccountId.in_(...externalIds),
			]),
	)
	const shadowIdOf = (externalId: string) => `${definition.id}-user-${externalId}`
	const shadows = yield* db.run(
		SQLite.from(schema.usersTable)
			.select("id", "externalId")
			.where(($) => [$.externalId.in_(...externalIds.map(shadowIdOf))]),
	)
	const users = new Map<string, UserId>()
	for (const row of shadows) users.set(row.externalId.slice(shadowIdOf("").length), row.id)
	for (const row of linked)
		if (row.userId !== null && row.externalAccountId) users.set(row.externalAccountId, row.userId)
	const names = new Map(
		mentions.map((mention) => [
			mention.externalUserId as string,
			mention.displayName.replace(/[[\]]/g, ""),
		]),
	)
	return content.replace(pattern, (match, externalId: string) => {
		const userId = users.get(externalId)
		if (userId !== undefined) return `@[userId:${userId}]`
		const name = names.get(externalId as ExternalUserId)
		return name ? `@${name}` : match
	})
})

const ingest = Effect.fn("OrgObject.chatSyncIngest")(function* (payload: OrgChatSyncIngestPayload) {
	const { event, provider } = payload
	yield* Effect.annotateCurrentSpan({
		"chat_sync.provider": provider,
		"chat_sync.event": event._tag,
		"chat_sync.external_channel_id": payload.externalChannelId,
	})
	const outcome = (value: string) => Effect.annotateCurrentSpan({ "chat_sync.outcome": value })
	const definition = definitionOf(provider)
	if (Option.isNone(definition)) return yield* outcome("unknown_provider")
	const found = yield* findInboundLink(provider, payload.externalChannelId, payload.externalWorkspaceIds)
	if (Option.isNone(found)) return yield* outcome("unlinked")
	const resolved = yield* replyThreadLink(definition.value, payload, found.value)
	if (Option.isNone(resolved)) return yield* outcome("unlinked_thread")
	const link = resolved.value
	const owned = yield* ownerOf(link)
	if (Option.isNone(owned)) return yield* outcome("unlinked_parent")
	const owner = owned.value
	if (link.status !== "active" || !link.isActive || !owner.isActive) return yield* outcome("inactive")
	if (owner.direction === "hazel_to_external") return yield* outcome("outbound_only")
	if ("externalWebhookId" in event && definition.value.isOwnEcho(owner.settings, event.externalWebhookId)) {
		return yield* outcome("own_webhook")
	}
	if (event._tag === "ThreadCreate") return yield* outcome(yield* ingestThreadCreate(provider, link, event))

	const authorId =
		payload.author === null
			? undefined
			: yield* resolveAuthor(provider, link.organizationId, payload.author)
	let forwarded: ChannelIngestEvent
	switch (event._tag) {
		case "MessageCreate":
			if (authorId === undefined) return yield* outcome("no_author")
			if (payload.author !== null && payload.author.externalUserId !== null) {
				yield* recordChannelAuthor({
					provider,
					hazelChannelId: link.hazelChannelId,
					externalUserId: payload.author.externalUserId,
					email: payload.author.email,
					externalWorkspaceId: payload.author.externalWorkspaceId,
				}).pipe(
					// Evidence for suggested customer links only: the message is ingested regardless.
					Effect.catchTags({
						DatabaseError: (error) =>
							Effect.logWarning("Chat sync author not recorded", {
								provider,
								reason: error.message,
							}),
					}),
				)
			}
			forwarded = {
				_tag: "MessageCreate",
				externalMessageId: event.externalMessageId,
				content: yield* toHazelContent(definition.value, event.content, event.mentions ?? []),
				authorId,
				externalReplyToMessageId: event.externalReplyToMessageId,
				attachments: event.attachments,
				sentAt: event.sentAt,
			}
			break
		case "MessageUpdate":
			forwarded = {
				_tag: "MessageUpdate",
				externalMessageId: event.externalMessageId,
				content: yield* toHazelContent(definition.value, event.content, event.mentions ?? []),
			}
			break
		case "MessageDelete":
			forwarded = { _tag: "MessageDelete", externalMessageId: event.externalMessageId }
			break
		case "ReactionAdd":
		case "ReactionRemove":
			if (authorId === undefined) return yield* outcome("no_author")
			forwarded = {
				_tag: event._tag,
				externalMessageId: event.externalMessageId,
				userId: authorId,
				emoji: definition.value.emojiFromProvider(event.emoji),
			}
			break
	}
	yield* enqueueEffect(ChatSyncChannelEffects.chatSyncIngest, channelTarget(link.hazelChannelId), {
		organizationId: link.organizationId,
		channelId: link.hazelChannelId,
		syncConnectionId: link.syncConnectionId,
		channelLinkId: link.id,
		dedupeKey: payload.dedupeKey,
		event: forwarded,
	})
	const db = yield* Database.Database
	const now = new Date()
	yield* db.run(
		SQLite.update(schema.chatSyncChannelLinksTable)
			.set({ lastSyncedAt: now })
			.where(($) => [$.id.eq(link.id)]),
	)
	yield* db.run(
		SQLite.update(schema.chatSyncConnectionsTable)
			.set({ lastSyncedAt: now })
			.where(($) => [$.id.eq(link.syncConnectionId)]),
	)
	yield* outcome("forwarded")
})

/** What a link's threads read of its settings: the identity they post as. */
const threadFacingSettings = (settings: Record<string, unknown> | null) =>
	JSON.stringify([
		settings?.outboundIdentity ?? null,
		(settings?.webhookPermission as { status?: unknown } | undefined)?.status ?? null,
	])

const linkSettings = Effect.fn("OrgObject.chatSyncLinkSettings")(function* (payload: LinkSettingsPayload) {
	const db = yield* Database.Database
	const previous = yield* db.first(
		SQLite.from(schema.chatSyncChannelLinksTable)
			.select("hazelChannelId", "settings")
			.where(($) => [$.id.eq(payload.channelLinkId), $.deletedAt.isNull()])
			.limit(1),
	)
	if (Option.isNone(previous)) return
	yield* db.run(
		SQLite.update(schema.chatSyncChannelLinksTable)
			.set({ settings: payload.settings, updatedAt: new Date() })
			.where(($) => [$.id.eq(payload.channelLinkId)]),
	)
	const { hazelChannelId } = previous.value
	// A refreshed permission check alone does not wake every thread under the channel.
	if (threadFacingSettings(previous.value.settings) === threadFacingSettings(payload.settings)) {
		yield* publishLinksOf(hazelChannelId)
	} else {
		yield* publishChatSyncLinks(hazelChannelId)
	}
})

/** `org.chatSyncRepublishLinks`: a channel asked for a fresh copy of its links. */
const republishLinks = Effect.fn("OrgObject.chatSyncRepublishLinks")(function* (
	payload: RepublishLinksPayload,
) {
	const db = yield* Database.Database
	const link = yield* db.first(
		SQLite.from(schema.chatSyncChannelLinksTable)
			.select("hazelChannelId")
			.where(($) => [$.id.eq(payload.channelLinkId)])
			.limit(1),
	)
	if (Option.isSome(link)) yield* publishLinksOf(link.value.hazelChannelId)
})

/**
 * A Hazel thread was mirrored as a provider thread (`chat-sync-outbound.ts`, `ThreadCreate`):
 * link it like its parent. Only the parent's `ChannelObject` may send it, for one of its threads.
 */
const linkThread = Effect.fn("OrgObject.chatSyncLinkThread")(function* (payload: LinkThreadPayload) {
	const db = yield* Database.Database
	const outcome = (value: string) => Effect.annotateCurrentSpan({ "chat_sync.outcome": value })
	yield* Effect.annotateCurrentSpan({
		"chat_sync.link_id": payload.channelLinkId,
		"channel.id": payload.threadChannelId,
	})
	const found = yield* db.first(
		SQLite.from(schema.chatSyncChannelLinksTable, "link")
			.innerJoin(schema.chatSyncConnectionsTable, "connection", (link, connection) =>
				connection.id.eq(link.syncConnectionId),
			)
			.select(($) => ({
				syncConnectionId: $.syncConnectionId,
				hazelChannelId: $.hazelChannelId,
				direction: $.direction,
				settings: $.settings,
				organizationId: $.connection.organizationId,
				externalWorkspaceId: $.connection.externalWorkspaceId,
				provider: $.connection.provider,
			}))
			.where(($) => [
				$.id.eq(payload.channelLinkId),
				$.deletedAt.isNull(),
				$.connection.deletedAt.isNull(),
			])
			.limit(1),
	)
	if (Option.isNone(found)) return yield* outcome("parent_link_gone")
	const parent = found.value
	const sender = yield* Effect.serviceOption(CurrentEffectSender)
	if (
		Option.isNone(sender) ||
		sender.value.kind !== "channel" ||
		sender.value.id !== parent.hazelChannelId
	) {
		yield* Effect.logWarning("chatSyncLinkThread refused: not the parent channel", {
			sender: Option.getOrNull(sender),
			parentChannelId: parent.hazelChannelId,
		})
		return yield* outcome("refused_sender")
	}
	const thread = yield* db.first(
		SQLite.from(schema.channelsTable)
			.select("id")
			.where(($) => [
				$.id.eq(payload.threadChannelId),
				$.parentChannelId.eq(parent.hazelChannelId),
				$.type.eq("thread"),
				$.deletedAt.isNull(),
			])
			.limit(1),
	)
	if (Option.isNone(thread)) return yield* outcome("not_a_thread")
	const existing = yield* db.first(
		SQLite.from(schema.chatSyncChannelLinksTable)
			.select("id")
			.where(($) => [
				$.syncConnectionId.eq(parent.syncConnectionId),
				SQLite.or(
					$.externalChannelId.eq(payload.externalThreadId),
					$.hazelChannelId.eq(payload.threadChannelId),
				),
				$.deletedAt.isNull(),
			])
			.limit(1),
	)
	if (Option.isSome(existing)) return yield* outcome("already_linked")
	yield* db.run(
		SQLite.insertInto(schema.chatSyncChannelLinksTable).values({
			syncConnectionId: parent.syncConnectionId,
			hazelChannelId: payload.threadChannelId,
			externalChannelId: payload.externalThreadId,
			externalChannelName: payload.externalThreadName,
			direction: parent.direction,
			isActive: true,
			// Read from the parent's link (`channelTargets`).
			settings: null,
			lastSyncedAt: null,
			deletedAt: null,
		}),
	)
	yield* indexChatSync(
		{
			provider: parent.provider,
			externalWorkspaceId: parent.externalWorkspaceId,
			organizationId: parent.organizationId,
		},
		{
			link: { externalChannelId: payload.externalThreadId, hazelChannelId: payload.threadChannelId },
			deleted: false,
		},
	)
	yield* publishChatSyncLinks(payload.threadChannelId)
	yield* outcome("linked")
})

/**
 * A provider account was linked to (or unlinked from) `toAuthorId`/`fromAuthorId`: move the
 * provider-synced messages of every linked channel (each `ChannelObject` holds its own).
 */
export const reattributeProviderMessages = Effect.fn("OrgObject.chatSyncReattribute")(function* (params: {
	readonly provider: string
	readonly fromAuthorId: UserId
	readonly toAuthorId: UserId
}) {
	if (params.fromAuthorId === params.toAuthorId) return 0
	const db = yield* Database.Database
	const links = yield* db.run(
		SQLite.from(schema.chatSyncChannelLinksTable, "link")
			.innerJoin(schema.chatSyncConnectionsTable, "connection", (link, connection) =>
				connection.id.eq(link.syncConnectionId),
			)
			.select(($) => ({ id: $.id, hazelChannelId: $.hazelChannelId }))
			.where(($) => [$.connection.provider.eq(params.provider), $.connection.deletedAt.isNull()]),
	)
	const byChannel = new Map<ChannelId, Array<SyncChannelLinkId>>()
	for (const link of links)
		byChannel.set(link.hazelChannelId, [...(byChannel.get(link.hazelChannelId) ?? []), link.id])
	yield* Effect.forEach(
		byChannel,
		([channelId, channelLinkIds]) =>
			enqueueEffect(ChatSyncChannelEffects.chatSyncReassignAuthors, channelTarget(channelId), {
				channelLinkIds,
				fromAuthorId: params.fromAuthorId,
				toAuthorId: params.toAuthorId,
			}),
		{ discard: true },
	)
	return byChannel.size
})

const orgServices = Layer.mergeAll(
	ChannelRepo.layer,
	OrganizationMemberRepo.layer,
	ChannelAccessSyncService.layer,
)

/**
 * `org.chatSyncIngest` applied in this org by its own outbox (imported history): once per dedupe
 * key, in one transaction with its inbox row, as `applyEffect` would.
 */
export const ingestChatSyncHere = (payload: OrgChatSyncIngestPayload) =>
	Effect.flatMap(Database.Database, (db) =>
		db.transaction(withInbox(payload.dedupeKey, ingest(payload).pipe(Effect.provide(orgServices)))),
	).pipe(Effect.asVoid)

export const chatSyncOrgReceivers = {
	"org.chatSyncIngest": (payload) => ingest(payload).pipe(Effect.provide(orgServices)),
	"org.chatSyncLinkSettings": linkSettings,
	"org.chatSyncLinkThread": linkThread,
	"org.chatSyncRepublishLinks": republishLinks,
} satisfies EffectReceivers<typeof ChatSyncOrgEffects, Database.Database | SqlClient>
