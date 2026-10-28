import { createHash, randomBytes } from "node:crypto"
import { ChannelRepo, ChannelWebhookRepo } from "@hazel/backend-core"
import { Database } from "@hazel/db"
import { CurrentUser, ErrorUtils, withRemapDbErrors } from "@hazel/domain"
import type { ChannelId, ChannelWebhookId, OrganizationId } from "@hazel/schema"
import {
	ChannelNotFoundError,
	ChannelWebhookCreatedResponse,
	ChannelWebhookListResponse,
	ChannelWebhookNotFoundError,
	ChannelWebhookResponse,
	ChannelWebhookRpcs,
} from "@hazel/domain/rpc"
import { Effect, Option } from "effect"
import { generateTransactionId } from "../../lib/create-transactionId"
import { requestOrganizationId } from "../../worker/objects/org/organization"
import { withAnnotatedScope } from "../../lib/policy-utils"
import { ChannelWebhookPolicy } from "../../policies/channel-webhook-policy"
import { OrgResolver } from "../../services/org-resolver"
import { WebhookBotService } from "../../services/webhook-bot-service"
import { DirectoryEffects } from "../../worker/objects/effects/directory-effects"
import { enqueueEffect } from "../../worker/objects/effects/registry"

// Generate a secure token and return both the plain token and its hash
const generateToken = () => {
	const token = randomBytes(32).toString("hex")
	const tokenHash = createHash("sha256").update(token).digest("hex")
	const tokenSuffix = token.slice(-4)
	return { token, tokenHash, tokenSuffix }
}

// Build the webhook URL
const buildWebhookUrl = (webhookId: string, token: string) => {
	const baseUrl = process.env.API_BASE_URL ?? "http://localhost:3010"
	return `${baseUrl}/webhooks/incoming/${webhookId}/${token}`
}

/**
 * Channel Webhook RPC Handlers
 *
 * Implements the business logic for all channel webhook-related RPC methods.
 * Only organization admins can manage webhooks. Run in the `OrgObject` (`rpc/routing.ts`); the
 * token hash is projected to the directory's `webhook_index` (the incoming webhook route's lookup)
 * through the outbox, and each webhook's bot user lives in the directory (`WebhookBotService`).
 */
