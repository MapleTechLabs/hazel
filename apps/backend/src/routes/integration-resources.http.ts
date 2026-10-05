import { HttpApiBuilder } from "effect/http-api"
import { IntegrationConnectionRepo } from "@hazel/backend-core"
import { InternalServerError } from "@hazel/domain"
import type { ExternalChannelId, OrganizationId } from "@hazel/schema"
import {
	DiscordGuildChannelsResponse,
	DiscordGuildsResponse,
	GitHubPRResourceResponse,
	GitHubRepositoriesResponse,
	IntegrationNotConnectedForPreviewError,
	IntegrationResourceError,
	LinearIssueResourceResponse,
	ResourceNotFoundError,
} from "@hazel/domain/http"
import { Discord, GitHub } from "@hazel/integrations"
import { Config, Effect, Option, Redacted } from "effect"
import { HazelApi } from "../api"
import { IntegrationTokenService, TokenNotFoundError } from "../services/integration-token-service"
import {
	fetchLinearIssue,
	type LinearApiError,
	type LinearIssueNotFoundError,
	type LinearRateLimitError,
	parseLinearIssueUrl,
} from "../services/integrations/linear-resource-provider"

const prToResponse = (pr: GitHub.GitHubPR) =>
	new GitHubPRResourceResponse({
		owner: pr.owner,
		repo: pr.repo,
		number: pr.number,
		title: pr.title,
		body: pr.body,
		state: pr.state,
		draft: pr.draft,
		merged: pr.merged,
		author: pr.author,
		additions: pr.additions,
		deletions: pr.deletions,
		headRefName: pr.headRefName,
		updatedAt: pr.updatedAt,
		labels: pr.labels,
	})

