/**
 * Uploads-bucket cleanup a `ChannelObject` runs from its own outbox (`storage` target), after the
 * write that orphaned the objects commits; the alarm retries a failed delete.
 *
 * `storage.deleteHtmlRenders`: the pages of HTML renders a message no longer shows (deleted, or
 * edited to drop or replace them), `services/html-renders.ts`.
 */
import { ChannelId, HtmlRenderId, UserId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import { HtmlRenders } from "../../../services/html-renders"
import { defineEffect, type EffectReceivers } from "./registry"

export const DeleteHtmlRendersPayload = Schema.Struct({
	channelId: ChannelId,
	/** The message's author: only pages it published are deleted (`htmlRenderKey`). */
	authorId: UserId,
	renderIds: Schema.Array(HtmlRenderId),
})

export const StorageEffects = {
	deleteHtmlRenders: defineEffect("storage.deleteHtmlRenders", "storage", DeleteHtmlRendersPayload),
}

const deleteHtmlRenders = Effect.fn("StorageEffects.deleteHtmlRenders")(function* (
	payload: typeof DeleteHtmlRendersPayload.Type,
) {
	const renders = yield* HtmlRenders
	const { channelId, authorId } = payload
	yield* Effect.forEach(
		payload.renderIds,
		(renderId) => renders.remove({ channelId, authorId, renderId }),
		{
			concurrency: 4,
			discard: true,
		},
	)
})

export const storageReceivers = {
	"storage.deleteHtmlRenders": deleteHtmlRenders,
} satisfies EffectReceivers<typeof StorageEffects, HtmlRenders>
