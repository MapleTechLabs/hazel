import { createHash, timingSafeEqual } from "node:crypto"
import { HttpApiBuilder } from "effect/http-api"
import { ChannelWebhookRepo, MessageOutboxRepo, MessageRepo } from "@hazel/backend-core"
import { Database } from "@hazel/db"
import type { MessageEmbed as DbMessageEmbed } from "@hazel/db"
import { InternalServerError } from "@hazel/domain"
import {
	InvalidWebhookTokenError,
	WebhookDisabledError,
	WebhookMessageResponse,
	WebhookNotFoundError,
} from "@hazel/domain/http"
import type { MessageEmbed } from "@hazel/domain/models"
import { buildMapleEmbed } from "@hazel/integrations/maple"
import { buildOpenStatusEmbed } from "@hazel/integrations/openstatus"
import { buildRailwayEmbed } from "@hazel/integrations/railway"
import { Effect, Option } from "effect"
import { HazelApi } from "../api"
import { IntegrationBotService } from "../services/integrations/integration-bot-service"

// Convert domain embed schema to database embed format
const convertEmbedToDb = (embed: MessageEmbed.MessageEmbed): DbMessageEmbed => ({
	title: embed.title,
	description: embed.description,
	url: embed.url,
	color: embed.color,
	author: embed.author
		? {
				name: embed.author.name,
				url: embed.author.url,
				iconUrl: embed.author.iconUrl,
			}
		: undefined,
	footer: embed.footer
		? {
				text: embed.footer.text,
				iconUrl: embed.footer.iconUrl,
			}
		: undefined,
	image: embed.image,
	thumbnail: embed.thumbnail,
	fields: embed.fields?.map((f: MessageEmbed.MessageEmbedField) => ({
		name: f.name,
		value: f.value,
		inline: f.inline,
	})),
	timestamp: embed.timestamp,
})

