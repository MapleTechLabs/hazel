/**
 * Who writes in the org's channels linked to customers, on the `OrgObject` side
 * (`docs/customers/author-side.md`). The org knows its members, the `users` projection (chat-sync
 * shadows and bots included), installed bots and Connect participants, so it is where an author's
 * facts are known; `classifyAuthor` (`@hazel/domain/customers`) turns them and a member's override
 * into a side.
 *
 * - `customer_chat_authors`: each author seen in a linked channel, their side and why, the override.
 * - Each message created in a linked channel or one of its threads (`org.messageCreated`) is passed
 *   on to the org's `CustomersObject` as `customers.chatMessage`, its author classified.
 * - A channel seen linked for the first time is asked for its past authors (`channel.reportChatAuthors`,
 *   and each of its threads); the answers go on as `customers.chatAuthorsBackfill`.
 */
import { Database, SQLite, schema } from "@hazel/db"
import {
	type AuthorFacts,
	type AuthorSideOverride,
	classifyAuthor,
	type ExternalWorkspace,
	shadowEmailOf,
	shadowProviderOf,
} from "@hazel/domain/customers"
import type { ChannelId, MessageId, OrganizationId, UserId } from "@hazel/schema"
import { EMAIL_CHAT_SYNC_PROVIDER } from "@hazel/domain/rpc"
import { Clock, Effect, Option } from "effect"
import {
	type ChatAuthorsReportedPayload,
	type ChatAuthorWire,
	CustomerChatChannelEffects,
	CustomerChatEffects,
} from "../customer-chat-wire"
import { enqueueEffect, type EffectSender } from "../effects/registry"
import { channelTarget, customersTarget } from "../kinds"
import { deleteObjectMeta, readObjectMeta, writeObjectMeta } from "../meta"
import { isCustomersEnabled } from "./customers-enabled"

/** At most this many threads of a channel are asked for their authors. */
const BACKFILL_THREADS_MAX = 500
/** Authors per `customers.chatAuthorsBackfill`. */
const BACKFILL_CHUNK = 200

/** What the org knows about `userId`, before any override. */
export const authorFactsOf = Effect.fn("OrgObject.authorFactsOf")(function* (
	organizationId: OrganizationId,
	userId: UserId,
) {
	const db = yield* Database.Database
	const bot = yield* db.first(
		SQLite.from(schema.botsTable)
			.select("id")
			.where(($) => [$.userId.eq(userId)])
			.limit(1),
	)
	if (Option.isSome(bot)) return { _tag: "Bot" } satisfies AuthorFacts
	const user = yield* db.first(
		SQLite.from(schema.usersTable)
			.select("externalId", "userType")
			.where(($) => [$.id.eq(userId)])
			.limit(1),
	)
	if (Option.isSome(user)) {
		// Chat-sync shadows are machine users made members on first sight: they come first.
		const provider = shadowProviderOf(user.value.externalId)
		if (provider !== null) {
			const known = yield* db.first(
				SQLite.from(schema.customerChatAuthorsTable)
					.select("externalWorkspace")
					.where(($) => [$.userId.eq(userId)])
					.limit(1),
			)
			return {
				_tag: "External",
				provider,
				workspace: Option.match(known, {
					onNone: () => null,
					onSome: (row) => row.externalWorkspace,
				}),
			} satisfies AuthorFacts
		}
		if (user.value.userType === "machine") return { _tag: "Bot" } satisfies AuthorFacts
	}
	const memberships = yield* db.run(
		SQLite.from(schema.organizationMembersTable)
			.select("deletedAt")
			.where(($) => [$.organizationId.eq(organizationId), $.userId.eq(userId)]),
	)
	if (memberships.some((row) => row.deletedAt === null)) return { _tag: "Member" } satisfies AuthorFacts
	// Someone who left and now writes from another org in a Connect channel is that org's.
	const participant = yield* db.first(
		SQLite.from(schema.connectParticipantsTable)
			.select("homeOrganizationId")
			.where(($) => [
				$.userId.eq(userId),
				$.homeOrganizationId.neq(organizationId),
				$.deletedAt.isNull(),
			])
			.limit(1),
	)
	if (Option.isSome(participant)) {
		return {
			_tag: "ConnectGuest",
			homeOrganizationId: participant.value.homeOrganizationId,
		} satisfies AuthorFacts
	}
	if (memberships.length > 0) return { _tag: "FormerMember" } satisfies AuthorFacts
	return { _tag: "Unknown" } satisfies AuthorFacts
})