export const HttpIntegrationResourceLive = HttpApiBuilder.group(
	HazelApi,
	"integration-resources",
	(handlers) =>
		handlers
			.handle("fetchLinearIssue", ({ params, query }) =>
				Effect.gen(function* () {
					const { orgId } = params
					const { url } = query

					// Parse the Linear issue URL
					const parsed = parseLinearIssueUrl(url)
					if (!parsed) {
						return yield* Effect.fail(
							new ResourceNotFoundError({
								url,
								message: "Invalid Linear issue URL format",
							}),
						)
					}

					// Check if organization has Linear connected
					const connectionRepo = yield* IntegrationConnectionRepo
					const connectionOption = yield* connectionRepo.findByOrgAndProvider(orgId, "linear")

					if (Option.isNone(connectionOption)) {
						return yield* Effect.fail(
							new IntegrationNotConnectedForPreviewError({ provider: "linear" }),
						)
					}

					const connection = connectionOption.value

					// Check if connection is active
					if (connection.status !== "active") {
						return yield* Effect.fail(
							new IntegrationNotConnectedForPreviewError({ provider: "linear" }),
						)
					}

					// Get valid access token
					const tokenService = yield* IntegrationTokenService
					const accessToken = yield* tokenService.getValidAccessToken(connection.id)

					// Fetch issue from Linear API
					const issue = yield* fetchLinearIssue(parsed.issueKey, accessToken)

					// Transform to response
					return new LinearIssueResourceResponse({
						id: issue.id,
						identifier: issue.identifier,
						title: issue.title,
						description: issue.description,
						url: issue.url,
						teamName: issue.teamName,
						state: issue.state,
						assignee: issue.assignee,
						priority: issue.priority,
						priorityLabel: issue.priorityLabel,
						labels: issue.labels,
					})
				}).pipe(
					Effect.tapError((error) =>
						Effect.logError("Linear issue fetch failed").pipe(
							Effect.annotateLogs({ error: String(error), errorType: error._tag }),
						),
					),
					Effect.catchTags({
						TokenNotFoundError: () =>
							Effect.fail(new IntegrationNotConnectedForPreviewError({ provider: "linear" })),
						LinearApiError: (error: LinearApiError) =>
							Effect.fail(
								new IntegrationResourceError({
									url: query.url,
									message: error.message,
									provider: "linear",
								}),
							),
						LinearRateLimitError: (error: LinearRateLimitError) =>
							Effect.fail(
								new IntegrationResourceError({
									url: query.url,
									message: error.retryAfter
										? `Rate limit exceeded. Try again in ${error.retryAfter} seconds.`
										: error.message,
									provider: "linear",
								}),
							),
						LinearIssueNotFoundError: (error: LinearIssueNotFoundError) =>
							Effect.fail(
								new ResourceNotFoundError({
									url: query.url,
									message: `Issue not found: ${error.issueId}`,
								}),
							),
						DatabaseError: (error) =>
							Effect.fail(
								new InternalServerError({
									message: "Database error while fetching integration",
									detail: String(error),
								}),
							),
						// When token decryption fails, prompt user to reconnect instead of showing 500 error
						IntegrationEncryptionError: () =>
							Effect.fail(new IntegrationNotConnectedForPreviewError({ provider: "linear" })),
						KeyVersionNotFoundError: () =>
							Effect.fail(new IntegrationNotConnectedForPreviewError({ provider: "linear" })),
						TokenRefreshError: () =>
							Effect.fail(new IntegrationNotConnectedForPreviewError({ provider: "linear" })),
						ConnectionNotFoundError: () =>
							Effect.fail(new IntegrationNotConnectedForPreviewError({ provider: "linear" })),
					}),
				),
			)
			.handle("fetchGitHubPR", ({ params, query }) =>
				Effect.gen(function* () {
					const { orgId } = params
					const { url } = query

					// Parse the GitHub PR URL
					const parsed = GitHub.parseGitHubPRUrl(url)
					if (!parsed) {
						return yield* Effect.fail(
							new ResourceNotFoundError({
								url,
								message: "Invalid GitHub PR URL format",
							}),
						)
					}

					const gitHubApiClient = yield* GitHub.GitHubApiClient

					// Phase 1: Try authenticated fetch
					const authenticatedResult = yield* Effect.gen(function* () {
						const connectionRepo = yield* IntegrationConnectionRepo
						const connectionOption = yield* connectionRepo.findByOrgAndProvider(orgId, "github")

						if (Option.isNone(connectionOption)) {
							return Option.none<GitHub.GitHubPR>()
						}

						const connection = connectionOption.value

						if (connection.status !== "active") {
							return Option.none<GitHub.GitHubPR>()
						}

						const tokenService = yield* IntegrationTokenService
						const accessToken = yield* tokenService.getValidAccessToken(connection.id)

						const pr = yield* gitHubApiClient.fetchPR(
							parsed.owner,
							parsed.repo,
							parsed.number,
							accessToken,
						)

						return Option.some(pr)
					}).pipe(
						// Auth worked but PR genuinely not found — propagate immediately
						Effect.catchTag("GitHubPRNotFoundError", (error) =>
							Effect.fail(
								new ResourceNotFoundError({
									url: query.url,
									message: `PR not found: ${error.owner}/${error.repo}#${error.number}`,
								}),
							),
						),
						// Auth worked but API error — propagate immediately
						Effect.catchTag("GitHubApiError", (error) =>
							Effect.fail(
								new IntegrationResourceError({
									url: query.url,
									message: error.message,
									provider: "github",
								}),
							),
						),
						Effect.catchTag("GitHubRateLimitError", (error) =>
							Effect.fail(
								new IntegrationResourceError({
									url: query.url,
									message: error.retryAfter
										? `Rate limit exceeded. Try again in ${error.retryAfter} seconds.`
										: error.message,
									provider: "github",
								}),
							),
						),
						// Auth-related failures — fall through to public API
						Effect.catchTags({
							TokenNotFoundError: () => Effect.succeed(Option.none<GitHub.GitHubPR>()),
							IntegrationEncryptionError: () => Effect.succeed(Option.none<GitHub.GitHubPR>()),
							KeyVersionNotFoundError: () => Effect.succeed(Option.none<GitHub.GitHubPR>()),
							TokenRefreshError: () => Effect.succeed(Option.none<GitHub.GitHubPR>()),
							ConnectionNotFoundError: () => Effect.succeed(Option.none<GitHub.GitHubPR>()),
							DatabaseError: () => Effect.succeed(Option.none<GitHub.GitHubPR>()),
						}),
					)

					if (Option.isSome(authenticatedResult)) {
						return prToResponse(authenticatedResult.value)
					}

					// Phase 2: Try public API fallback
					const pr = yield* gitHubApiClient
						.fetchPRPublic(parsed.owner, parsed.repo, parsed.number)
						.pipe(
							// 404 on public API = private repo or not found; show "Connect GitHub"
							Effect.catchTag("GitHubPRNotFoundError", () =>
								Effect.fail(
									new IntegrationNotConnectedForPreviewError({ provider: "github" }),
								),
							),
							Effect.catchTag("GitHubRateLimitError", (error) =>
								Effect.fail(
									new IntegrationResourceError({
										url: query.url,
										message: error.message,
										provider: "github",
									}),
								),
							),
							Effect.catchTag("GitHubApiError", (error) =>
								Effect.fail(
									new IntegrationResourceError({
										url: query.url,
										message: error.message,
										provider: "github",
									}),
								),
							),
						)

					return prToResponse(pr)
				}).pipe(
					Effect.tapError((error) =>
						Effect.logError("GitHub PR fetch failed").pipe(
							Effect.annotateLogs({ error: String(error), errorType: error._tag }),
						),
					),
				),
			)
			.handle("getGitHubRepositories", ({ params, query }) =>
				handleGetGitHubRepositories(params, query).pipe(
					Effect.catchTags({
						DatabaseError: (error) =>
							Effect.fail(
								new InternalServerError({
									message: "Failed to fetch GitHub repositories",
									detail: String(error),
								}),
							),
						TokenNotFoundError: () =>
							Effect.fail(new IntegrationNotConnectedForPreviewError({ provider: "github" })),
						IntegrationEncryptionError: () =>
							Effect.fail(new IntegrationNotConnectedForPreviewError({ provider: "github" })),
						KeyVersionNotFoundError: () =>
							Effect.fail(new IntegrationNotConnectedForPreviewError({ provider: "github" })),
						TokenRefreshError: () =>
							Effect.fail(new IntegrationNotConnectedForPreviewError({ provider: "github" })),
						ConnectionNotFoundError: () =>
							Effect.fail(new IntegrationNotConnectedForPreviewError({ provider: "github" })),
					}),
				),
			)
			.handle("getDiscordGuilds", ({ params }) =>
				handleGetDiscordGuilds(params).pipe(
					Effect.catchTags({
						DatabaseError: (error) =>
							Effect.fail(
								new InternalServerError({
									message: "Failed to fetch Discord guilds",
									detail: String(error),
								}),
							),
						TokenNotFoundError: () =>
							Effect.fail(new IntegrationNotConnectedForPreviewError({ provider: "discord" })),
						IntegrationEncryptionError: () =>
							Effect.fail(new IntegrationNotConnectedForPreviewError({ provider: "discord" })),
						KeyVersionNotFoundError: () =>
							Effect.fail(new IntegrationNotConnectedForPreviewError({ provider: "discord" })),
						TokenRefreshError: () =>
							Effect.fail(new IntegrationNotConnectedForPreviewError({ provider: "discord" })),
						ConnectionNotFoundError: () =>
							Effect.fail(new IntegrationNotConnectedForPreviewError({ provider: "discord" })),
					}),
				),
			)
			.handle("getDiscordGuildChannels", ({ params }) =>
				handleGetDiscordGuildChannels(params).pipe(
					Effect.catchTags({
						DatabaseError: (error) =>
							Effect.fail(
								new InternalServerError({
									message: "Failed to fetch Discord channels",
									detail: String(error),
								}),
							),
						ConfigError: (error) =>
							Effect.fail(
								new InternalServerError({
									message: "Discord bot token not configured",
									detail: String(error),
								}),
							),
					}),
				),
			),
)

