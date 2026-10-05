import { createHash, randomBytes } from "node:crypto"
import { HttpApiBuilder } from "effect/http-api"
import { HttpServerRequest } from "effect/http"
import { ChannelRepo, ChannelWebhookRepo, OrganizationMemberRepo } from "@hazel/backend-core"
import { and, Database, eq, isNull, schema } from "@hazel/db"
import { CurrentUser, InternalServerError, UnauthorizedError } from "@hazel/domain"
import {
	ApiV1ChannelNotFoundError,
	ApiV1ChannelsListResponse,
	ApiV1ChannelWebhookCreatedResponse,
	ApiV1OrganizationNotFoundError,
	ApiV1OrganizationsListResponse,
} from "@hazel/domain/http"
import { CurrentRpcScopes, type ApiScope } from "@hazel/domain/scopes"
import type { ChannelWebhookId } from "@hazel/schema"
import { Effect, Option } from "effect"
import { HazelApi } from "../../api"
import { ChannelWebhookPolicy } from "../../policies/channel-webhook-policy"
import { IntegrationBotService } from "../../services/integrations/integration-bot-service"
import { OAuthBearerAuth } from "../../services/oauth-bearer-auth"
import { WebhookBotService } from "../../services/webhook-bot-service"

const REQUIRED_SCOPES: ReadonlyArray<ApiScope> = ["channel-webhooks:write"]

