import { HttpApiBuilder } from "effect/http-api"
import { CurrentUser, InternalServerError, UnauthorizedError } from "@hazel/domain"
import type { ExternalChannelId, OrganizationId } from "@hazel/schema"
import {
	DiscordGuildChannelsResponse,
	DiscordGuildsResponse,
	SlackChannelsResponse,
	GitHubPRResourceResponse,
	GitHubRepositoriesResponse,
	IntegrationNotConnectedForPreviewError,
	IntegrationResourceError,
	LinearIssueResourceResponse,
	ResourceNotFoundError,
} from "@hazel/domain/http"
import { Discord, GitHub, Slack } from "@hazel/integrations"
import { Config, Effect, Option, Redacted } from "effect"
import { HazelApi } from "../api"
import { Directory } from "../services/directory"
import { callObject } from "../worker/objects/calls"
import { orgTarget } from "../worker/objects/kinds"
import { IntegrationAccessTokenCall } from "../worker/objects/org/integrations"
import {
	fetchLinearIssue,
	type LinearApiError,
	type LinearIssueNotFoundError,
	type LinearRateLimitError,
	parseLinearIssueUrl,
} from "../services/integrations/linear-resource-provider"

type Provider = typeof IntegrationAccessTokenCall.payload.Type.provider

/** The caller must be an active member of `orgId` before anything uses the org's tokens. */
export const requireMember = Effect.fn("IntegrationResources.requireMember")(function* (
	orgId: OrganizationId,
) {
	const user = yield* CurrentUser.Context
	const membership = yield* Effect.flatMap(Directory, (directory) =>
		directory.membership(user.id, orgId),
	).pipe(
		Effect.catchTag("DatabaseError", (error) =>
			Effect.fail(new InternalServerError({ message: "Membership lookup failed", cause: error })),
		),
	)
	if (Option.isNone(membership) || membership.value.deletedAt !== null) {
		return yield* new UnauthorizedError({
			message: "You are not a member of this organization",
			detail: `organizationId=${orgId}`,
		})
	}
})

/** The org's token for `provider`, from its `OrgObject`; null when none is usable. */
const tokenOf = (orgId: OrganizationId, provider: Provider) =>
	requireMember(orgId).pipe(
		Effect.andThen(callObject(IntegrationAccessTokenCall, orgTarget(orgId), { provider })),
		// A token that cannot be refreshed or decrypted: prompt a reconnect.
		Effect.catchTag("IntegrationTokenUnavailableError", () => Effect.succeed(null)),
		Effect.map((token) => (token === null ? null : token.accessToken)),
	)

/** As `tokenOf`, failing when the org has no usable connection. */
const requireToken = (orgId: OrganizationId, provider: Provider) =>
	tokenOf(orgId, provider).pipe(
		Effect.flatMap((token) =>
			token === null
				? Effect.fail(new IntegrationNotConnectedForPreviewError({ provider }))
				: Effect.succeed(token),
		),
		Effect.catchTag("ObjectCallError", (error) =>
			Effect.fail(
				new InternalServerError({ message: "The organization is unavailable", cause: error }),
			),
		),
	)

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

					// The org's Linear token (active connection, refreshed)
					const accessToken = yield* requireToken(orgId, "linear")

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
						// Any token problem falls through to the public API.
						const accessToken = yield* tokenOf(orgId, "github").pipe(
							Effect.catchTag("ObjectCallError", () => Effect.succeed(null)),
						)
						if (accessToken === null) return Option.none<GitHub.GitHubPR>()

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
					Effect.withSpan("IntegrationResources.getGitHubRepositories"),
				),
			)
			.handle("getSlackChannels", ({ params }) => handleGetSlackChannels(params))
			.handle("getDiscordGuilds", ({ params }) =>
				handleGetDiscordGuilds(params).pipe(Effect.withSpan("IntegrationResources.getDiscordGuilds")),
			)
			.handle("getDiscordGuildChannels", ({ params }) =>
				handleGetDiscordGuildChannels(params).pipe(
					Effect.catchTags({
						ConfigError: (error) =>
							Effect.fail(
								new InternalServerError({
									message: "Discord bot token not configured",
									cause: error,
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

	// The org's GitHub token (active connection, regenerated when due)
	const accessToken = yield* requireToken(orgId, "github")

	// Fetch repositories from GitHub API using GitHubApiClient
	const gitHubApiClient = yield* GitHub.GitHubApiClient
	const result = yield* gitHubApiClient.fetchRepositories(accessToken, page, perPage).pipe(
		Effect.mapError(
			(error) =>
				new InternalServerError({
					message: "Failed to fetch GitHub repositories",
					cause: error,
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

const handleGetDiscordGuilds = Effect.fn("integration-resources.getDiscordGuilds")(function* (path: {
	orgId: OrganizationId
}) {
	const { orgId } = path
	const accessToken = yield* requireToken(orgId, "discord")

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
		// Only for an org with an active Discord connection.
		yield* requireToken(orgId, "discord")

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

/** The org's Slack workspace (its connection's account) and the channels its bot token sees. */
const handleGetSlackChannels = Effect.fn("integration-resources.getSlackChannels")(function* (path: {
	orgId: OrganizationId
}) {
	const { orgId } = path
	yield* requireMember(orgId)
	const access = yield* callObject(IntegrationAccessTokenCall, orgTarget(orgId), {
		provider: "slack",
	}).pipe(
		Effect.catchTag("IntegrationTokenUnavailableError", () => Effect.succeed(null)),
		Effect.catchTag("ObjectCallError", (error) =>
			Effect.fail(
				new InternalServerError({ message: "The organization is unavailable", cause: error }),
			),
		),
	)
	if (access === null || access.connection.externalAccountId === null) {
		return yield* new IntegrationNotConnectedForPreviewError({ provider: "slack" })
	}
	const api = yield* Slack.SlackApiClient
	const channels = yield* api.listChannels(access.accessToken).pipe(
		Effect.mapError(
			(error) =>
				new IntegrationResourceError({
					url: "slack://conversations",
					message: error.message,
					provider: "slack",
				}),
		),
	)
	return new SlackChannelsResponse({
		workspace: {
			id: access.connection.externalAccountId,
			name: access.connection.externalAccountName,
		},
		channels: channels.map((channel) => ({ ...channel, id: channel.id as ExternalChannelId })),
	})
})
