import {
	AttachmentRpcs,
	AuthMiddleware,
	BotRpcs,
	ChannelMemberRpcs,
	ChannelRpcs,
	ChannelSectionRpcs,
	ChannelWebhookRpcs,
	ChatSyncRpcs,
	ConnectShareRpcs,
	CustomEmojiRpcs,
	GitHubSubscriptionRpcs,
	IntegrationRequestRpcs,
	MessageReactionRpcs,
	MessageRpcs,
	NotificationRpcs,
	OrganizationMemberRpcs,
	OrganizationRpcs,
	PinnedMessageRpcs,
	RssSubscriptionRpcs,
	ScopeInjectionMiddleware,
	TypingIndicatorRpcs,
	UserPresenceStatusRpcs,
	UserRpcs,
} from "@hazel/domain/rpc"
import { CurrentUser } from "@hazel/domain"
import { UserPresenceStatus } from "@hazel/domain/models"
import { UserPresenceStatusResponse } from "@hazel/domain/rpc"
import type { TransactionId } from "@hazel/schema"
import { Effect, Layer } from "effect"
import { HttpRouter } from "effect/http"
import { RpcSerialization, RpcServer } from "effect/rpc"
import type { Dataset } from "../fixtures/dataset.ts"

/**
 * Fixture RPC backend: the real Effect RPC server (same groups, same NDJSON
 * serialization as `apps/backend`), but every handler answers from the dataset.
 * Encoding is therefore guaranteed to match what the frontends decode.
 */

const AllRpcs = MessageRpcs.merge(
	MessageReactionRpcs,
	NotificationRpcs,
	IntegrationRequestRpcs,
	TypingIndicatorRpcs,
	PinnedMessageRpcs,
	OrganizationRpcs,
	OrganizationMemberRpcs,
	UserRpcs,
	UserPresenceStatusRpcs,
)
	.merge(
		ChannelRpcs,
		ChannelMemberRpcs,
		ChannelSectionRpcs,
		ChannelWebhookRpcs,
		ConnectShareRpcs,
		GitHubSubscriptionRpcs,
		RssSubscriptionRpcs,
		AttachmentRpcs,
		BotRpcs,
		CustomEmojiRpcs,
	)
	.merge(ChatSyncRpcs)
	.middleware(ScopeInjectionMiddleware)

export interface RpcLog {
	readonly unmocked: Set<string>
}

const FIXTURE_TRANSACTION_ID = 1 as TransactionId

/**
 * Reads every screen needs, plus the background writes the app fires on its own
 * (presence heartbeats, clearing unread counts). Writes succeed without changing
 * fixture data, so captures stay identical.
 */
const defaultHandlers = (dataset: Dataset): Record<string, (payload: unknown) => unknown> => ({
	"user.me": () => new CurrentUser.Schema(dataset.currentUser),
	"userPresenceStatus.heartbeat": () => ({ lastSeenAt: dataset.now }),
	"userPresenceStatus.update": () => {
		const row = dataset.tables.user_presence_status?.find(
			(presence) => presence.userId === dataset.currentUser.id,
		)
		return new UserPresenceStatusResponse({
			data: UserPresenceStatus.Schema.make(row as never),
			transactionId: FIXTURE_TRANSACTION_ID,
		})
	},
	"channelMember.clearNotifications": () => ({ transactionId: FIXTURE_TRANSACTION_ID }),
	"organization.getBySlugPublic": () => null,
	"chatSync.connection.list": () => ({ data: [] }),
	...dataset.rpc,
})

export const makeRpcWebHandler = (dataset: Dataset, log: RpcLog) => {
	const canned = defaultHandlers(dataset)
	const handlers = Object.fromEntries(
		[...AllRpcs.requests.keys()].map((tag) => [
			tag,
			(payload: unknown) => {
				const respond = canned[tag]
				if (respond) return Effect.sync(() => respond(payload))
				log.unmocked.add(tag)
				return Effect.die(`ui-parity: no fixture for RPC "${tag}"`)
			},
		]),
	)

	const HandlersLive = AllRpcs.toLayer(handlers as never)

	const AuthLive = Layer.succeed(
		AuthMiddleware,
		AuthMiddleware.of((effect) =>
			Effect.provideService(effect, CurrentUser.Context, new CurrentUser.Schema(dataset.currentUser)),
		),
	)
	const ScopesLive = Layer.succeed(
		ScopeInjectionMiddleware,
		ScopeInjectionMiddleware.of((effect) => effect),
	)

	const RpcRoute = RpcServer.layerHttp({ group: AllRpcs, path: "/rpc", protocol: "http" }).pipe(
		Layer.provide([HandlersLive, AuthLive, ScopesLive, RpcSerialization.layerNdjson]),
	)

	return HttpRouter.toWebHandler(RpcRoute as never, { disableLogger: true })
}
