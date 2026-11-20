/**
 * Migrating from Slack or Discord: pick the platform, connect it (OAuth when it is not yet), pick
 * the server, pick channels (or all of them) and how much history to bring, and go
 * (`chatSync.migrate`). Onboarding shows it as a step and chat sync settings in a modal; each embeds
 * it like `SuggestionPrompt`: it keeps the `Model`, wraps the `Message`, and folds `update`, whose
 * `outcome` says when to toast, or that the migration finished or was skipped.
 */
import {
	CHAT_SYNC_MIGRATION_MAX_CHANNELS,
	CHAT_SYNC_MIGRATION_MAX_MESSAGES,
	ChatSyncHistoryRange,
} from "@hazel/domain/rpc"
import { ExternalChannelId, OrganizationId, SyncConnectionId } from "@hazel/schema"
import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import { defineTaggedUnion } from "foldkit/schema"
import {
	ChatSyncProvider,
	ExternalChannel,
	ResourceFailure,
	Workspace,
} from "../../settings/chat-sync/providers"

export { CHAT_SYNC_MIGRATION_MAX_CHANNELS, CHAT_SYNC_MIGRATION_MAX_MESSAGES, ChatSyncHistoryRange }

/** Why a step failed, as the wizard says it. */
export const Problem = Schema.Struct({
	title: Schema.String,
	description: Schema.String,
	/** Offer "Try again" (the same step). */
	canRetry: Schema.Boolean,
})
export type Problem = typeof Problem.Type

export const Phase = defineTaggedUnion({
	ChoosingProvider: {},
	/** Reading what the org has connected: the provider's workspaces. */
	Loading: { provider: ChatSyncProvider },
	/** The provider is not connected (or the Discord bot is in no server): authorize it. */
	NeedsAuthorization: { provider: ChatSyncProvider, isRedirecting: Schema.Boolean },
	/** Discord: the servers the bot is in, to pick one. */
	PickingWorkspace: {
		provider: ChatSyncProvider,
		workspaces: Schema.Array(Workspace),
		search: Schema.String,
	},
	/** Finding (or making) the workspace's sync connection, and listing its channels. */
	Preparing: { provider: ChatSyncProvider, workspace: Workspace },
	PickingChannels: {
		provider: ChatSyncProvider,
		workspace: Workspace,
		syncConnectionId: SyncConnectionId,
		channels: Schema.Array(ExternalChannel),
		selected: Schema.Array(ExternalChannelId),
		search: Schema.String,
		history: ChatSyncHistoryRange,
		isSubmitting: Schema.Boolean,
	},
	Failed: {
		provider: ChatSyncProvider,
		problem: Problem,
		/** What "Try again" reruns: the workspace list, or preparing `workspace`. */
		workspace: Schema.NullOr(Workspace),
	},
	Done: {
		provider: ChatSyncProvider,
		workspaceName: Schema.String,
		linked: Schema.Number,
		created: Schema.Number,
		skipped: Schema.Number,
		history: ChatSyncHistoryRange,
	},
})
export type Phase = typeof Phase.Type

export const Model = Schema.Struct({
	id: Schema.String,
	organizationId: Schema.NullOr(OrganizationId),
	/** The app path the provider's OAuth comes back to (this page). */
	returnTo: Schema.String,
	phase: Phase,
	/** Back from a provider's OAuth before the organization was known: resumed once it is. */
	resumeProvider: Schema.NullOr(ChatSyncProvider),
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
	/** The page loaded back from a provider's OAuth (`?connection_status=success&provider=`). */
	ReturnedFromProvider: { provider: Schema.NullOr(ChatSyncProvider) },
	ClickedProvider: { provider: ChatSyncProvider },
	ClickedBack: {},
	ClickedSkip: {},
	SucceededListWorkspaces: {
		organizationId: OrganizationId,
		provider: ChatSyncProvider,
		workspaces: Schema.Array(Workspace),
	},
	FailedListWorkspaces: {
		organizationId: OrganizationId,
		provider: ChatSyncProvider,
		reason: ResourceFailure,
	},
	ClickedAuthorize: {},
	SucceededGetOAuthUrl: { organizationId: OrganizationId, authorizationUrl: Schema.String },
	FailedGetOAuthUrl: { organizationId: OrganizationId, problem: Problem },
	CompletedRedirect: {},
	ChangedWorkspaceSearch: { value: Schema.String },
	ClickedWorkspace: { workspace: Workspace },
	SucceededPrepare: {
		organizationId: OrganizationId,
		workspaceId: Schema.String,
		syncConnectionId: SyncConnectionId,
		channels: Schema.Array(ExternalChannel),
	},
	FailedPrepare: { organizationId: OrganizationId, workspaceId: Schema.String, problem: Problem },
	ClickedRetry: {},
	ChangedChannelSearch: { value: Schema.String },
	ToggledChannel: { channelId: ExternalChannelId, isSelected: Schema.Boolean },
	/** Select every channel the search shows, or clear them. */
	ToggledAll: { isSelected: Schema.Boolean },
	ClickedHistory: { history: Schema.String },
	ClickedMigrate: {},
	SucceededMigrate: {
		organizationId: OrganizationId,
		linked: Schema.Number,
		created: Schema.Number,
		skipped: Schema.Number,
	},
	FailedMigrate: { organizationId: OrganizationId, problem: Problem },
	ClickedFinish: {},
	ClickedMigrateMore: {},
})
export type Message = typeof Message.Type

export interface HistoryOption {
	readonly value: ChatSyncHistoryRange
	readonly label: string
	readonly description: string
}

/** The ranges a migration offers; every one stops at the provider's per-channel cap. */
export const historyOptions = (provider: ChatSyncProvider): ReadonlyArray<HistoryOption> => {
	const cap = CHAT_SYNC_MIGRATION_MAX_MESSAGES[provider].toLocaleString("en-US")
	return [
		{ value: "none", label: "No history", description: "Only new messages from now on" },
		{ value: "7d", label: "Last 7 days", description: "A quick start with recent context" },
		{ value: "30d", label: "Last 30 days", description: "Recommended for most teams" },
		{ value: "90d", label: "Last 90 days", description: "The last quarter of conversations" },
		{ value: "1y", label: "Last year", description: "Takes a while on busy channels" },
		{ value: "all", label: "Everything", description: `Up to ${cap} messages per channel` },
	]
}

export const DEFAULT_HISTORY: ChatSyncHistoryRange = "30d"

export const isHistoryRange = Schema.is(ChatSyncHistoryRange)

export const init = (options: {
	readonly id: string
	readonly organizationId: OrganizationId | null
	readonly returnTo: string
}): Model => ({
	id: options.id,
	organizationId: options.organizationId,
	returnTo: options.returnTo,
	phase: Phase.ChoosingProvider(),
	resumeProvider: null,
})

/** Case-insensitive name filter; a blank search keeps every channel. */
export const visibleChannels = (
	channels: ReadonlyArray<ExternalChannel>,
	search: string,
): ReadonlyArray<ExternalChannel> => {
	const query = search.trim().toLowerCase()
	return query.length === 0
		? channels
		: channels.filter((channel) => channel.name.toLowerCase().includes(query))
}

/** A request is running: Back, Skip and a second Go wait for it. */
export const isBusy = (model: Model): boolean =>
	Phase.match(model.phase, {
		ChoosingProvider: () => false,
		Loading: () => true,
		NeedsAuthorization: ({ isRedirecting }) => isRedirecting,
		PickingWorkspace: () => false,
		Preparing: () => true,
		PickingChannels: ({ isSubmitting }) => isSubmitting,
		Failed: () => false,
		Done: () => false,
	})
