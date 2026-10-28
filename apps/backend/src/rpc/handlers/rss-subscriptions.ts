/**
 * TODO(do-sync): runs in the OrgObject (`rpc/routing.ts`); not ported yet. To port: touch only that
 * store's tables and send everything else through the outbox (`worker/objects/effects`).
 * - polling moves to an OrgObject alarm; posts reach the ChannelObject as effects
 */
import { ChannelRepo, RssSubscriptionRepo } from "@hazel/backend-core"
import { Database } from "@hazel/db"
import { CurrentUser, withRemapDbErrors } from "@hazel/domain"
import {
	ChannelNotFoundError,
	RssFeedValidationError,
	RssSubscriptionExistsError,
	RssSubscriptionListResponse,
	RssSubscriptionNotFoundError,
	RssSubscriptionResponse,
	RssSubscriptionRpcs,
} from "@hazel/domain/rpc"
import { Rss } from "@hazel/integrations"
import { Effect, Option } from "effect"
import { generateTransactionId } from "../../lib/create-transactionId"
import { RssSubscriptionPolicy } from "../../policies/rss-subscription-policy"
import { IntegrationBotService } from "../../services/integrations/integration-bot-service"

export const RssSubscriptionRpcLive = RssSubscriptionRpcs.toLayer(
	Effect.gen(function* () {
		const db = yield* Database.Database
		const channelRepo = yield* ChannelRepo
		const subscriptionRepo = yield* RssSubscriptionRepo
		const integrationBotService = yield* IntegrationBotService
		const rssSubscriptionPolicy = yield* RssSubscriptionPolicy

		return {
			"rssSubscription.create": (payload) =>
				db
					.transaction(
						Effect.gen(function* () {
							const user = yield* CurrentUser.Context

							// Get channel to get organization ID
							const channelOption = yield* channelRepo.findById(payload.channelId)
							if (Option.isNone(channelOption)) {
								return yield* Effect.fail(
									new ChannelNotFoundError({ channelId: payload.channelId }),
								)
							}
							const channel = channelOption.value

							// Check if already subscribed to this feed URL in this channel
							const existingOption = yield* subscriptionRepo.findByChannelAndFeedUrl(
								payload.channelId,
								payload.feedUrl,
							)
							if (Option.isSome(existingOption)) {
								return yield* Effect.fail(
									new RssSubscriptionExistsError({
										channelId: payload.channelId,
										feedUrl: payload.feedUrl,
									}),
								)
							}

							// Validate the feed URL by test-fetching it
							const feedMetadata = yield* Effect.tryPromise({
								try: () => Rss.validateFeedUrl(payload.feedUrl),
								catch: (error) =>
									new RssFeedValidationError({
										feedUrl: payload.feedUrl,
										message:
											error instanceof Error ? error.message : "Invalid RSS feed URL",
									}),
							})

							yield* rssSubscriptionPolicy.canCreate(payload.channelId)

							// Create subscription
							const [subscription] = yield* subscriptionRepo.insert({
								channelId: payload.channelId,
								organizationId: channel.organizationId,
								feedUrl: payload.feedUrl,
								feedTitle: feedMetadata.title,
								feedIconUrl: feedMetadata.iconUrl,
								isEnabled: true,
								pollingIntervalMinutes: payload.pollingIntervalMinutes ?? 15,
								createdBy: user.id,
								deletedAt: null,
							})

							// Ensure RSS bot user exists for this organization
							yield* integrationBotService.getOrCreateWebhookBotUser(
								"rss",
								channel.organizationId,
							)

							const txid = yield* generateTransactionId()

							return new RssSubscriptionResponse({
								data: subscription,
								transactionId: txid,
							})
						}),
					)
					.pipe(withRemapDbErrors("RssSubscription", "create")),

			"rssSubscription.list": ({ channelId }) =>
				Effect.gen(function* () {
					yield* rssSubscriptionPolicy.canRead(channelId)
					const subscriptions = yield* subscriptionRepo.findByChannel(channelId)

					return new RssSubscriptionListResponse({ data: subscriptions })
				}).pipe(withRemapDbErrors("RssSubscription", "select")),

			"rssSubscription.listByOrganization": () =>
				Effect.gen(function* () {
					const user = yield* CurrentUser.Context

					if (!user.organizationId) {
						return new RssSubscriptionListResponse({ data: [] })
					}

					const organizationId = user.organizationId

					yield* rssSubscriptionPolicy.canReadByOrganization(organizationId)
					const subscriptions = yield* subscriptionRepo.findByOrganization(organizationId)

					return new RssSubscriptionListResponse({ data: subscriptions })
				}).pipe(withRemapDbErrors("RssSubscription", "select")),

			"rssSubscription.update": ({ id, organizationId: _route, ...payload }) =>
				db
					.transaction(
						Effect.gen(function* () {
							const subscriptionOption = yield* subscriptionRepo.findById(id)
							if (Option.isNone(subscriptionOption)) {
								return yield* Effect.fail(
									new RssSubscriptionNotFoundError({ subscriptionId: id }),
								)
							}

							yield* rssSubscriptionPolicy.canUpdate(id)

							const [updatedSubscription] = yield* subscriptionRepo.updateSettings(id, {
								isEnabled: payload.isEnabled,
								pollingIntervalMinutes: payload.pollingIntervalMinutes,
							})

							const txid = yield* generateTransactionId()

							return new RssSubscriptionResponse({
								data: updatedSubscription,
								transactionId: txid,
							})
						}),
					)
					.pipe(withRemapDbErrors("RssSubscription", "update")),

			"rssSubscription.delete": ({ id }) =>
				db
					.transaction(
						Effect.gen(function* () {
							const subscriptionOption = yield* subscriptionRepo.findById(id)
							if (Option.isNone(subscriptionOption)) {
								return yield* Effect.fail(
									new RssSubscriptionNotFoundError({ subscriptionId: id }),
								)
							}

							yield* rssSubscriptionPolicy.canDelete(id)

							yield* subscriptionRepo.softDelete(id)

							const txid = yield* generateTransactionId()

							return { transactionId: txid }
						}),
					)
					.pipe(withRemapDbErrors("RssSubscription", "delete")),
		}
	}),
)