/**
 * Classify `userId` and keep `customer_chat_authors` in step (written only when it changed).
 * Answers the author as it crosses to the customers object.
 */
export const classifyChatAuthor = Effect.fn("OrgObject.classifyChatAuthor")(function* (
	organizationId: OrganizationId,
	userId: UserId,
) {
	const db = yield* Database.Database
	const facts = yield* authorFactsOf(organizationId, userId)
	const row = yield* db.first(
		SQLite.from(schema.customerChatAuthorsTable)
			.select("side", "reason", "override")
			.where(($) => [$.userId.eq(userId)])
			.limit(1),
	)
	const override = Option.match(row, { onNone: () => null, onSome: (held) => held.override })
	const { side, reason } = classifyAuthor(facts, override)
	if (Option.isNone(row) || row.value.side !== side || row.value.reason !== reason) {
		const now = new Date(yield* Clock.currentTimeMillis)
		yield* db.run(
			SQLite.insertInto(schema.customerChatAuthorsTable)
				.values({ userId, organizationId, side, reason, updatedAt: now })
				.onConflictDoUpdate({ target: ["userId"], set: { side, reason, updatedAt: now } }),
		)
	}
	yield* Effect.annotateCurrentSpan({ "customer_chat.side": side, "customer_chat.reason": reason })
	const user = yield* db.first(
		SQLite.from(schema.usersTable)
			.select("firstName", "lastName", "avatarUrl", "email", "externalId")
			.where(($) => [$.id.eq(userId)])
			.limit(1),
	)
	return Option.match(user, {
		onNone: () => ({ userId, side, reason, name: "Unknown", avatarUrl: null, email: null }),
		onSome: (found) => ({
			userId,
			side,
			reason,
			name: `${found.firstName} ${found.lastName}`.trim() || "Unknown",
			avatarUrl: found.avatarUrl === "" ? null : found.avatarUrl,
			// An email author's address is their shadow's id; other shadows have none.
			email:
				shadowEmailOf(found.externalId) ??
				(shadowProviderOf(found.externalId) !== null || found.email.endsWith(".internal")
					? null
					: found.email),
		}),
	}) satisfies ChatAuthorWire
})

/** The customer of a linked channel. */
const linkOf = (channelId: ChannelId) =>
	Effect.flatMap(Database.Database, (db) =>
		db.first(
			SQLite.from(schema.channelCustomersTable)
				.select("accountId")
				.where(($) => [$.channelId.eq(channelId)])
				.limit(1),
		),
	)

/** The linked channel `channelId` belongs to: itself, or a thread's parent, when linked. */
export const linkedChannelOf = Effect.fn("OrgObject.linkedChannelOf")(function* (channelId: ChannelId) {
	const db = yield* Database.Database
	const channel = yield* db.first(
		SQLite.from(schema.channelsTable)
			.select("parentChannelId")
			.where(($) => [$.id.eq(channelId)])
			.limit(1),
	)
	const linkedChannelId = Option.match(channel, {
		onNone: () => channelId,
		onSome: (row) => row.parentChannelId ?? channelId,
	})
	return Option.map(yield* linkOf(linkedChannelId), () => linkedChannelId)
})

const backfillKey = (channelId: ChannelId) => `customerChatBackfill:${channelId}`

/**
 * Ask a linked channel for its past authors, once per link (the key goes when the link does). A
 * Connect guest's mount is skipped: its messages are the host channel's, which only the host org
 * may ask; its authors come in as they write.
 */
