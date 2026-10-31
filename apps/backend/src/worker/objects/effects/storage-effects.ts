/**
 * HTML render bucket cleanup a `ChannelObject` runs from its own outbox (`storage` target), after the
 * write that orphaned the objects commits; the alarm retries a failed delete.
 *
 * - `storage.claimHtmlRenders`: keep the pages a message started showing (created, or edited to
 *   show them): out of `pending/`, which expires.
 * - `storage.deleteHtmlRenders`: the pages of HTML renders a message no longer shows (deleted, or
 *   edited to drop or replace them), unless another of the author's messages shows them by the time
 *   it runs (a bot may reuse a published reference).
 *
 * Both act only on pages the message's author published (`services/html-renders.ts`).
 */
import { ChannelId, HtmlRenderId, UserId } from "@hazel/schema"
import { Database } from "@hazel/db"
import { Effect, Schema } from "effect"
import { HtmlRenders } from "../../../services/html-renders"
import { defineEffect, type EffectReceivers } from "./registry"

export const HtmlRendersPayload = Schema.Struct({
	channelId: ChannelId,
	/** The message's author: only pages it published are touched (`htmlRenderKey`). */
	authorId: UserId,
	renderIds: Schema.Array(HtmlRenderId),
})

export const StorageEffects = {
	claimHtmlRenders: defineEffect("storage.claimHtmlRenders", "storage", HtmlRendersPayload),
	deleteHtmlRenders: defineEffect("storage.deleteHtmlRenders", "storage", HtmlRendersPayload),
}

/** Another live message of `authorId` in this channel still shows the render. */
const stillShown = Effect.fn("StorageEffects.stillShown")(function* (
	authorId: UserId,
	renderId: HtmlRenderId,
) {
	const db = yield* Database.Database
	const rows = yield* db.query(
		Database.sql`SELECT 1 FROM messages WHERE authorId = ${authorId} AND deletedAt IS NULL AND embeds LIKE ${`%${renderId}%`} LIMIT 1`,
	)
	return rows.length > 0
})

const claimHtmlRenders = Effect.fn("StorageEffects.claimHtmlRenders")(function* (
	payload: typeof HtmlRendersPayload.Type,
) {
	const renders = yield* HtmlRenders
	const { channelId, authorId } = payload
	yield* Effect.forEach(payload.renderIds, (renderId) => renders.claim({ channelId, authorId, renderId }), {
		concurrency: 4,
		discard: true,
	})
})

const deleteHtmlRenders = Effect.fn("StorageEffects.deleteHtmlRenders")(function* (
	payload: typeof HtmlRendersPayload.Type,
) {
	const renders = yield* HtmlRenders
	const { channelId, authorId } = payload
	yield* Effect.forEach(
		payload.renderIds,
		(renderId) =>
			Effect.flatMap(stillShown(authorId, renderId), (shown) =>
				shown ? Effect.void : renders.remove({ channelId, authorId, renderId }),
			),
		{ concurrency: 4, discard: true },
	)
})

export const storageReceivers = {
	"storage.claimHtmlRenders": claimHtmlRenders,
	"storage.deleteHtmlRenders": deleteHtmlRenders,
} satisfies EffectReceivers<typeof StorageEffects, HtmlRenders | Database.Database>
