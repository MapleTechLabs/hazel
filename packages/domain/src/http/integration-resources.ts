import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/http-api"
import { Effect, Schema } from "effect"
import * as CurrentUser from "../current-user"
import { InternalServerError, UnauthorizedError } from "../errors"
import { ExternalChannelId, OrganizationId } from "@hazel/schema"
import { IntegrationConnection } from "../models"
import { RequiredScopes } from "../scopes/required-scopes"

// Provider type from the model
const IntegrationProvider = IntegrationConnection.IntegrationProvider

// Linear issue state schema
const LinearIssueStateResponse = Schema.Struct({
	id: Schema.String,
	name: Schema.String,
	color: Schema.String,
})

// Linear issue assignee schema
const LinearIssueAssigneeResponse = Schema.Struct({
	id: Schema.String,
	name: Schema.String,
	avatarUrl: Schema.NullOr(Schema.String),
})

// Linear issue label schema
const LinearIssueLabelResponse = Schema.Struct({
	id: Schema.String,
	name: Schema.String,
	color: Schema.String,
})

// Full Linear issue response
export class LinearIssueResourceResponse extends Schema.Class<LinearIssueResourceResponse>(
	"LinearIssueResourceResponse",
)({
	id: Schema.String,
	identifier: Schema.String,
	title: Schema.String,
	description: Schema.NullOr(Schema.String),
	url: Schema.String,
	teamName: Schema.String,
	state: Schema.NullOr(LinearIssueStateResponse),
	assignee: Schema.NullOr(LinearIssueAssigneeResponse),
	priority: Schema.Number,
	priorityLabel: Schema.String,
	labels: Schema.Array(LinearIssueLabelResponse),
}) {}

// GitHub PR author schema
const GitHubPRAuthorResponse = Schema.Struct({
	login: Schema.String,
	avatarUrl: Schema.NullOr(Schema.String),
})

// GitHub PR label schema
const GitHubPRLabelResponse = Schema.Struct({
	name: Schema.String,
	color: Schema.String,
})

// Full GitHub PR response
export class GitHubPRResourceResponse extends Schema.Class<GitHubPRResourceResponse>(
	"GitHubPRResourceResponse",
)({
	owner: Schema.String,
	repo: Schema.String,
	number: Schema.Number,
	title: Schema.String,
	body: Schema.NullOr(Schema.String),
	state: Schema.Literals(["open", "closed"]),
	draft: Schema.Boolean,
	merged: Schema.Boolean,
	author: Schema.NullOr(GitHubPRAuthorResponse),
	additions: Schema.Number,
	deletions: Schema.Number,
	headRefName: Schema.String,
	updatedAt: Schema.String,
	labels: Schema.Array(GitHubPRLabelResponse),
}) {}

// GitHub Repository schemas (for listing repos the app has access to)
const GitHubRepositoryOwner = Schema.Struct({
	login: Schema.String,
	avatarUrl: Schema.NullOr(Schema.String),
})

const GitHubRepository = Schema.Struct({
	id: Schema.Number,
	name: Schema.String,
	fullName: Schema.String,
	private: Schema.Boolean,
	htmlUrl: Schema.String,
	description: Schema.NullOr(Schema.String),
	owner: GitHubRepositoryOwner,
})

export class GitHubRepositoriesResponse extends Schema.Class<GitHubRepositoriesResponse>(
	"GitHubRepositoriesResponse",
)({
	totalCount: Schema.Number,
	repositories: Schema.Array(GitHubRepository),
	hasNextPage: Schema.Boolean,
	page: Schema.Number,
	perPage: Schema.Number,
}) {}

const DiscordGuild = Schema.Struct({
	id: Schema.String,
	name: Schema.String,
	icon: Schema.NullOr(Schema.String),
	owner: Schema.Boolean,
})

const DiscordGuildChannel = Schema.Struct({
	id: ExternalChannelId,
	guildId: Schema.String,
	name: Schema.String,
	type: Schema.Number,
	parentId: Schema.NullOr(Schema.String),
})

export class DiscordGuildsResponse extends Schema.Class<DiscordGuildsResponse>("DiscordGuildsResponse")({
	guilds: Schema.Array(DiscordGuild),
}) {}

export class DiscordGuildChannelsResponse extends Schema.Class<DiscordGuildChannelsResponse>(
	"DiscordGuildChannelsResponse",
)({
	channels: Schema.Array(DiscordGuildChannel),
}) {}