export const requestChatAuthorsBackfill = Effect.fn("OrgObject.requestChatAuthorsBackfill")(function* (
	organizationId: OrganizationId,
	channelId: ChannelId,
) {
	if (Option.isSome(yield* readObjectMeta(backfillKey(channelId)))) return
	const requestId = crypto.randomUUID()
	yield* writeObjectMeta(backfillKey(channelId), requestId)
	const db = yield* Database.Database
	const mount = yield* db.first(
		SQLite.from(schema.connectConversationChannelsTable)
			.select("role")
			.where(($) => [$.channelId.eq(channelId), $.isActive.eq(true), $.deletedAt.isNull()])
			.limit(1),
	)
	if (Option.isSome(mount) && mount.value.role === "guest") return
	// The channel and its threads, from the org's own rows: a thread outlives its deleted root message.
	const threads = yield* db.run(
		SQLite.from(schema.channelsTable)
			.select("id", "createdAt")
			.where(($) => [$.parentChannelId.eq(channelId), $.deletedAt.isNull()])
			.orderBy(["createdAt", "desc"])
			.limit(BACKFILL_THREADS_MAX),
	)
	yield* Effect.annotateCurrentSpan({ "customer_chat.threads": threads.length })
	yield* Effect.forEach(
		[channelId, ...threads.map((thread) => thread.id)],
		(target) =>
			enqueueEffect(
				CustomerChatChannelEffects.reportChatAuthors,
				channelTarget(target),
				{ organizationId, linkedChannelId: channelId, requestId },
				{ id: `customer-chat-backfill:${requestId}:${target}` },
			),
		{ discard: true },
	)
})

/** A link gone: a later link of the channel asks again. */
export const forgetChatAuthorsBackfill = (channelId: ChannelId) => deleteObjectMeta(backfillKey(channelId))

/** What a message carries of its text: a support issue's title comes from it. */
const SUPPORT_CONTENT_MAX = 500

/** Whether `channelId` is a support inbox: an email mailbox's channel (`docs/customers/email.md`). */
const isEmailInbox = (channelId: ChannelId) =>
	Effect.flatMap(Database.Database, (db) =>
		db.first(
			SQLite.from(schema.chatSyncChannelLinksTable, "link")
				.innerJoin(schema.chatSyncConnectionsTable, "connection", (link, connection) =>
					connection.id.eq(link.syncConnectionId),
				)
				.select(($) => ({ id: $.id }))
				.where(($) => [
					$.hazelChannelId.eq(channelId),
					$.deletedAt.isNull(),
					$.connection.provider.eq(EMAIL_CHAT_SYNC_PROVIDER),
					$.connection.deletedAt.isNull(),
				])
				.limit(1),
		),
	).pipe(Effect.map(Option.isSome))

/**
 * A message in a support inbox's channel (or a conversation's thread in it) goes on to Customers,
 * which matches it to an account (`customers/inbox.ts`). Only once the org uses Customers.
 */
const recordInboxMessage = Effect.fn("OrgObject.recordInboxMessage")(function* (
	channel: { readonly id: ChannelId; readonly organizationId: OrganizationId },
	inboxChannelId: ChannelId,
	message: {
		readonly messageId: MessageId
		readonly authorId: UserId
		readonly createdAt?: string
		readonly threadRootMessageId?: MessageId | null
		readonly content?: string
	},
) {
	if (!(yield* isCustomersEnabled) || !(yield* isEmailInbox(inboxChannelId))) return
	const author = yield* classifyChatAuthor(channel.organizationId, message.authorId)
	const createdAt = message.createdAt ?? new Date(yield* Clock.currentTimeMillis).toISOString()
	yield* enqueueEffect(
		CustomerChatEffects.inboxMessage,
		customersTarget(channel.organizationId),
		{
			organizationId: channel.organizationId,
			channelId: inboxChannelId,
			messageChannelId: channel.id,
			messageId: message.messageId,
			createdAt,
			author,
			threadRootMessageId: message.threadRootMessageId ?? null,
			content: Array.from(message.content ?? "")
				.slice(0, SUPPORT_CONTENT_MAX)
				.join(""),
			inbox: "email",
		},
		{ id: `customer-chat:${message.messageId}` },
	)
})

