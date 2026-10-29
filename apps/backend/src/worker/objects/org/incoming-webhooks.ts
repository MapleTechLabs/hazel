/**
 * `org.executeWebhook`: an incoming webhook delivery (`routes/incoming-webhooks.http.ts`). The
 * api Worker checked the token against the directory's `webhook_index`; here the org's
 * `channel_webhooks` row decides (deleted, disabled), the author is the webhook's bot (or the
 * provider's shared bot), and the message goes to the channel's `ChannelObject` as a
 * `channel.postSystemMessage` (same side effects as `message.create`), keyed by the message id.
 */
import { Database, SQLite, schema } from "@hazel/db"
import { WebhookDisabledError, WebhookNotFoundError } from "@hazel/domain/http"
import { MessageEmbed } from "@hazel/domain/models"
import { ChannelId, ChannelWebhookId, MessageId } from "@hazel/schema"
import { Effect, Option, Schema } from "effect"
import { WebhookBotService } from "../../../services/webhook-bot-service"
import { defineCall } from "../calls"
import { ChannelEffects } from "../effects/channel-effects"
import { enqueueEffect } from "../effects/registry"
import { channelTarget } from "../kinds"

export const WebhookProvider = Schema.Literals(["openstatus", "railway", "maple"])

export const ExecuteWebhookCall = defineCall("org.executeWebhook", "org", {
	payload: Schema.Struct({
		webhookId: ChannelWebhookId,
		/** The provider whose shared bot authors the message; null: the webhook's own bot. */
		provider: Schema.NullOr(WebhookProvider),
		/** Chosen by the api Worker: the message id, and the post's idempotency key. */
		messageId: MessageId,
		/** The `ChannelObject` holding the channel's messages (a Connect mount's host). */
		hostChannelId: ChannelId,
		content: Schema.String,
		embeds: Schema.NullOr(MessageEmbed.MessageEmbeds),
	}),
	success: Schema.Struct({ messageId: MessageId, channelId: ChannelId }),
	error: Schema.Union([WebhookNotFoundError, WebhookDisabledError]),
})

export const executeWebhook = Effect.fn("OrgObject.executeWebhook")(
	function* (payload: typeof ExecuteWebhookCall.payload.Type) {
		const db = yield* Database.Database
		const bots = yield* WebhookBotService
		return yield* db.transaction(
			Effect.gen(function* () {
				const webhook = yield* db.first(
					SQLite.from(schema.channelWebhooksTable)
						.select()
						.where(($) => [$.id.eq(payload.webhookId), $.deletedAt.isNull()])
						.limit(1),
				)
				if (Option.isNone(webhook)) {
					return yield* new WebhookNotFoundError({ message: "Webhook not found" })
				}
				if (!webhook.value.isEnabled) {
					return yield* new WebhookDisabledError({ message: "Webhook is disabled" })
				}
				const authorId =
					payload.provider === null
						? webhook.value.botUserId
						: (yield* bots.getOrCreateIntegrationBot(
								payload.provider,
								webhook.value.organizationId,
							)).id
				yield* db.run(
					SQLite.update(schema.channelWebhooksTable)
						.set({ lastUsedAt: new Date() })
						.where(($) => [$.id.eq(webhook.value.id)]),
				)
				yield* enqueueEffect(
					ChannelEffects.postSystemMessage,
					channelTarget(payload.hostChannelId),
					{
						id: payload.messageId,
						channelId: payload.hostChannelId,
						authorId,
						content: payload.content,
						embeds: payload.embeds,
					},
					{ id: `webhook-message:${payload.messageId}` },
				)
				yield* Effect.annotateCurrentSpan({
					"webhook.id": webhook.value.id,
					"webhook.provider": payload.provider ?? "custom",
				})
				return { messageId: payload.messageId, channelId: webhook.value.channelId }
			}),
		)
	},
	Effect.catchTags({ DatabaseError: Effect.die, SchemaError: Effect.die }),
)