const withHttpScopes = <A, E, R>(
	scopes: ReadonlyArray<ApiScope>,
	make: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> => Effect.provideService(make, CurrentRpcScopes, scopes) as Effect.Effect<A, E, R>

const extractBearerToken = Effect.gen(function* () {
	const request = yield* HttpServerRequest.HttpServerRequest
	const authHeader = request.headers.authorization
	if (!authHeader || !authHeader.startsWith("Bearer ")) {
		return yield* Effect.fail(
			new UnauthorizedError({
				message: "Missing bearer token",
				detail: "Authorization header must be 'Bearer <access_token>'",
			}),
		)
	}
	return authHeader.slice(7).trim()
})

const generateWebhookToken = () => {
	const token = randomBytes(32).toString("hex")
	const tokenHash = createHash("sha256").update(token).digest("hex")
	const tokenSuffix = token.slice(-4)
	return { token, tokenHash, tokenSuffix }
}

const buildWebhookUrl = (webhookId: string, token: string) => {
	const baseUrl = process.env.API_BASE_URL ?? "http://localhost:3010"
	return `${baseUrl}/webhooks/incoming/${webhookId}/${token}`
}

export const HttpApiV1IntegrationsLive = HttpApiBuilder.group(HazelApi, "api-v1-integrations", (handlers) =>
	Effect.gen(function* () {
		const auth = yield* OAuthBearerAuth
		const db = yield* Database.Database
		const memberRepo = yield* OrganizationMemberRepo
		const webhookPolicy = yield* ChannelWebhookPolicy

		const authenticate = Effect.gen(function* () {
			const token = yield* extractBearerToken
			return yield* auth.authenticate(token)
		})

		return handlers
			.handle("listOrganizations", () =>
				Effect.gen(function* () {
					const { currentUser } = yield* authenticate

					const rows = yield* db
						.makeQuery((execute, userId: typeof currentUser.id) =>
							execute((client) =>
								client
									.select({
										id: schema.organizationsTable.id,
										name: schema.organizationsTable.name,
										slug: schema.organizationsTable.slug,
										logoUrl: schema.organizationsTable.logoUrl,
									})
									.from(schema.organizationMembersTable)
									.innerJoin(
										schema.organizationsTable,
										eq(
											schema.organizationsTable.id,
											schema.organizationMembersTable.organizationId,
										),
									)
									.where(
										and(
											eq(schema.organizationMembersTable.userId, userId),
											isNull(schema.organizationMembersTable.deletedAt),
											isNull(schema.organizationsTable.deletedAt),
										),
									),
							),
						)(currentUser.id)
						.pipe(
							Effect.catchTag("DatabaseError", (err) =>
								Effect.fail(
									new InternalServerError({
										message: "Failed to list organizations",
										detail: String(err),
									}),
								),
							),
						)

					return new ApiV1OrganizationsListResponse({
						data: rows.map((row) => ({
							id: row.id,
							name: row.name,
							slug: row.slug,
							logoUrl: row.logoUrl,
						})),
					})
				}),
			)
			.handle("listChannels", ({ params }) =>
				Effect.gen(function* () {
					const { currentUser } = yield* authenticate

					const membership = yield* memberRepo
						.findByOrgAndUser(params.organizationId, currentUser.id)
						.pipe(
							Effect.catchTag("DatabaseError", (err) =>
								Effect.fail(
									new InternalServerError({
										message: "Failed to verify organization membership",
										detail: String(err),
									}),
								),
							),
						)

					if (Option.isNone(membership)) {
						return yield* Effect.fail(
							new ApiV1OrganizationNotFoundError({
								organizationId: params.organizationId,
								message: "Organization not found or you are not a member",
							}),
						)
					}

					const rows = yield* db
						.makeQuery((execute, orgId: typeof params.organizationId) =>
							execute((client) =>
								client
									.select({
										id: schema.channelsTable.id,
										name: schema.channelsTable.name,
										type: schema.channelsTable.type,
										organizationId: schema.channelsTable.organizationId,
									})
									.from(schema.channelsTable)
									.where(
										and(
											eq(schema.channelsTable.organizationId, orgId),
											isNull(schema.channelsTable.deletedAt),
										),
									),
							),
						)(params.organizationId)
						.pipe(
							Effect.catchTag("DatabaseError", (err) =>
								Effect.fail(
									new InternalServerError({
										message: "Failed to list channels",
										detail: String(err),
									}),
								),
							),
						)

					return new ApiV1ChannelsListResponse({
						data: rows
							.filter((row) => row.type === "public" || row.type === "private")
							.map((row) => ({
								id: row.id,
								name: row.name,
								type: row.type,
								organizationId: row.organizationId,
							})),
					})
				}),
			)
			.handle("createChannelWebhook", ({ payload }) =>
				withHttpScopes(
					REQUIRED_SCOPES,
					Effect.gen(function* () {
						const { currentUser } = yield* authenticate
						const channelRepo = yield* ChannelRepo
						const webhookRepo = yield* ChannelWebhookRepo
						const webhookBotService = yield* WebhookBotService
						const integrationBotService = yield* IntegrationBotService

						const result = yield* db
							.transaction(
								Effect.gen(function* () {
									const channelOption = yield* channelRepo.findById(payload.channelId)
									if (Option.isNone(channelOption)) {
										return yield* Effect.fail(
											new ApiV1ChannelNotFoundError({
												channelId: payload.channelId,
												message: "Channel not found",
											}),
										)
									}
									const channel = channelOption.value

									const { token, tokenHash, tokenSuffix } = generateWebhookToken()

									const botUser = yield* Option.fromNullishOr(
										payload.integrationProvider,
									).pipe(
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
												integrationBotService.getOrCreateWebhookBotUser(
													provider,
													channel.organizationId,
												),
										}),
									)

									yield* webhookPolicy.canCreate(payload.channelId)

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
										createdBy: currentUser.id,
										lastUsedAt: null,
										deletedAt: null,
									})

									return { webhook, token }
								}),
							)
							.pipe(
								Effect.catchTags({
									DatabaseError: (err) =>
										Effect.fail(
											new InternalServerError({
												message: "Failed to create channel webhook",
												detail: String(err),
											}),
										),
									SchemaError: (err) =>
										Effect.fail(
											new InternalServerError({
												message: "Schema validation failed",
												detail: String(err),
											}),
										),
								}),
								Effect.provideService(CurrentUser.Context, currentUser),
							)

						return new ApiV1ChannelWebhookCreatedResponse({
							id: result.webhook.id,
							channelId: result.webhook.channelId,
							organizationId: result.webhook.organizationId,
							name: result.webhook.name,
							webhookUrl: buildWebhookUrl(result.webhook.id, result.token),
							token: result.token,
						})
					}),
				),
			)
	}),
)
