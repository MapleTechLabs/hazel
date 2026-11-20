/**
 * Importing a new link's past messages (`chatSync.importHistory`), in the org's outbox. Each
 * delivery fetches one page from the provider (newest page first), ingests it oldest first exactly
 * as live events are (`ingestChatSyncHere`: the same link, author and dedupe rules), then enqueues
 * the next, older page after the provider's pause. A provider that answers 429 or 5xx fails the
 * delivery, and the outbox backs off and retries the same page; dedupe makes a retry safe.
 *
 * Imported messages keep their provider send time (`sentAt`) and notify nobody.
 */
import { Database, SQLite, schema } from "@hazel/db"
import { Effect, Option } from "effect"
import type { SqlClient } from "effect/sql/SqlClient"
import type { EffectReceivers } from "../../worker/objects/effects/registry"
import { enqueueEffect } from "../../worker/objects/effects/registry"
import type { Directory } from "../directory"
import {
	ChatSyncHistoryEffects,
	type ImportHistoryPayload,
	type OrgChatSyncIngestPayload,
} from "./chat-sync-effects"
import { type ChatSyncInbound, orgIngestPayloadOf } from "./chat-sync-inbound"
import { ingestChatSyncHere } from "./chat-sync-org"
import { ChatSyncProviders } from "./chat-sync-providers"
import { ChatSyncProviderApiError, isRetryableStatus } from "./provider"

const isRetryable = (error: unknown) =>
	error instanceof Database.DatabaseError ||
	(error instanceof ChatSyncProviderApiError && isRetryableStatus(error.status))

/** Whether the org still has a link to the external channel (removing it stops the import). */
const isStillLinked = (payload: ImportHistoryPayload) =>
	Effect.flatMap(Database.Database, (db) =>
		db.first(
			SQLite.from(schema.chatSyncChannelLinksTable, "link")
				.innerJoin(schema.chatSyncConnectionsTable, "connection", (link, connection) =>
					connection.id.eq(link.syncConnectionId),
				)
				.select(($) => ({ id: $.id }))
				.where(($) => [
					$.externalChannelId.eq(payload.externalChannelId),
					$.deletedAt.isNull(),
					$.connection.provider.eq(payload.provider),
					$.connection.externalWorkspaceId.eq(payload.externalWorkspaceId),
					$.connection.deletedAt.isNull(),
				])
				.limit(1),
		),
	).pipe(Effect.map(Option.isSome))

/**
 * The org payloads of a page, each distinct author upserted into the directory once and a few at a
 * time (a delivery has 10s, and a page is mostly the same few people).
 */
const payloadsOf = (messages: ReadonlyArray<ChatSyncInbound>) =>
	Effect.gen(function* () {
		const keyOf = (inbound: ChatSyncInbound) => inbound.author?.externalUserId ?? ""
		const firstByAuthor = new Map<string, ChatSyncInbound>()
		for (const inbound of messages) {
			if (!firstByAuthor.has(keyOf(inbound))) firstByAuthor.set(keyOf(inbound), inbound)
		}
		const authors = new Map(
			yield* Effect.forEach(
				firstByAuthor,
				([key, inbound]) =>
					Effect.map(orgIngestPayloadOf(inbound), (payload) => [key, payload.author] as const),
				{ concurrency: 4 },
			),
		)
		return messages.map((inbound): OrgChatSyncIngestPayload => ({
			provider: inbound.provider,
			externalChannelId: inbound.externalChannelId,
			externalWorkspaceIds: inbound.externalWorkspaceIds,
			dedupeKey: inbound.dedupeKey,
			author: authors.get(keyOf(inbound)) ?? null,
			event: inbound.event,
		}))
	})

/**
 * A page (oldest first) without what was sent before `since`: an older top-level message goes with
 * the thread replies right after it (a reply never lands on a parent Hazel does not have).
 * `reachedCutoff`: the page went past `since`, so no older page is wanted.
 */
export const withinCutoff = (
	messages: ReadonlyArray<ChatSyncInbound>,
	since: number | null | undefined,
): { readonly messages: ReadonlyArray<ChatSyncInbound>; readonly reachedCutoff: boolean } => {
	if (since === undefined || since === null) return { messages, reachedCutoff: false }
	let reachedCutoff = false
	let droppingThread = false
	const kept: Array<ChatSyncInbound> = []
	for (const inbound of messages) {
		const event = inbound.event
		const isReply = event._tag === "MessageCreate" && event.inExternalThreadId !== undefined
		const sentAt = event._tag === "MessageCreate" ? event.sentAt : undefined
		if (!isReply) droppingThread = false
		if (sentAt !== undefined && sentAt < since) {
			reachedCutoff = true
			if (!isReply) droppingThread = true
			continue
		}
		if (isReply && droppingThread) continue
		kept.push(inbound)
	}
	return { messages: kept, reachedCutoff }
}

