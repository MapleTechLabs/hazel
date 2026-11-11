/**
 * The public API for OAuth apps (Maple): the caller's organizations (directory `membership_index`
 * plus each `OrgObject`'s card), an org's channels, and channel webhooks, created by the same
 * `channelWebhook.create` RPC the app uses, in the channel's `OrgObject`.
 */
import { HttpApiBuilder } from "effect/http-api"
import { HttpServerRequest } from "effect/http"
import { CurrentUser, InternalServerError, UnauthorizedError } from "@hazel/domain"
import {
	ApiV1ChannelNotFoundError,
	ApiV1ChannelsListResponse,
	ApiV1ChannelWebhookCreatedResponse,
	ApiV1OrganizationNotFoundError,
	ApiV1OrganizationsListResponse,
} from "@hazel/domain/http"
import type { ChannelWebhookCreatedResponse } from "@hazel/domain/rpc"
import type { ChannelId } from "@hazel/schema"
import { Effect, Option } from "effect"
import { HazelApi } from "../../api"
import { Directory } from "../../services/directory"
import { OAuthBearerAuth } from "../../services/oauth-bearer-auth"
import { callObject } from "../../worker/objects/calls"
import { forwardRpc } from "../../worker/objects/forward"
import { orgTarget } from "../../worker/objects/kinds"
import { ListChannelsCall, OrganizationProfileCall } from "../../worker/objects/org/api-v1"
import { providePrincipal } from "../../worker/objects/principal"

const extractBearerToken = Effect.gen(function* () {
	const request = yield* HttpServerRequest.HttpServerRequest
	const authHeader = request.headers.authorization
	if (!authHeader || !authHeader.startsWith("Bearer ")) {
		return yield* new UnauthorizedError({
			message: "Missing bearer token",
			detail: "Authorization header must be 'Bearer <access_token>'",
		})
	}
	return authHeader.slice(7).trim()
})

const internal = (message: string) => (cause: unknown) =>
	Effect.fail(new InternalServerError({ message, cause }))

export const HttpApiV1IntegrationsLive = HttpApiBuilder.group(HazelApi, "api-v1-integrations", (handlers) =>
	Effect.gen(function* () {
		const auth = yield* OAuthBearerAuth
		const directory = yield* Directory

		const authenticate = Effect.gen(function* () {
			const token = yield* extractBearerToken
			return yield* auth.authenticate(token)
		})

		return handlers
			.handle("listOrganizations", () =>
				Effect.gen(function* () {
					const { currentUser } = yield* authenticate
					const organizations = yield* directory.organizationsOf(currentUser.id)
					const cards = yield* Effect.forEach(
						organizations,
						(organizationId) =>
							callObject(OrganizationProfileCall, orgTarget(organizationId), {}),
						{ concurrency: 8 },
					)
					return new ApiV1OrganizationsListResponse({
						data: cards.flatMap((card) => (card === null ? [] : [card])),
					})
				}).pipe(
					Effect.catchTags({
						DatabaseError: internal("Failed to list organizations"),
						ObjectCallError: internal("Failed to list organizations"),
					}),
					Effect.withSpan("ApiV1.listOrganizations"),
				),
			)
			.handle("listChannels", ({ params }) =>
				Effect.gen(function* () {
					const { currentUser } = yield* authenticate
					const notFound = new ApiV1OrganizationNotFoundError({
						organizationId: params.organizationId,
						message: "Organization not found or you are not a member",
					})
					const membership = yield* directory.membership(currentUser.id, params.organizationId)
					if (Option.isNone(membership) || membership.value.deletedAt !== null) {
						return yield* Effect.fail(notFound)
					}
					const channels = yield* callObject(ListChannelsCall, orgTarget(params.organizationId), {
						userId: currentUser.id,
					}).pipe(Effect.catchTag("UnauthorizedError", () => Effect.fail(notFound)))
					return new ApiV1ChannelsListResponse({ data: channels })
				}).pipe(
					Effect.catchTags({
						DatabaseError: internal("Failed to list channels"),
						ObjectCallError: internal("Failed to list channels"),
					}),
					Effect.withSpan("ApiV1.listChannels"),
				),
			)
			.handle("createChannelWebhook", ({ payload }) =>
				Effect.gen(function* () {
					const { currentUser } = yield* authenticate
					const notFound = new ApiV1ChannelNotFoundError({
						channelId: payload.channelId,
						message: "Channel not found",
					})
					const channel = yield* directory.channel(payload.channelId)
					if (Option.isNone(channel) || channel.value.deletedAt !== null) {
						return yield* Effect.fail(notFound)
					}
					const created = yield* forwardRpc<
						ChannelWebhookCreatedResponse,
						{ readonly _tag: "ChannelNotFoundError"; readonly channelId: ChannelId }
					>(orgTarget(channel.value.organizationId), "channelWebhook.create", {
						channelId: payload.channelId,
						name: payload.name,
						...(payload.description == null ? {} : { description: payload.description }),
						...(payload.avatarUrl == null ? {} : { avatarUrl: payload.avatarUrl }),
						...(payload.integrationProvider == null
							? {}
							: { integrationProvider: payload.integrationProvider }),
					}).pipe(
						providePrincipal({
							user:
								currentUser instanceof CurrentUser.Schema
									? currentUser
									: new CurrentUser.Schema(currentUser),
							botScopes: null,
						}),
						Effect.catchTag("ChannelNotFoundError", () => Effect.fail(notFound)),
					)
					return new ApiV1ChannelWebhookCreatedResponse({
						id: created.data.id,
						channelId: created.data.channelId,
						organizationId: created.data.organizationId,
						name: created.data.name,
						webhookUrl: created.webhookUrl,
						token: created.token,
					})
				}).pipe(
					Effect.catchTag("DatabaseError", internal("Failed to create channel webhook")),
					Effect.withSpan("ApiV1.createChannelWebhook"),
				),
			)
	}),
)
