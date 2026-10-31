/**
 * The public bot API for bots that live outside Hazel (`@hazel/domain/http` `api-v1-bots`):
 * redeeming an install grant in the `OrgObject` its code names, opening a thread through
 * `channel.createThread` in the channel's org, and the org's user lookup. Each runs as the bot
 * authenticated by its token (`./bot-auth.ts`).
 */
import { HttpApiBuilder } from "effect/http-api"
import {
	InternalServerError,
	InvalidChannelRequestError,
	MessageNotFoundError,
	NestedThreadError,
	UnauthorizedError,
} from "@hazel/domain"
import {
	BotInstallGrantInvalidError,
	BotInstallRedeemedResponse,
	ChannelNotFoundError,
	ApiV1UsersResponse,
	ThreadResponse,
} from "@hazel/domain/http"
import { type ChannelResponse, CreateThreadRequest } from "@hazel/domain/rpc"
import { UserId } from "@hazel/schema"
import { Effect, Option, Schema } from "effect"
import { HazelApi } from "../../api"
import { Directory } from "../../services/directory"
import { checkMessageRateLimit } from "../../services/rate-limit-helpers"
import { callObject } from "../../worker/objects/calls"
import { forwardRpc } from "../../worker/objects/forward"
import { channelTarget, orgTarget } from "../../worker/objects/kinds"
import { MessageThreadCall } from "../../worker/objects/channel/api-messages"
import {
	hashInstallCode,
	ORGANIZATION_USERS_MAX_IDS,
	organizationOfInstallCode,
	OrganizationUsersCall,
	RedeemBotInstallGrantCall,
} from "../../worker/objects/org/bot-install-grants"
import { providePrincipal } from "../../worker/objects/principal"
import { authenticateBotFromToken, botPrincipal } from "./bot-auth"

const internal = (message: string) => (cause: unknown) =>
	Effect.logError(message, { cause }).pipe(
		Effect.andThen(Effect.fail(new InternalServerError({ message, cause }))),
	)

/** Each id on its own: a malformed one is left out like an unknown one, not the whole lookup. */
const isUserId = Schema.is(UserId)

export const HttpApiV1BotsLive = HttpApiBuilder.group(HazelApi, "api-v1-bots", (handlers) =>
	Effect.succeed(
		handlers
			.handle("redeemBotInstall", ({ payload }) =>
				Effect.gen(function* () {
					const bot = yield* authenticateBotFromToken
					const organizationId = organizationOfInstallCode(payload.code)
					if (Option.isNone(organizationId)) {
						return yield* new BotInstallGrantInvalidError({
							message: "The install code is invalid, expired or already used",
						})
					}
					const redeemed = yield* callObject(
						RedeemBotInstallGrantCall,
						orgTarget(organizationId.value),
						{
							botId: bot.id,
							codeHash: yield* hashInstallCode(payload.code),
							redirectUri: payload.redirectUri,
						},
					)
					return new BotInstallRedeemedResponse(redeemed)
				}).pipe(
					Effect.catchTags({
						DatabaseError: internal("Database error while redeeming a bot install"),
						ObjectCallError: internal("The organization is unavailable"),
					}),
					Effect.withSpan("ApiV1.redeemBotInstall"),
				),
			)
			.handle("createThread", ({ params, payload }) =>
				Effect.gen(function* () {
					const bot = yield* authenticateBotFromToken
					yield* checkMessageRateLimit(bot.userId)
					const index = yield* (yield* Directory).channel(params.channelId)
					if (Option.isNone(index) || index.value.deletedAt !== null) {
						return yield* new ChannelNotFoundError({ channelId: params.channelId })
					}
					const organizationId = index.value.organizationId
					const host = channelTarget(index.value.hostChannelId ?? params.channelId)
					const existing = yield* callObject(MessageThreadCall, host, {
						userId: bot.userId,
						messageId: payload.messageId,
					})
					if (existing !== null) {
						return new ThreadResponse({
							data: { id: existing, parentChannelId: params.channelId, organizationId },
						})
					}
					// No id: `channel.createThread` derives one from the message, so racing calls open one.
					const response = yield* forwardRpc<
						ChannelResponse,
						| MessageNotFoundError
						| NestedThreadError
						| InvalidChannelRequestError
						| UnauthorizedError
					>(
						orgTarget(organizationId),
						"channel.createThread",
						new CreateThreadRequest({
							messageId: payload.messageId,
							channelId: params.channelId,
							organizationId,
						}),
					).pipe(providePrincipal(botPrincipal(bot)))
					return new ThreadResponse({
						data: { id: response.data.id, parentChannelId: params.channelId, organizationId },
					})
				}).pipe(
					Effect.catchTags({
						DatabaseError: internal("Database error while creating a thread"),
						ObjectCallError: internal("The channel is unavailable"),
						// The message is not in this channel, or is itself in a thread.
						MessageNotFoundError: () =>
							Effect.fail(new ChannelNotFoundError({ channelId: params.channelId })),
						NestedThreadError: () =>
							Effect.fail(new ChannelNotFoundError({ channelId: params.channelId })),
						InvalidChannelRequestError: () =>
							Effect.fail(new ChannelNotFoundError({ channelId: params.channelId })),
					}),
					Effect.withSpan("ApiV1.createThread"),
				),
			)
			.handle("listOrganizationUsers", ({ params, query }) =>
				Effect.gen(function* () {
					const bot = yield* authenticateBotFromToken
					const raw = query.ids
						.split(",")
						.map((id) => id.trim())
						.filter((id) => id.length > 0)
					const ids = [...new Set(raw)].filter(isUserId)
					const users = yield* callObject(OrganizationUsersCall, orgTarget(params.organizationId), {
						botId: bot.id,
						botUserId: bot.userId,
						ids: ids.slice(0, ORGANIZATION_USERS_MAX_IDS),
					})
					return new ApiV1UsersResponse({ data: users })
				}).pipe(
					Effect.catchTags({
						DatabaseError: internal("Database error while listing users"),
						ObjectCallError: internal("The organization is unavailable"),
					}),
					Effect.withSpan("ApiV1.listOrganizationUsers"),
				),
			),
	),
)