/** From `org.messageCreated`: a message in a linked channel (or a thread of one) goes on to Customers. */
export const recordCustomerChatMessage = Effect.fn("OrgObject.recordCustomerChatMessage")(function* (
	channel: {
		readonly id: ChannelId
		readonly organizationId: OrganizationId
		readonly parentChannelId: ChannelId | null
	},
	message: {
		readonly messageId: MessageId
		readonly authorId: UserId
		readonly createdAt?: string
		readonly threadRootMessageId?: MessageId | null
		readonly content?: string
	},
) {
	const linkedChannelId = channel.parentChannelId ?? channel.id
	const link = yield* linkOf(linkedChannelId)
	if (Option.isNone(link)) return yield* recordInboxMessage(channel, linkedChannelId, message)
	const author = yield* classifyChatAuthor(channel.organizationId, message.authorId)
	const createdAt = message.createdAt ?? new Date(yield* Clock.currentTimeMillis).toISOString()
	yield* enqueueEffect(
		CustomerChatEffects.chatMessage,
		customersTarget(channel.organizationId),
		{
			organizationId: channel.organizationId,
			accountId: link.value.accountId,
			channelId: linkedChannelId,
			messageChannelId: channel.id,
			messageId: message.messageId,
			createdAt,
			author,
			threadRootMessageId: message.threadRootMessageId ?? null,
			content: Array.from(message.content ?? "")
				.slice(0, SUPPORT_CONTENT_MAX)
				.join(""),
		},
		{ id: `customer-chat:${message.messageId}` },
	)
	yield* requestChatAuthorsBackfill(channel.organizationId, linkedChannelId)
})

/**
 * A member marks `userId` as our team or the customer (`null` clears it). The row is reclassified
 * and the customers object told, so its participants follow.
 */
export const setChatAuthorOverride = Effect.fn("OrgObject.setChatAuthorOverride")(function* (input: {
	readonly organizationId: OrganizationId
	readonly userId: UserId
	readonly side: AuthorSideOverride | null
	readonly by: UserId
}) {
	const db = yield* Database.Database
	const now = new Date(yield* Clock.currentTimeMillis)
	const facts = yield* authorFactsOf(input.organizationId, input.userId)
	const { side, reason } = classifyAuthor(facts, input.side)
	const set = {
		side,
		reason,
		override: input.side,
		overrideBy: input.side === null ? null : input.by,
		overrideAt: input.side === null ? null : now,
		updatedAt: now,
	}
	yield* db.run(
		SQLite.insertInto(schema.customerChatAuthorsTable)
			.values({ userId: input.userId, organizationId: input.organizationId, ...set })
			.onConflictDoUpdate({ target: ["userId"], set }),
	)
	yield* enqueueEffect(CustomerChatEffects.chatAuthorChanged, customersTarget(input.organizationId), {
		organizationId: input.organizationId,
		author: yield* classifyChatAuthor(input.organizationId, input.userId),
	})
})

/**
 * From chat sync, for a message in `channelId`: where a Slack author's workspace stands against
 * the org's connected one. Kept only for authors of linked channels; a change of side reaches the
 * customers object.
 */