export const HttpIncomingWebhookLive = HttpApiBuilder.group(HazelApi, "incoming-webhooks", (handlers) =>
	handlers
		.handle("execute", ({ params, payload }) =>
			Effect.gen(function* () {
				const { webhookId, token } = params
				const db = yield* Database.Database
				const webhookRepo = yield* ChannelWebhookRepo
				const messageRepo = yield* MessageRepo
				const outboxRepo = yield* MessageOutboxRepo

				// Hash the provided token
				const tokenHash = createHash("sha256").update(token).digest("hex")

				// Find webhook by ID
				const webhookOption = yield* webhookRepo.findById(webhookId)

				if (Option.isNone(webhookOption)) {
					yield* Effect.logWarning("Webhook not found", { webhookId })
					return yield* Effect.fail(new WebhookNotFoundError({ message: "Webhook not found" }))
				}

				const webhook = webhookOption.value

				// Verify token hash matches using timing-safe comparison to prevent timing attacks
				const tokenBuffer = Buffer.from(tokenHash, "hex")
				const expectedBuffer = Buffer.from(webhook.tokenHash, "hex")
				if (
					tokenBuffer.length !== expectedBuffer.length ||
					!timingSafeEqual(tokenBuffer, expectedBuffer)
				) {
					yield* Effect.logWarning("Invalid webhook token", { webhookId })
					return yield* Effect.fail(
						new InvalidWebhookTokenError({ message: "Invalid webhook token" }),
					)
				}

				// Check if webhook is enabled
				if (!webhook.isEnabled) {
					yield* Effect.logWarning("Webhook is disabled", { webhookId: webhook.id })
					return yield* Effect.fail(new WebhookDisabledError({ message: "Webhook is disabled" }))
				}

				// Validate payload has content or embeds
				if (!payload.content && (!payload.embeds || payload.embeds.length === 0)) {
					return yield* Effect.fail(
						new InternalServerError({
							message: "Message must have content or embeds",
							detail: "Provide either 'content' or 'embeds' in the payload",
						}),
					)
				}

				// Limit number of embeds (like Discord)
				if (payload.embeds && payload.embeds.length > 10) {
					return yield* Effect.fail(
						new InternalServerError({
							message: "Too many embeds",
							detail: "Maximum 10 embeds per message",
						}),
					)
				}

				// Convert embeds to database format
				const dbEmbeds = payload.embeds?.map(convertEmbedToDb) ?? null

				const message = yield* db.transaction(
					Effect.gen(function* () {
						const [createdMessage] = yield* messageRepo.insert({
							channelId: webhook.channelId,
							authorId: webhook.botUserId,
							content: payload.content ?? "",
							embeds: dbEmbeds,
							replyToMessageId: null,
							threadChannelId: null,
							deletedAt: null,
						})
						yield* outboxRepo.insert({
							eventType: "message_created",
							aggregateId: createdMessage.id,
							channelId: createdMessage.channelId,
							payload: {
								messageId: createdMessage.id,
								channelId: createdMessage.channelId,
								authorId: createdMessage.authorId,
								content: createdMessage.content,
								replyToMessageId: createdMessage.replyToMessageId,
							},
						})
						return createdMessage
					}),
				)

				// Update last used timestamp (fire and forget)
				yield* webhookRepo.updateLastUsed(webhook.id).pipe(Effect.ignore)

				return new WebhookMessageResponse({
					messageId: message.id,
					channelId: webhook.channelId,
				})
			}).pipe(
				Effect.catchTags({
					DatabaseError: (error: unknown) =>
						Effect.fail(
							new InternalServerError({
								message: "Database error while creating message",
								detail: String(error),
							}),
						),
					SchemaError: (error: unknown) =>
						Effect.fail(
							new InternalServerError({
								message: "Invalid request data",
								detail: String(error),
							}),
						),
				}),
			),
		)
		.handle("executeOpenStatus", ({ params, payload }) =>
			Effect.gen(function* () {
				const { webhookId, token } = params
				const db = yield* Database.Database
				const webhookRepo = yield* ChannelWebhookRepo
				const messageRepo = yield* MessageRepo
				const outboxRepo = yield* MessageOutboxRepo
				const botService = yield* IntegrationBotService

				// Hash the provided token
				const tokenHash = createHash("sha256").update(token).digest("hex")

				// Find webhook by ID
				const webhookOption = yield* webhookRepo.findById(webhookId)

				if (Option.isNone(webhookOption)) {
					yield* Effect.logWarning("Webhook not found", { webhookId })
					return yield* Effect.fail(new WebhookNotFoundError({ message: "Webhook not found" }))
				}

				const webhook = webhookOption.value

				// Verify token hash matches using timing-safe comparison to prevent timing attacks
				const tokenBuffer = Buffer.from(tokenHash, "hex")
				const expectedBuffer = Buffer.from(webhook.tokenHash, "hex")
				if (
					tokenBuffer.length !== expectedBuffer.length ||
					!timingSafeEqual(tokenBuffer, expectedBuffer)
				) {
					yield* Effect.logWarning("Invalid webhook token", { webhookId })
					return yield* Effect.fail(
						new InvalidWebhookTokenError({ message: "Invalid webhook token" }),
					)
				}

				// Check if webhook is enabled
				if (!webhook.isEnabled) {
					yield* Effect.logWarning("Webhook is disabled", { webhookId: webhook.id })
					return yield* Effect.fail(new WebhookDisabledError({ message: "Webhook is disabled" }))
				}

				// Get or create the OpenStatus bot user for this organization
				const botUser = yield* botService.getOrCreateWebhookBotUser(
					"openstatus",
					webhook.organizationId,
				)

				// Build the embed based on status
				const embed = buildOpenStatusEmbed(payload)

				const message = yield* db.transaction(
					Effect.gen(function* () {
						const [createdMessage] = yield* messageRepo.insert({
							channelId: webhook.channelId,
							authorId: botUser.id,
							content: "",
							embeds: [embed],
							replyToMessageId: null,
							threadChannelId: null,
							deletedAt: null,
						})
						yield* outboxRepo.insert({
							eventType: "message_created",
							aggregateId: createdMessage.id,
							channelId: createdMessage.channelId,
							payload: {
								messageId: createdMessage.id,
								channelId: createdMessage.channelId,
								authorId: createdMessage.authorId,
								content: createdMessage.content,
								replyToMessageId: createdMessage.replyToMessageId,
							},
						})
						return createdMessage
					}),
				)

				// Update last used timestamp (fire and forget)
				yield* webhookRepo.updateLastUsed(webhook.id).pipe(Effect.ignore)

				return new WebhookMessageResponse({
					messageId: message.id,
					channelId: webhook.channelId,
				})
			}).pipe(
				Effect.catchTags({
					DatabaseError: (error: unknown) =>
						Effect.fail(
							new InternalServerError({
								message: "Database error while creating message",
								detail: String(error),
							}),
						),
					SchemaError: (error: unknown) =>
						Effect.fail(
							new InternalServerError({
								message: "Invalid request data",
								detail: String(error),
							}),
						),
				}),
			),
		)
		.handle("executeRailway", ({ params, payload }) =>
			Effect.gen(function* () {
				const { webhookId, token } = params
				const db = yield* Database.Database
				const webhookRepo = yield* ChannelWebhookRepo
				const messageRepo = yield* MessageRepo
				const outboxRepo = yield* MessageOutboxRepo
				const botService = yield* IntegrationBotService

				// Hash the provided token
				const tokenHash = createHash("sha256").update(token).digest("hex")

				// Find webhook by ID
				const webhookOption = yield* webhookRepo.findById(webhookId)

				if (Option.isNone(webhookOption)) {
					yield* Effect.logWarning("Webhook not found", { webhookId })
					return yield* Effect.fail(new WebhookNotFoundError({ message: "Webhook not found" }))
				}

				const webhook = webhookOption.value

				// Verify token hash matches using timing-safe comparison to prevent timing attacks
				const tokenBuffer = Buffer.from(tokenHash, "hex")
				const expectedBuffer = Buffer.from(webhook.tokenHash, "hex")
				if (
					tokenBuffer.length !== expectedBuffer.length ||
					!timingSafeEqual(tokenBuffer, expectedBuffer)
				) {
					yield* Effect.logWarning("Invalid webhook token", { webhookId })
					return yield* Effect.fail(
						new InvalidWebhookTokenError({ message: "Invalid webhook token" }),
					)
				}

				// Check if webhook is enabled
				if (!webhook.isEnabled) {
					yield* Effect.logWarning("Webhook is disabled", { webhookId: webhook.id })
					return yield* Effect.fail(new WebhookDisabledError({ message: "Webhook is disabled" }))
				}

				// Get or create the Railway bot user for this organization
				const botUser = yield* botService.getOrCreateWebhookBotUser("railway", webhook.organizationId)

				// Build the embed based on the event
				const embed = buildRailwayEmbed(payload)

				const message = yield* db.transaction(
					Effect.gen(function* () {
						const [createdMessage] = yield* messageRepo.insert({
							channelId: webhook.channelId,
							authorId: botUser.id,
							content: "",
							embeds: [embed],
							replyToMessageId: null,
							threadChannelId: null,
							deletedAt: null,
						})
						yield* outboxRepo.insert({
							eventType: "message_created",
							aggregateId: createdMessage.id,
							channelId: createdMessage.channelId,
							payload: {
								messageId: createdMessage.id,
								channelId: createdMessage.channelId,
								authorId: createdMessage.authorId,
								content: createdMessage.content,
								replyToMessageId: createdMessage.replyToMessageId,
							},
						})
						return createdMessage
					}),
				)

				// Update last used timestamp (fire and forget)
				yield* webhookRepo.updateLastUsed(webhook.id).pipe(Effect.ignore)

				return new WebhookMessageResponse({
					messageId: message.id,
					channelId: webhook.channelId,
				})
			}).pipe(
				Effect.catchTags({
					DatabaseError: (error: unknown) =>
						Effect.fail(
							new InternalServerError({
								message: "Database error while creating message",
								detail: String(error),
							}),
						),
					SchemaError: (error: unknown) =>
						Effect.fail(
							new InternalServerError({
								message: "Invalid request data",
								detail: String(error),
							}),
						),
				}),
			),
		)
		.handle("executeMaple", ({ params, payload }) =>
			Effect.gen(function* () {
				const { webhookId, token } = params
				const db = yield* Database.Database
				const webhookRepo = yield* ChannelWebhookRepo
				const messageRepo = yield* MessageRepo
				const outboxRepo = yield* MessageOutboxRepo
				const botService = yield* IntegrationBotService

				const tokenHash = createHash("sha256").update(token).digest("hex")

				const webhookOption = yield* webhookRepo.findById(webhookId)

				if (Option.isNone(webhookOption)) {
					yield* Effect.logWarning("Webhook not found", { webhookId })
					return yield* Effect.fail(new WebhookNotFoundError({ message: "Webhook not found" }))
				}

				const webhook = webhookOption.value

				const tokenBuffer = Buffer.from(tokenHash, "hex")
				const expectedBuffer = Buffer.from(webhook.tokenHash, "hex")
				if (
					tokenBuffer.length !== expectedBuffer.length ||
					!timingSafeEqual(tokenBuffer, expectedBuffer)
				) {
					yield* Effect.logWarning("Invalid webhook token", { webhookId })
					return yield* Effect.fail(
						new InvalidWebhookTokenError({ message: "Invalid webhook token" }),
					)
				}

				if (!webhook.isEnabled) {
					yield* Effect.logWarning("Webhook is disabled", { webhookId: webhook.id })
					return yield* Effect.fail(new WebhookDisabledError({ message: "Webhook is disabled" }))
				}

				const botUser = yield* botService.getOrCreateWebhookBotUser("maple", webhook.organizationId)

				const embed = buildMapleEmbed(payload)

				const message = yield* db.transaction(
					Effect.gen(function* () {
						const [createdMessage] = yield* messageRepo.insert({
							channelId: webhook.channelId,
							authorId: botUser.id,
							content: "",
							embeds: [embed],
							replyToMessageId: null,
							threadChannelId: null,
							deletedAt: null,
						})
						yield* outboxRepo.insert({
							eventType: "message_created",
							aggregateId: createdMessage.id,
							channelId: createdMessage.channelId,
							payload: {
								messageId: createdMessage.id,
								channelId: createdMessage.channelId,
								authorId: createdMessage.authorId,
								content: createdMessage.content,
								replyToMessageId: createdMessage.replyToMessageId,
							},
						})
						return createdMessage
					}),
				)

				yield* webhookRepo.updateLastUsed(webhook.id).pipe(Effect.ignore)

				return new WebhookMessageResponse({
					messageId: message.id,
					channelId: webhook.channelId,
				})
			}).pipe(
				Effect.catchTags({
					DatabaseError: (error: unknown) =>
						Effect.fail(
							new InternalServerError({
								message: "Database error while creating message",
								detail: String(error),
							}),
						),
					SchemaError: (error: unknown) =>
						Effect.fail(
							new InternalServerError({
								message: "Invalid request data",
								detail: String(error),
							}),
						),
				}),
			),
		),
)
