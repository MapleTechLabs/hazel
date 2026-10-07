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
import { CurrentUser, SessionNotProvidedError } from "@hazel/domain"
import { TypingIndicator, UserPresenceStatus } from "@hazel/domain/models"
import {
	ChatSyncConnectionListResponse,
	TypingIndicatorResponse,
	UserPresenceStatusResponse,
} from "@hazel/domain/rpc"
import type { TransactionId } from "@hazel/schema"
import { Effect, Layer } from "effect"
import { HttpRouter } from "effect/http"
import { RpcSerialization, RpcServer } from "effect/rpc"
import type { Dataset } from "../fixtures/dataset.ts"
import { areaRpcHandlers } from "../scenarios.ts"
import { stableId } from "../fixtures/ids.ts"

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
	// Typing indicators are echoed back but never synced, so no indicator appears in captures.
	"typingIndicator.create": (payload) => {
		const { channelId, memberId, lastTyped } = payload as {
			channelId: string
			memberId: string
			lastTyped: number
		}
		return new TypingIndicatorResponse({
			data: TypingIndicator.Schema.make({
				id: stableId(`typing:${memberId}`),
				channelId,
				memberId,
				lastTyped,
			} as never),
			transactionId: FIXTURE_TRANSACTION_ID,
		})
	},
	"organization.getBySlugPublic": () => null,
	"chatSync.connection.list": () => new ChatSyncConnectionListResponse({ data: [] }),
	// Per-area handlers (`src/scenarios/<area>.ts`), then the dataset's own overrides.
	...areaRpcHandlers(dataset),
	...dataset.rpc,
})

export const makeRpcWebHandler = (dataset: Dataset, log: RpcLog) => {
	const canned = defaultHandlers(dataset)
	const handlers = Object.fromEntries(
		[...AllRpcs.requests.keys()].map((tag) => [
			tag,
			(payload: unknown) => {
				const respond = canned[tag]
				// A handler may return an Effect (e.g. `Effect.fail(new SomeTypedError(...))`) to fail with a typed error.
				if (respond)
					return Effect.suspend(() => {
						const result = respond(payload)
						return Effect.isEffect(result) ? result : Effect.succeed(result)
					})
				log.unmocked.add(tag)
				return Effect.die(`ui-parity: no fixture for RPC "${tag}"`)
			},
		]),
	)

	const HandlersLive = AllRpcs.toLayer(handlers as never)

	const AuthLive = Layer.succeed(
		AuthMiddleware,
		AuthMiddleware.of((effect) =>
			// Signed-out datasets send no bearer token, so authenticated RPCs fail like the real backend.
			dataset.signedOut
				? Effect.fail(
						new SessionNotProvidedError({
							message: "No session",
							detail: "ui-parity: signed out",
						}),
					)
				: Effect.provideService(
						effect,
						CurrentUser.Context,
						new CurrentUser.Schema(dataset.currentUser),
					),
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