export const noteExternalWorkspace = Effect.fn("OrgObject.noteExternalWorkspace")(function* (
	organizationId: OrganizationId,
	channelId: ChannelId,
	userId: UserId,
	workspace: ExternalWorkspace,
) {
	const db = yield* Database.Database
	const row = yield* db.first(
		SQLite.from(schema.customerChatAuthorsTable)
			.select("externalWorkspace", "side", "reason")
			.where(($) => [$.userId.eq(userId)])
			.limit(1),
	)
	if (Option.isSome(row) && row.value.externalWorkspace === workspace) return
	if (Option.isNone(row) && Option.isNone(yield* linkedChannelOf(channelId))) return
	const now = new Date(yield* Clock.currentTimeMillis)
	if (Option.isNone(row)) {
		// Placeholder side, set right below from the facts.
		yield* db.run(
			SQLite.insertInto(schema.customerChatAuthorsTable).values({
				userId,
				organizationId,
				side: "unknown",
				reason: "unknown",
				externalWorkspace: workspace,
				updatedAt: now,
			}),
		)
	} else {
		yield* db.run(
			SQLite.update(schema.customerChatAuthorsTable)
				.set({ externalWorkspace: workspace, updatedAt: now })
				.where(($) => [$.userId.eq(userId)]),
		)
	}
	const author = yield* classifyChatAuthor(organizationId, userId)
	if (Option.isSome(row) && (row.value.side !== author.side || row.value.reason !== author.reason)) {
		yield* enqueueEffect(CustomerChatEffects.chatAuthorChanged, customersTarget(organizationId), {
			organizationId,
			author,
		})
	}
})

/** A linked channel's (or thread's) past authors: classified, and passed on to Customers. */
export const chatAuthorsReported = Effect.fn("OrgObject.chatAuthorsReported")(function* (
	payload: ChatAuthorsReportedPayload,
) {
	const db = yield* Database.Database
	const channel = yield* db.first(
		SQLite.from(schema.channelsTable)
			.select("organizationId")
			.where(($) => [$.id.eq(payload.linkedChannelId)])
			.limit(1),
	)
	const link = yield* linkOf(payload.linkedChannelId)
	if (Option.isNone(channel) || Option.isNone(link)) return
	// A report from an earlier link of the channel (delayed across an unlink) is dropped.
	const current = yield* readObjectMeta(backfillKey(payload.linkedChannelId))
	if (Option.getOrUndefined(current) !== payload.requestId) {
		yield* Effect.annotateCurrentSpan({ "customer_chat.stale_report": true })
		return
	}
	const organizationId = channel.value.organizationId
	const authors = yield* Effect.forEach(payload.authors, (reported) =>
		Effect.map(classifyChatAuthor(organizationId, reported.userId), (author) => ({
			author,
			firstMessageAt: reported.firstMessageAt,
			lastMessageAt: reported.lastMessageAt,
		})),
	)
	yield* Effect.annotateCurrentSpan({ "customer_chat.authors": authors.length })
	// In chunks: a busy channel reports up to 1000 authors.
	for (let start = 0; start < authors.length; start += BACKFILL_CHUNK) {
		yield* enqueueEffect(CustomerChatEffects.chatAuthorsBackfill, customersTarget(organizationId), {
			organizationId,
			accountId: link.value.accountId,
			channelId: payload.linkedChannelId,
			authors: authors.slice(start, start + BACKFILL_CHUNK),
		})
	}
})

/**
 * `org.chatAuthorsReported` comes from the linked channel's own object or one of its threads'
 * (a thread's `parentChannelId` is the linked channel).
 */
export const chatAuthorsSenderRefusal = (kind: string, payload: unknown, sender: EffectSender) =>
	Effect.gen(function* () {
		if (kind !== "org.chatAuthorsReported") return Option.none<string>()
		const { linkedChannelId } = payload as ChatAuthorsReportedPayload
		if (sender.kind !== "channel") return Option.some(`${kind} from ${sender.kind}`)
		if (sender.id === linkedChannelId) return Option.none<string>()
		const db = yield* Database.Database
		const thread = yield* db.first(
			SQLite.from(schema.channelsTable)
				.select("parentChannelId")
				.where(($) => [$.id.eq(sender.id as ChannelId)])
				.limit(1),
		)
		return Option.isSome(thread) && thread.value.parentChannelId === linkedChannelId
			? Option.none<string>()
			: Option.some(`${kind} for ${linkedChannelId} from channel ${sender.id}`)
	}).pipe(Effect.orDie)