export const ChannelWebhookRpcLive = ChannelWebhookRpcs.toLayer(
	Effect.gen(function* () {
		const db = yield* Database.Database
		const channelWebhookPolicy = yield* ChannelWebhookPolicy
		const orgResolver = yield* OrgResolver

		/** The directory's `webhook_index` row (`tokenHash: null` drops it). */
		const indexWebhook = (
			webhook: {
				readonly id: ChannelWebhookId
				readonly organizationId: OrganizationId
				readonly channelId: ChannelId
			},
			tokenHash: string | null,
		) =>
			enqueueEffect(
				DirectoryEffects.upsertWebhookIndex,
				{ kind: "directory" },
				{
					webhookId: webhook.id,
					organizationId: webhook.organizationId,
					channelId: webhook.channelId,
					tokenHash,
				},
			)

		return {
			"channelWebhook.create": (payload) =>
				db
					.transaction(
						Effect.gen(function* () {
							const user = yield* CurrentUser.Context
							const channelRepo = yield* ChannelRepo
							const webhookRepo = yield* ChannelWebhookRepo
							const webhookBotService = yield* WebhookBotService

							// Get channel to get organization ID
							const channelOption = yield* channelRepo.findById(payload.channelId)
							if (Option.isNone(channelOption)) {
								return yield* Effect.fail(
									new ChannelNotFoundError({ channelId: payload.channelId }),
								)
							}
							const channel = channelOption.value

							// Generate token
							const { token, tokenHash, tokenSuffix } = generateToken()

							// Get or create bot user based on whether this is an integration webhook
							const botUser = yield* Option.fromNullishOr(payload.integrationProvider).pipe(
								Option.match({
									onNone: () => {
										const botReferenceId = crypto.randomUUID() as ChannelWebhookId
										return webhookBotService.createWebhookBot(
											botReferenceId,
											payload.name,
											payload.avatarUrl ?? null,
											channel.organizationId,
										)
									},
									onSome: (provider) =>
										webhookBotService.getOrCreateIntegrationBot(
											provider,
											channel.organizationId,
										),
								}),
							)

							yield* channelWebhookPolicy.canCreate(payload.channelId)

							// Create webhook
							const [webhook] = yield* webhookRepo.insert({
								channelId: payload.channelId,
								organizationId: channel.organizationId,
								botUserId: botUser.id,
								name: payload.name,
								description: payload.description ?? null,
								avatarUrl: payload.avatarUrl ?? null,
								tokenHash,
								tokenSuffix,
								isEnabled: true,
								createdBy: user.id,
								lastUsedAt: null,
								deletedAt: null,
							})
							yield* indexWebhook(webhook, tokenHash)

							const txid = yield* generateTransactionId()

							return new ChannelWebhookCreatedResponse({
								data: webhook,
								token, // Only returned once
								webhookUrl: buildWebhookUrl(webhook.id, token),
								transactionId: txid,
							})
						}),
					)
					.pipe(withRemapDbErrors("ChannelWebhook", "create")),

			"channelWebhook.list": ({ channelId }) =>
				Effect.gen(function* () {
					const webhookRepo = yield* ChannelWebhookRepo

					yield* channelWebhookPolicy.canRead(channelId)
					const webhooks = yield* webhookRepo.findByChannel(channelId)

					return new ChannelWebhookListResponse({ data: webhooks })
				}).pipe(withRemapDbErrors("ChannelWebhook", "select")),

			"channelWebhook.update": ({ id, organizationId: _route, ...payload }) =>
				db
					.transaction(
						Effect.gen(function* () {
							const webhookRepo = yield* ChannelWebhookRepo
							const botService = yield* WebhookBotService

							yield* channelWebhookPolicy.canUpdate(id)

							// Get current webhook
							const webhookOption = yield* webhookRepo.findById(id)
							if (Option.isNone(webhookOption)) {
								return yield* Effect.fail(new ChannelWebhookNotFoundError({ webhookId: id }))
							}
							const currentWebhook = webhookOption.value

							// Update webhook
							const updatedWebhook = yield* webhookRepo.update({
								id,
								name: payload.name,
								description: payload.description,
								avatarUrl: payload.avatarUrl,
								isEnabled: payload.isEnabled,
							})

							// Update bot user if name or avatar changed
							if (payload.name !== undefined || payload.avatarUrl !== undefined) {
								yield* botService.updateWebhookBot(
									currentWebhook.botUserId,
									payload.name ?? currentWebhook.name,
									payload.avatarUrl !== undefined
										? payload.avatarUrl
										: currentWebhook.avatarUrl,
								)
							}

							const txid = yield* generateTransactionId()

							return new ChannelWebhookResponse({
								data: updatedWebhook,
								transactionId: txid,
							})
						}),
					)
					.pipe(withRemapDbErrors("ChannelWebhook", "update")),

			"channelWebhook.regenerateToken": ({ id }) =>
				db
					.transaction(
						Effect.gen(function* () {
							const webhookRepo = yield* ChannelWebhookRepo

							yield* channelWebhookPolicy.canUpdate(id)

							// Get current webhook
							const webhookOption = yield* webhookRepo.findById(id)
							if (Option.isNone(webhookOption)) {
								return yield* Effect.fail(new ChannelWebhookNotFoundError({ webhookId: id }))
							}

							// Generate new token
							const { token, tokenHash, tokenSuffix } = generateToken()

							// Update token
							const [updatedWebhook] = yield* webhookRepo.updateToken(
								id,
								tokenHash,
								tokenSuffix,
							)
							yield* indexWebhook(updatedWebhook!, tokenHash)

							const txid = yield* generateTransactionId()

							return new ChannelWebhookCreatedResponse({
								data: updatedWebhook,
								token, // Only returned once
								webhookUrl: buildWebhookUrl(id, token),
								transactionId: txid,
							})
						}),
					)
					.pipe(withRemapDbErrors("ChannelWebhook", "update")),

			"channelWebhook.delete": ({ id }) =>
				db
					.transaction(
						Effect.gen(function* () {
							const webhookRepo = yield* ChannelWebhookRepo

							yield* channelWebhookPolicy.canDelete(id)

							// Soft delete webhook only - bot user cleanup can be handled separately
							// (e.g., by admin or background job) since integrations may create webhooks
							// and users shouldn't need permission to delete integration-created bot users
							const existing = yield* webhookRepo.findById(id)
							yield* webhookRepo.softDelete(id)
							if (Option.isSome(existing)) yield* indexWebhook(existing.value, null)

							const txid = yield* generateTransactionId()

							return { transactionId: txid }
						}),
					)
					.pipe(withRemapDbErrors("ChannelWebhook", "delete")),

			"channelWebhook.listByOrganization": () =>
				Effect.gen(function* () {
					const webhookRepo = yield* ChannelWebhookRepo

					const requested = yield* requestOrganizationId
					if (Option.isNone(requested)) {
						return new ChannelWebhookListResponse({ data: [] })
					}
					const organizationId = requested.value

					yield* ErrorUtils.refailUnauthorized(
						"ChannelWebhook",
						"list",
					)(
						withAnnotatedScope((scope) =>
							orgResolver.requireScope(organizationId, scope, "ChannelWebhook", "list"),
						),
					)

					const webhooks = yield* webhookRepo.findByOrganization(organizationId)

					return new ChannelWebhookListResponse({ data: webhooks })
				}).pipe(withRemapDbErrors("ChannelWebhook", "select")),
		}
	}),
)