/**
 * Get GitHub repositories accessible to the GitHub App installation.
 */
const handleGetGitHubRepositories = Effect.fn("integration-resources.getGitHubRepositories")(function* (
	path: { orgId: OrganizationId },
	query: { page?: number; perPage?: number },
) {
	const { orgId } = path
	const page = query.page ?? 1
	const perPage = query.perPage ?? 30

	const connectionRepo = yield* IntegrationConnectionRepo
	const tokenService = yield* IntegrationTokenService

	// Check if organization has GitHub connected
	const connectionOption = yield* connectionRepo.findByOrgAndProvider(orgId, "github")

	if (Option.isNone(connectionOption)) {
		return yield* Effect.fail(new IntegrationNotConnectedForPreviewError({ provider: "github" }))
	}

	const connection = connectionOption.value

	// Check if connection is active
	if (connection.status !== "active") {
		return yield* Effect.fail(new IntegrationNotConnectedForPreviewError({ provider: "github" }))
	}

	// Get valid access token
	const accessToken = yield* tokenService.getValidAccessToken(connection.id)

	// Fetch repositories from GitHub API using GitHubApiClient
	const gitHubApiClient = yield* GitHub.GitHubApiClient
	const result = yield* gitHubApiClient.fetchRepositories(accessToken, page, perPage).pipe(
		Effect.mapError(
			(error) =>
				new InternalServerError({
					message: "Failed to fetch GitHub repositories",
					detail: error.message,
				}),
		),
	)

	// Transform to response format
	return new GitHubRepositoriesResponse({
		totalCount: result.totalCount,
		repositories: result.repositories.map((repo) => ({
			id: repo.id,
			name: repo.name,
			fullName: repo.fullName,
			private: repo.private,
			htmlUrl: repo.htmlUrl,
			description: repo.description,
			owner: {
				login: repo.owner.login,
				avatarUrl: repo.owner.avatarUrl,
			},
		})),
		hasNextPage: result.hasNextPage,
		page: result.page,
		perPage: result.perPage,
	})
})

