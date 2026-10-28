/**
 * Chat sync inside an `OrgObject`: it owns the connections and channel links, the org's members
 * and the users projection, so it decides where an inbound provider event goes and who wrote it.
 *
 * - `org.chatSyncIngest` (from the Discord gateway): find the active link for the external
 *   channel, drop echoes of the link's own webhook, resolve the author (a linked Hazel account,
 *   else the provider user's shadow, made a member here on first sight), then
 *   `channel.chatSyncIngest` to the linked channel. Provider threads become Hazel threads here.
 * - `org.chatSyncLinkSettings` (from a `ChannelObject`): a webhook identity it provisioned.
 * - `publishChatSyncLinks` / `indexChatSync*`: project links to the channel, and keep the
 *   directory's `chat_sync_index` current. Call them wherever a connection or link changes.
 */
import { ChannelRepo, OrganizationMemberRepo } from "@hazel/backend-core"
import { Database, SQLite, schema } from "@hazel/db"
import type { ChannelId, ExternalChannelId, OrganizationId, SyncChannelLinkId, UserId } from "@hazel/schema"
import { Effect, Layer, Option } from "effect"
import type { SqlClient } from "effect/sql/SqlClient"
import { enqueueEffect, type EffectReceivers } from "../../worker/objects/effects/registry"
import { channelTarget } from "../../worker/objects/kinds"
import { syncChannelAccess, syncMemberAccess } from "../../worker/objects/org/channel-access"
import { upsertUserProjection } from "../../worker/objects/org/projections"
import { ChannelAccessSyncService } from "../channel-access-sync"
import {
	type ChannelIngestEvent,
	ChatSyncChannelEffects,
	type ChatSyncChannelTarget,
	ChatSyncDirectoryEffects,
	type ChatSyncIndexPayload,
	type ChatSyncLinkedAccount,
	ChatSyncOrgEffects,
	type LinkSettingsPayload,
	type OrgChatSyncIngestPayload,
} from "./chat-sync-effects"
import { isOwnWebhookOrigin } from "./chat-sync-settings"

/** The channel's active links (on active connections), as its `ChannelObject` keeps them. */
const channelTargets = (channelId: ChannelId) =>
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
					externalChannelId: $.externalChannelId,
					direction: $.direction,
					settings: $.settings,
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
			rows.map(
				(row): ChatSyncChannelTarget => ({
					...row,
					externalChannelId: row.externalChannelId as ExternalChannelId,
				}),
			),
		),
	)

/** The org's users with a linked provider account (Discord mentions). */
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
		return rows.flatMap(
			(row): Array<ChatSyncLinkedAccount> =>
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

/** Project `channelId`'s active links to its `ChannelObject` (outbox, inside the transaction). */
export const publishChatSyncLinks = Effect.fn("OrgObject.publishChatSyncLinks")(function* (
	channelId: ChannelId,
) {
	const links = yield* channelTargets(channelId)
	const accounts = yield* linkedAccounts([...new Set(links.map((link) => link.provider))])
	yield* enqueueEffect(ChatSyncChannelEffects.setChatSyncLinks, channelTarget(channelId), {
		links,
		accounts,
	})
	yield* Effect.annotateCurrentSpan({ "chat_sync.links": links.length })
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

/** The active link for an external channel, with its connection. */
const findInboundLink = (provider: string, externalChannelId: ExternalChannelId) =>
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
					organizationId: $.connection.organizationId,
					externalWorkspaceId: $.connection.externalWorkspaceId,
					status: $.connection.status,
				}))
				.where(($) => [
					$.externalChannelId.eq(externalChannelId),
					$.deletedAt.isNull(),
					$.connection.provider.eq(provider),
					$.connection.deletedAt.isNull(),
				])
				.limit(1),
		),
	)

type InboundLink = Option.Option.Value<Effect.Success<ReturnType<typeof findInboundLink>>>

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

/** A provider thread under a linked channel: a Hazel thread, linked the same way. */
const ingestThreadCreate = Effect.fn("OrgObject.chatSyncThreadCreate")(function* (
	provider: string,
	parent: InboundLink,
	event: { readonly externalThreadId: string; readonly name: string },
) {
	const db = yield* Database.Database
	const existing = yield* db.first(
		SQLite.from(schema.chatSyncChannelLinksTable)
			.select("id")
			.where(($) => [
				$.syncConnectionId.eq(parent.syncConnectionId),
				$.externalChannelId.eq(event.externalThreadId),
				$.deletedAt.isNull(),
			])
			.limit(1),
	)
	if (Option.isSome(existing)) return "already_linked"
	const channels = yield* ChannelRepo
	const [thread] = yield* channels.insert({
		name: event.name.trim() || "Thread",
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
			externalChannelName: event.name,
			direction: parent.direction,
			isActive: true,
			settings: parent.settings,
			lastSyncedAt: null,
			deletedAt: null,
		}),
	)
	yield* indexChatSync(
		{ provider, externalWorkspaceId: parent.externalWorkspaceId, organizationId: parent.organizationId },
		{ link: { externalChannelId: event.externalThreadId, hazelChannelId: thread!.id }, deleted: false },
	)
	yield* publishChatSyncLinks(thread!.id)
	return "created"
})

const ingest = Effect.fn("OrgObject.chatSyncIngest")(function* (payload: OrgChatSyncIngestPayload) {
	const { event, provider } = payload
	yield* Effect.annotateCurrentSpan({
		"chat_sync.provider": provider,
		"chat_sync.event": event._tag,
		"chat_sync.external_channel_id": payload.externalChannelId,
	})
	const outcome = (value: string) => Effect.annotateCurrentSpan({ "chat_sync.outcome": value })
	const found = yield* findInboundLink(provider, payload.externalChannelId)
	if (Option.isNone(found)) return yield* outcome("unlinked")
	const link = found.value
	if (link.status !== "active" || !link.isActive) return yield* outcome("inactive")
	if (link.direction === "hazel_to_external") return yield* outcome("outbound_only")
	if (
		"externalWebhookId" in event &&
		isOwnWebhookOrigin(provider, link.settings, event.externalWebhookId)
	) {
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
			forwarded = {
				_tag: "MessageCreate",
				externalMessageId: event.externalMessageId,
				content: event.content,
				authorId,
				externalReplyToMessageId: event.externalReplyToMessageId,
				attachments: event.attachments,
			}
			break
		case "MessageUpdate":
			forwarded = {
				_tag: "MessageUpdate",
				externalMessageId: event.externalMessageId,
				content: event.content,
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
				emoji: event.emoji,
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

const linkSettings = Effect.fn("OrgObject.chatSyncLinkSettings")(function* (payload: LinkSettingsPayload) {
	const db = yield* Database.Database
	const updated = yield* db.run(
		SQLite.update(schema.chatSyncChannelLinksTable)
			.set({ settings: payload.settings, updatedAt: new Date() })
			.where(($) => [$.id.eq(payload.channelLinkId), $.deletedAt.isNull()])
			.returning("hazelChannelId"),
	)
	const channelId = updated[0]?.hazelChannelId
	if (channelId !== undefined) yield* publishChatSyncLinks(channelId)
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

export const chatSyncOrgReceivers = {
	"org.chatSyncIngest": (payload) => ingest(payload).pipe(Effect.provide(orgServices)),
	"org.chatSyncLinkSettings": linkSettings,
} satisfies EffectReceivers<typeof ChatSyncOrgEffects, Database.Database | SqlClient>
