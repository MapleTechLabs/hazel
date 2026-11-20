/**
 * External chat-sync authors per Hazel channel (`chat_sync_channel_authors`, org store, never
 * synced): the evidence for suggested customer links (`docs/customers/channels.md`). Recorded by
 * `org.chatSyncIngest` for every authored `MessageCreate`; a thread's author counts for its parent
 * channel. Rows of a link that went away stay; readers keep only channels with a live link.
 */
import { Database, SQLite, schema } from "@hazel/db"
import type { ChannelId, ExternalUserId, SyncChannelLinkId } from "@hazel/schema"
import { Clock, Effect, Option } from "effect"

/** How stale `lastSeenAt` may get before a message from a known author refreshes it. */
const SEEN_REFRESH_MS = 60 * 60 * 1000

export const recordChannelAuthor = Effect.fn("OrgObject.chatSyncRecordAuthor")(function* (input: {
	readonly provider: string
	readonly hazelChannelId: ChannelId
	/** The mirror the message came through. */
	readonly syncChannelLinkId: SyncChannelLinkId
	readonly externalUserId: ExternalUserId
	readonly email: string | null | undefined
	readonly externalWorkspaceId: string | null | undefined
}) {
	const db = yield* Database.Database
	const now = new Date(yield* Clock.currentTimeMillis)
	const channel = yield* db.first(
		SQLite.from(schema.channelsTable)
			.select("type", "parentChannelId")
			.where(($) => [$.id.eq(input.hazelChannelId)])
			.limit(1),
	)
	const channelId =
		Option.isSome(channel) && channel.value.type === "thread" && channel.value.parentChannelId !== null
			? channel.value.parentChannelId
			: input.hazelChannelId
	const email = input.email?.trim().toLowerCase() || null
	const workspace = input.externalWorkspaceId || null
	const existing = yield* db.first(
		SQLite.from(schema.chatSyncChannelAuthorsTable)
			.select()
			.where(($) => [
				$.hazelChannelId.eq(channelId),
				$.provider.eq(input.provider),
				$.externalUserId.eq(input.externalUserId),
			])
			.limit(1),
	)
	if (Option.isNone(existing)) {
		const inserted = yield* db.run(
			SQLite.insertInto(schema.chatSyncChannelAuthorsTable)
				.values({
					hazelChannelId: channelId,
					syncChannelLinkId: input.syncChannelLinkId,
					provider: input.provider,
					externalUserId: input.externalUserId,
					externalWorkspaceId: workspace,
					email,
					firstSeenAt: now,
					lastSeenAt: now,
				})
				.onConflictDoNothing()
				.returning(),
		)
		// Two first messages at once and the other insert won: still add what this one knows.
		if (inserted.length > 0 || (email === null && workspace === null)) return
	} else {
		// Nothing new and seen within the hour: no write per message in a busy channel.
		const learned =
			// Seen through another mirror (a replaced link): evidence follows the live one.
			input.syncChannelLinkId !== existing.value.syncChannelLinkId ||
			(email !== null && email !== existing.value.email) ||
			(workspace !== null && workspace !== existing.value.externalWorkspaceId)
		if (!learned && now.getTime() - existing.value.lastSeenAt.getTime() < SEEN_REFRESH_MS) return
	}
	// What a lookup could not tell this time (a timeout, the scope not approved yet) is kept: an
	// unknown value is left out of the SET (the row's own value stays, whatever was read above).
	yield* db.run(
		SQLite.update(schema.chatSyncChannelAuthorsTable)
			.set({
				lastSeenAt: now,
				syncChannelLinkId: input.syncChannelLinkId,
				email: email ?? undefined,
				externalWorkspaceId: workspace ?? undefined,
			})
			.where(($) => [
				$.hazelChannelId.eq(channelId),
				$.provider.eq(input.provider),
				$.externalUserId.eq(input.externalUserId),
			]),
	)
})