const getActiveDiscordConnection = Effect.fn("integration-resources.getActiveDiscordConnection")(function* (
	orgId: OrganizationId,
) {
	const connectionRepo = yield* IntegrationConnectionRepo
	const connectionOption = yield* connectionRepo.findByOrgAndProvider(orgId, "discord")

	if (Option.isNone(connectionOption)) {
		return yield* Effect.fail(new IntegrationNotConnectedForPreviewError({ provider: "discord" }))
	}

	const connection = connectionOption.value
	if (connection.status !== "active") {
		return yield* Effect.fail(new IntegrationNotConnectedForPreviewError({ provider: "discord" }))
	}

	return connection
})

const handleGetDiscordGuilds = Effect.fn("integration-resources.getDiscordGuilds")(function* (path: {
	orgId: OrganizationId
}) {
	const { orgId } = path
	const tokenService = yield* IntegrationTokenService
	const connection = yield* getActiveDiscordConnection(orgId)
	const accessToken = yield* tokenService.getValidAccessToken(connection.id)

	const discordApiClient = yield* Discord.DiscordApiClient
	const guilds = yield* discordApiClient.listGuilds(accessToken).pipe(
		Effect.mapError(
			(error) =>
				new IntegrationResourceError({
					url: "discord://guilds",
					message: error.message,
					provider: "discord",
				}),
		),
	)

	return new DiscordGuildsResponse({ guilds })
})

const handleGetDiscordGuildChannels = Effect.fn("integration-resources.getDiscordGuildChannels")(
	function* (path: { orgId: OrganizationId; guildId: string }) {
		const { orgId, guildId } = path
		yield* getActiveDiscordConnection(orgId)

		const botToken = yield* Config.Redacted("DISCORD_BOT_TOKEN")
		const discordApiClient = yield* Discord.DiscordApiClient
		const channels = yield* discordApiClient.listGuildChannels(guildId, Redacted.value(botToken)).pipe(
			Effect.mapError(
				(error) =>
					new IntegrationResourceError({
						url: `discord://guilds/${guildId}/channels`,
						message: error.message,
						provider: "discord",
					}),
			),
		)

		return new DiscordGuildChannelsResponse({
			channels: channels.map((c) => ({
				...c,
				id: c.id as ExternalChannelId,
			})),
		})
	},
)
