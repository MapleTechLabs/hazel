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
import { Effect, Option } from "effect"
import { generateTransactionId } from "../../lib/create-transactionId"
import { requestOrganizationId } from "../../worker/objects/org/organization"
import { RssSubscriptionPolicy } from "../../policies/rss-subscription-policy"
import { WebhookBotService } from "../../services/webhook-bot-service"
import { fetchFeed } from "../../worker/objects/org/rss"

/**
 * RSS subscription RPC handlers. Run in the `OrgObject` (`rpc/routing.ts`), which also polls the
 * feeds on its alarm (`worker/objects/org/rss.ts`).
 */
export const RssSubscriptionRpcLive = RssSubscriptionRpcs.toLayer(
	Effect.gen(function* () {
		const db = yield* Database.Database
		const channelRepo = yield* ChannelRepo
		const subscriptionRepo = yield* RssSubscriptionRepo
		const webhookBotService = yield* WebhookBotService
		const rssSubscriptionPolicy = yield* RssSubscriptionPolicy

		return {
			"rssSubscription.create": (payload) =>
				Effect.gen(function* () {
					yield* rssSubscriptionPolicy.canCreate(payload.channelId)
					// Test-fetch the feed before the transaction (no network inside one).
					const feed = yield* fetchFeed(payload.feedUrl).pipe(
						Effect.mapError(
							(error) =>
								new RssFeedValidationError({
									feedUrl: payload.feedUrl,
									message: error.message,
								}),
						),
					)
					return yield* db.transaction(
						Effect.gen(function* () {
							const user = yield* CurrentUser.Context

							const channelOption = yield* channelRepo.findById(payload.channelId)
							if (Option.isNone(channelOption)) {
								return yield* new ChannelNotFoundError({ channelId: payload.channelId })
							}
							const channel = channelOption.value

							const existingOption = yield* subscriptionRepo.findByChannelAndFeedUrl(
								payload.channelId,
								payload.feedUrl,
							)
							if (Option.isSome(existingOption)) {
								return yield* new RssSubscriptionExistsError({
									channelId: payload.channelId,
									feedUrl: payload.feedUrl,
								})
							}

							const [subscription] = yield* subscriptionRepo.insert({
								channelId: payload.channelId,
								organizationId: channel.organizationId,
								feedUrl: payload.feedUrl,
								feedTitle: feed.metadata.title,
								feedIconUrl: feed.metadata.iconUrl,
								isEnabled: true,
								pollingIntervalMinutes: payload.pollingIntervalMinutes ?? 15,
								createdBy: user.id,
								deletedAt: null,
							})

							// The shared RSS bot authors the posts; it must be in this org.
							yield* webhookBotService.getOrCreateIntegrationBot("rss", channel.organizationId)

							const txid = yield* generateTransactionId()

							return new RssSubscriptionResponse({
								data: subscription,
								transactionId: txid,
							})
						}),
					)
				}).pipe(withRemapDbErrors("RssSubscription", "create")),

			"rssSubscription.list": ({ channelId }) =>
				Effect.gen(function* () {
					yield* rssSubscriptionPolicy.canRead(channelId)
					const subscriptions = yield* subscriptionRepo.findByChannel(channelId)

					return new RssSubscriptionListResponse({ data: subscriptions })
				}).pipe(withRemapDbErrors("RssSubscription", "select")),

			"rssSubscription.listByOrganization": () =>
				Effect.gen(function* () {
					const requested = yield* requestOrganizationId
					if (Option.isNone(requested)) {
						return new RssSubscriptionListResponse({ data: [] })
					}
					const organizationId = requested.value

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