// Error when organization doesn't have the integration connected
export class IntegrationNotConnectedForPreviewError extends Schema.TaggedError<IntegrationNotConnectedForPreviewError>()(
	"IntegrationNotConnectedForPreviewError",
	{
		provider: IntegrationProvider,
	},
) {}

// Error when resource cannot be found
export class ResourceNotFoundError extends Schema.TaggedError<ResourceNotFoundError>()(
	"ResourceNotFoundError",
	{
		url: Schema.String,
		message: Schema.optional(Schema.String),
	},
) {}

// Error when integration API returns an error (authorization, rate limit, etc.)
export class IntegrationResourceError extends Schema.TaggedError<IntegrationResourceError>()(
	"IntegrationResourceError",
	{
		url: Schema.String,
		message: Schema.String,
		provider: IntegrationProvider,
	},
) {}

// API Group for integration resources
export class IntegrationResourceGroup extends HttpApiGroup.make("integration-resources")
	.add(
		HttpApiEndpoint.get("fetchLinearIssue", `/:orgId/linear/issue`, {
			params: { orgId: OrganizationId },
			query: { url: Schema.String },
			success: LinearIssueResourceResponse,
			error: [
				IntegrationNotConnectedForPreviewError,
				IntegrationResourceError,
				ResourceNotFoundError,
				UnauthorizedError,
				InternalServerError,
			],
		})
			.annotateMerge(
				OpenApi.annotations({
					title: "Fetch Linear Issue",
					description: "Fetch Linear issue details for embedding in chat messages",
					summary: "Get Linear issue preview data",
				}),
			)
			.annotate(RequiredScopes, ["integration-connections:read"]),
	)
	.add(
		HttpApiEndpoint.get("fetchGitHubPR", `/:orgId/github/pr`, {
			params: { orgId: OrganizationId },
			query: { url: Schema.String },
			success: GitHubPRResourceResponse,
			error: [
				IntegrationNotConnectedForPreviewError,
				IntegrationResourceError,
				ResourceNotFoundError,
				UnauthorizedError,
				InternalServerError,
			],
		})
			.annotateMerge(
				OpenApi.annotations({
					title: "Fetch GitHub PR",
					description: "Fetch GitHub pull request details for embedding in chat messages",
					summary: "Get GitHub PR preview data",
				}),
			)
			.annotate(RequiredScopes, ["integration-connections:read"]),
	)
	.add(
		HttpApiEndpoint.get("getGitHubRepositories", `/:orgId/github/repositories`, {
			params: { orgId: OrganizationId },
			query: {
				page: Schema.optional(Schema.NumberFromString).pipe(
					Schema.withDecodingDefault(Effect.succeed("1")),
				),
				perPage: Schema.optional(Schema.NumberFromString).pipe(
					Schema.withDecodingDefault(Effect.succeed("30")),
				),
			},
			success: GitHubRepositoriesResponse,
			error: [IntegrationNotConnectedForPreviewError, UnauthorizedError, InternalServerError],
		})
			.annotateMerge(
				OpenApi.annotations({
					title: "Get GitHub Repositories",
					description: "List repositories accessible to the GitHub App installation",
					summary: "List GitHub repositories",
				}),
			)
			.annotate(RequiredScopes, ["integration-connections:read"]),
	)
	.add(
		HttpApiEndpoint.get("getDiscordGuilds", `/:orgId/discord/guilds`, {
			params: { orgId: OrganizationId },
			success: DiscordGuildsResponse,
			error: [
				IntegrationNotConnectedForPreviewError,
				IntegrationResourceError,
				UnauthorizedError,
				InternalServerError,
			],
		})
			.annotateMerge(
				OpenApi.annotations({
					title: "Get Discord Guilds",
					description: "List Discord guilds visible to the connected Discord account",
					summary: "List Discord guilds",
				}),
			)
			.annotate(RequiredScopes, ["integration-connections:read"]),
	)
	.add(
		HttpApiEndpoint.get("getDiscordGuildChannels", `/:orgId/discord/guilds/:guildId/channels`, {
			params: {
				orgId: OrganizationId,
				guildId: Schema.String,
			},
			success: DiscordGuildChannelsResponse,
			error: [
				IntegrationNotConnectedForPreviewError,
				IntegrationResourceError,
				UnauthorizedError,
				InternalServerError,
			],
		})
			.annotateMerge(
				OpenApi.annotations({
					title: "Get Discord Guild Channels",
					description: "List message-capable channels in a Discord guild using the bot token",
					summary: "List Discord guild channels",
				}),
			)
			.annotate(RequiredScopes, ["integration-connections:read"]),
	)
	.prefix("/integrations/resources")
	.middleware(CurrentUser.Authorization) {}