/** A migration's next channel, once this one is done (finished, unlinked, or failed for good). */
const importNext = (payload: ImportHistoryPayload, delayMs: number) => {
	const [next, ...rest] = payload.then ?? []
	if (next === undefined) return Effect.void
	return enqueueEffect(
		ChatSyncHistoryEffects.importHistory,
		{ kind: "chat-sync" },
		{
			provider: payload.provider,
			externalWorkspaceId: payload.externalWorkspaceId,
			externalChannelId: next,
			remaining: payload.budget ?? payload.remaining,
			cursor: null,
			since: payload.since ?? null,
			then: rest,
			budget: payload.budget ?? payload.remaining,
		},
		{ delayMs },
	)
}

export const importChatSyncHistory = Effect.fn("ChatSync.importHistory")(function* (
	payload: ImportHistoryPayload,
) {
	const { definition } = yield* (yield* ChatSyncProviders).get(payload.provider)
	const done = importNext(payload, definition.history.pageDelayMs)
	yield* Effect.annotateCurrentSpan({
		"chat_sync.provider": payload.provider,
		"chat_sync.external_channel_id": payload.externalChannelId,
		"chat_sync.history.remaining": payload.remaining,
		"chat_sync.history.first_page": payload.cursor === null,
	})
	if (payload.remaining <= 0) return yield* done
	if (!(yield* isStillLinked(payload))) {
		yield* Effect.annotateCurrentSpan({ "chat_sync.outcome": "unlinked" })
		return yield* done
	}
	const { client } = yield* (yield* ChatSyncProviders).get(payload.provider)
	const target = {
		externalWorkspaceId: payload.externalWorkspaceId,
		externalChannelId: payload.externalChannelId,
	}
	// What the page asks for counts against `remaining`, however much of it is skipped (bots, joins).
	const limit = Math.min(payload.remaining, definition.history.pageSize)
	const page = yield* Effect.gen(function* () {
		// Slack reads only channels the bot is in: join first (`chatSync.prepareLink` may not have run yet).
		if (payload.cursor === null) yield* client.prepareLink(target)
		return yield* client.fetchHistory({
			...target,
			cursor: payload.cursor,
			limit,
		})
	}).pipe(
		Effect.map(Option.some),
		Effect.catch((error) =>
			isRetryable(error)
				? Effect.fail(error)
				: Effect.logWarning("Chat sync history could not be imported", {
						provider: payload.provider,
						externalChannelId: payload.externalChannelId,
						error: error.message,
					}).pipe(Effect.as(Option.none())),
		),
	)
	if (Option.isNone(page)) {
		yield* Effect.annotateCurrentSpan({ "chat_sync.outcome": "failed" })
		return yield* done
	}

	// Thread replies count too: a page never imports more than what is left of the budget (the last
	// parent's replies are cut short when they would cross it).
	const window = withinCutoff(page.value.messages, payload.since)
	const budgeted = window.messages.slice(0, payload.remaining)
	const payloads = yield* payloadsOf(budgeted)
	yield* Effect.forEach(payloads, ingestChatSyncHere, { discard: true })

	const remaining = payload.remaining - Math.max(limit, budgeted.length)
	yield* Effect.annotateCurrentSpan({
		"chat_sync.history.imported": payloads.length,
		"chat_sync.history.reached_cutoff": window.reachedCutoff,
		"chat_sync.outcome": "imported",
	})
	if (page.value.cursor === null || remaining <= 0 || window.reachedCutoff) return yield* done
	yield* enqueueEffect(
		ChatSyncHistoryEffects.importHistory,
		{ kind: "chat-sync" },
		{ ...payload, remaining, cursor: page.value.cursor },
		{ delayMs: definition.history.pageDelayMs },
	)
})

export const chatSyncHistoryReceivers = {
	"chatSync.importHistory": importChatSyncHistory,
} satisfies EffectReceivers<
	typeof ChatSyncHistoryEffects,
	Database.Database | SqlClient | ChatSyncProviders | Directory
>
