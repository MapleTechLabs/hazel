import { ChatSyncHistoryRange, ChatSyncMigrationChannel } from "@hazel/domain/rpc"
import { OrganizationId, SyncConnectionId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import { Command, Render } from "foldkit"
import { load } from "foldkit/navigation"
import { type CommonReason, commonMessage, isRetryableReason } from "~/lib/error-messages"
import { catchCommon } from "../../../data/actions"
import { HazelApiClient, HazelRpc } from "../../../rpc"
import {
	ChatSyncProvider,
	isChatSyncProvider,
	listResource,
	PROVIDERS,
	Workspace,
} from "../../settings/chat-sync/providers"
import { Message, type Problem } from "./model"

export const commonProblem = (reason: CommonReason): Problem => {
	const message = commonMessage(reason)
	return {
		title: message.title,
		description: message.description ?? "",
		canRetry: isRetryableReason(reason),
	}
}

/**
 * The provider's OAuth sends the browser back here with `?connection_status=success&provider=`:
 * pick up where the wizard left off. Anything else (an error, another provider) starts over.
 */
export const ReadChatMigrationOAuthReturn = Command.define("ReadChatMigrationOAuthReturn", {
	messages: [Message.ReturnedFromProvider],
	execute: Effect.sync(() => {
		const params = new URLSearchParams(globalThis.location?.search ?? "")
		const provider = params.get("provider")
		return Message.ReturnedFromProvider({
			provider:
				params.get("connection_status") === "success" &&
				provider !== null &&
				isChatSyncProvider(provider)
					? provider
					: null,
		})
	}),
})

export const ListChatMigrationWorkspaces = Command.define("ListChatMigrationWorkspaces", {
	args: { organizationId: OrganizationId, provider: ChatSyncProvider },
	messages: [Message.SucceededListWorkspaces, Message.FailedListWorkspaces],
	execute: ({ organizationId, provider }) =>
		listResource(
			PROVIDERS[provider].fetchWorkspaces(organizationId),
			(workspaces) => Message.SucceededListWorkspaces({ organizationId, provider, workspaces }),
			(reason) => Message.FailedListWorkspaces({ organizationId, provider, reason }),
		),
})

/**
 * The workspace's sync connection (made now if the org has none to it yet) and its channels, A to Z.
 */
export const PrepareChatMigrationWorkspace = Command.define("PrepareChatMigrationWorkspace", {
	args: { organizationId: OrganizationId, provider: ChatSyncProvider, workspace: Workspace },
	messages: [Message.SucceededPrepare, Message.FailedPrepare],
	execute: ({ organizationId, provider, workspace }) => {
		const { name, copy } = PROVIDERS[provider]
		const failed = (problem: Problem) =>
			Effect.succeed(Message.FailedPrepare({ organizationId, workspaceId: workspace.id, problem }))
		// Straight from the RPC: the chat sync page's model imports this wizard.
		const existing = HazelRpc.use((rpc) => rpc("chatSync.connection.list", { organizationId })).pipe(
			Effect.map((response) =>
				response.data.find(
					(connection) =>
						connection.provider === provider && connection.externalWorkspaceId === workspace.id,
				),
			),
		)
		return Effect.gen(function* () {
			const found = yield* existing
			const syncConnectionId =
				found?.id ??
				(yield* HazelRpc.use((rpc) =>
					rpc("chatSync.connection.create", {
						organizationId,
						provider,
						externalWorkspaceId: workspace.id,
						externalWorkspaceName: workspace.name,
					}),
				).pipe(Effect.map((response) => response.data.id)))
			const channels = yield* PROVIDERS[provider].fetchChannels(organizationId, workspace.id)
			return Message.SucceededPrepare({
				organizationId,
				workspaceId: workspace.id,
				syncConnectionId,
				channels: [...channels].sort((a, b) => a.name.localeCompare(b.name)),
			})
		}).pipe(
			Effect.catchTags({
				ChatSyncConnectionExistsError: () =>
					failed({
						title: "Already connected",
						description: copy.alreadyConnected,
						canRetry: true,
					}),
				ChatSyncIntegrationNotConnectedError: () =>
					failed({
						title: `${name} not connected`,
						description: copy.createNotConnected,
						canRetry: false,
					}),
				IntegrationNotConnectedForPreviewError: () =>
					failed({
						title: `Connect ${name} first`,
						description: copy.notConnected("channels"),
						canRetry: false,
					}),
				IntegrationResourceError: () =>
					failed({
						title: `Could not load ${name} channels`,
						description: copy.providerError,
						canRetry: true,
					}),
			}),
			catchCommon((reason) =>
				Message.FailedPrepare({
					organizationId,
					workspaceId: workspace.id,
					problem: commonProblem(reason),
				}),
			),
		)
	},
})

/** The provider's consent page URL; the callback comes back to `returnTo`. */
export const GetChatMigrationOAuthUrl = Command.define("GetChatMigrationOAuthUrl", {
	args: { organizationId: OrganizationId, provider: ChatSyncProvider, returnTo: Schema.String },
	messages: [Message.SucceededGetOAuthUrl, Message.FailedGetOAuthUrl],
	execute: ({ organizationId, provider, returnTo }) =>
		HazelApiClient.use((client) =>
			client.integrations.getOAuthUrl({
				params: { orgId: organizationId, provider },
				query: { level: "organization", returnTo },
			}),
		).pipe(
			Effect.map((response) =>
				Message.SucceededGetOAuthUrl({ authorizationUrl: response.authorizationUrl }),
			),
			Effect.catchTags({
				UnsupportedProviderError: () =>
					Effect.succeed(
						Message.FailedGetOAuthUrl({
							problem: {
								title: `${PROVIDERS[provider].name} is not available`,
								description: "This Hazel deployment has no app set up for it.",
								canRetry: false,
							},
						}),
					),
			}),
			catchCommon((reason) => Message.FailedGetOAuthUrl({ problem: commonProblem(reason) })),
		),
})

export const RedirectChatMigrationToProvider = Command.define("RedirectChatMigrationToProvider", {
	args: { authorizationUrl: Schema.String },
	messages: [Message.CompletedRedirect],
	execute: ({ authorizationUrl }) => load(authorizationUrl).pipe(Effect.as(Message.CompletedRedirect())),
})

export const RunChatMigration = Command.define("RunChatMigration", {
	args: {
		organizationId: OrganizationId,
		syncConnectionId: SyncConnectionId,
		channels: Schema.Array(ChatSyncMigrationChannel),
		history: ChatSyncHistoryRange,
	},
	messages: [Message.SucceededMigrate, Message.FailedMigrate],
	execute: (payload) =>
		Effect.gen(function* () {
			// The pending button paints on the click, before any reply.
			yield* Render.afterCommit
			const response = yield* HazelRpc.use((rpc) => rpc("chatSync.migrate", payload))
			return Message.SucceededMigrate({
				organizationId: payload.organizationId,
				linked: response.linked.length,
				created: response.linked.filter((link) => link.createdChannel).length,
				skipped: response.skipped.length,
			})
		}).pipe(
			Effect.catchTags({
				ChatSyncConnectionNotFoundError: () =>
					Effect.succeed(
						Message.FailedMigrate({
							organizationId: payload.organizationId,
							problem: {
								title: "Connection not found",
								description: "The connection was removed meanwhile. Start again.",
								canRetry: false,
							},
						}),
					),
			}),
			catchCommon((reason) =>
				Message.FailedMigrate({
					organizationId: payload.organizationId,
					problem: commonProblem(reason),
				}),
			),
		),
})
