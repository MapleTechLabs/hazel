/**
 * Incoming webhooks (custom, OpenStatus, Railway, Maple). The api Worker checks the token against
 * the directory's `webhook_index`; the webhook's `OrgObject` then posts the message to the
 * channel's `ChannelObject` (`worker/objects/org/incoming-webhooks.ts`), with the side effects
 * of `message.create` (bots, notifications, chat-sync).
 */
import { createHash, timingSafeEqual } from "node:crypto"
import { HttpApiBuilder } from "effect/http-api"
import { InternalServerError } from "@hazel/domain"
import {
	InvalidWebhookPayloadError,
	InvalidWebhookTokenError,
	WebhookMessageResponse,
	WebhookNotFoundError,
} from "@hazel/domain/http"
import { MessageEmbed } from "@hazel/domain/models"
import { buildMapleEmbed } from "@hazel/integrations/maple"
import { buildOpenStatusEmbed } from "@hazel/integrations/openstatus"
import { buildRailwayEmbed } from "@hazel/integrations/railway"
import { type ChannelWebhookId, MessageId } from "@hazel/schema"
import { Effect, Option, Schema } from "effect"
import { HazelApi } from "../api"
import { Directory } from "../services/directory"
import { callObject } from "../worker/objects/calls"
import { orgTarget } from "../worker/objects/kinds"
import { ExecuteWebhookCall } from "../worker/objects/org/incoming-webhooks"

const decodeEmbeds = Schema.decodeUnknownEffect(MessageEmbed.MessageEmbeds)

const tokenMatches = (token: string, expectedHash: string) => {
	const actual = Buffer.from(createHash("sha256").update(token).digest("hex"), "hex")
	const expected = Buffer.from(expectedHash, "hex")
	// Timing-safe, so the comparison leaks nothing about the hash.
	return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export interface WebhookDelivery {
	readonly webhookId: ChannelWebhookId
	readonly token: string
	/** Whose shared bot authors the message; null: the webhook's own bot. */
	readonly provider: typeof ExecuteWebhookCall.payload.Type.provider
	readonly content: string
	readonly embeds: ReadonlyArray<unknown> | null
}

/** Verify the token, then post the message through the webhook's `OrgObject`. */
export const deliverWebhook = Effect.fn("IncomingWebhook.deliver")(function* (delivery: WebhookDelivery) {
	const directory = yield* Directory
	const index = yield* directory.webhook(delivery.webhookId)
	if (Option.isNone(index)) {
		yield* Effect.logWarning("Webhook not found", { webhookId: delivery.webhookId })
		return yield* new WebhookNotFoundError({ message: "Webhook not found" })
	}
	if (!tokenMatches(delivery.token, index.value.tokenHash)) {
		yield* Effect.logWarning("Invalid webhook token", { webhookId: delivery.webhookId })
		return yield* new InvalidWebhookTokenError({ message: "Invalid webhook token" })
	}
	const embeds =
		delivery.embeds === null
			? null
			: yield* decodeEmbeds(delivery.embeds).pipe(
					Effect.mapError(
						() =>
							new InvalidWebhookPayloadError({
								message: "The payload does not make a valid message",
							}),
					),
				)
	const channel = yield* directory.channel(index.value.channelId)
	const hostChannelId = Option.match(channel, {
		onNone: () => index.value.channelId,
		onSome: (row) => row.hostChannelId ?? index.value.channelId,
	})
	yield* Effect.annotateCurrentSpan({
		"webhook.id": delivery.webhookId,
		"organization.id": index.value.organizationId,
		"channel.id": index.value.channelId,
	})
	const posted = yield* callObject(ExecuteWebhookCall, orgTarget(index.value.organizationId), {
		webhookId: delivery.webhookId,
		provider: delivery.provider,
		messageId: MessageId.make(crypto.randomUUID()),
		hostChannelId,
		content: delivery.content,
		embeds,
	})
	return new WebhookMessageResponse({ messageId: posted.messageId, channelId: posted.channelId })
})

const toHttpErrors = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
	effect.pipe(
		Effect.catchTags({
			DatabaseError: (error: unknown) =>
				Effect.fail(
					new InternalServerError({
						message: "Database error while creating message",
						cause: error,
					}),
				),
			ObjectCallError: (error: unknown) =>
				Effect.fail(new InternalServerError({ message: "The channel is unavailable", cause: error })),
		}),
	)

export const HttpIncomingWebhookLive = HttpApiBuilder.group(HazelApi, "incoming-webhooks", (handlers) =>
	handlers
		.handle("execute", ({ params, payload }) =>
			Effect.gen(function* () {
				if (!payload.content && (!payload.embeds || payload.embeds.length === 0)) {
					return yield* new InvalidWebhookPayloadError({
						message: "Message must have content or embeds",
					})
				}
				// Like Discord.
				if (payload.embeds && payload.embeds.length > 10) {
					return yield* new InvalidWebhookPayloadError({
						message: "Too many embeds: maximum 10 embeds per message",
					})
				}
				return yield* deliverWebhook({
					webhookId: params.webhookId,
					token: params.token,
					provider: null,
					content: payload.content ?? "",
					embeds: payload.embeds ?? null,
				})
			}).pipe(toHttpErrors),
		)
		.handle("executeOpenStatus", ({ params, payload }) =>
			deliverWebhook({
				webhookId: params.webhookId,
				token: params.token,
				provider: "openstatus",
				content: "",
				embeds: [buildOpenStatusEmbed(payload)],
			}).pipe(toHttpErrors),
		)
		.handle("executeRailway", ({ params, payload }) =>
			deliverWebhook({
				webhookId: params.webhookId,
				token: params.token,
				provider: "railway",
				content: "",
				embeds: [buildRailwayEmbed(payload)],
			}).pipe(toHttpErrors),
		)
		.handle("executeMaple", ({ params, payload }) =>
			deliverWebhook({
				webhookId: params.webhookId,
				token: params.token,
				provider: "maple",
				content: "",
				embeds: [buildMapleEmbed(payload)],
			}).pipe(toHttpErrors),
		),
)
