// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The chat migration wizard's data (today's `web-foldkit/src/page/shared/chat-migration/model.ts`):
 * pick Slack or Discord, connect it, pick the server, pick channels and history, and go.
 */
import { UiSchema } from "@effect/ui"
import {
	CHAT_SYNC_MIGRATION_MAX_CHANNELS,
	CHAT_SYNC_MIGRATION_MAX_MESSAGES,
	ChatSyncHistoryRange,
} from "@hazel/domain/rpc"
import { ExternalChannelId, SyncConnectionId } from "@hazel/schema"
import { Schema } from "effect"

export { CHAT_SYNC_MIGRATION_MAX_CHANNELS, CHAT_SYNC_MIGRATION_MAX_MESSAGES, ChatSyncHistoryRange }

export const ChatSyncProvider = Schema.Literals(["discord", "slack"])
export type ChatSyncProvider = typeof ChatSyncProvider.Type

/** Where a connection syncs: a Discord server or the Slack workspace. */
export const Workspace = Schema.Struct({
	id: Schema.String,
	name: Schema.String,
	/** Discord: the user owns the server (shown as a tag). */
	owner: Schema.Boolean,
})
export type Workspace = typeof Workspace.Type

export const ExternalChannel = Schema.Struct({
	id: ExternalChannelId,
	name: Schema.String,
	isPrivate: Schema.Boolean,
})
export type ExternalChannel = typeof ExternalChannel.Type

/** Why a step failed, as the wizard says it. */
export const Problem = Schema.Struct({
	title: Schema.String,
	description: Schema.String,
	/** Offer "Try again" (the same step). */
	canRetry: Schema.Boolean,
})
export type Problem = typeof Problem.Type

/** What `chatSync.migrate` did. */
export const MigrationResult = Schema.Struct({
	linked: Schema.Finite,
	created: Schema.Finite,
	skipped: Schema.Finite,
	/** Picks another Hazel workspace syncs already: left out. */
	takenElsewhere: Schema.Finite,
})
export type MigrationResult = typeof MigrationResult.Type

export const Phase = UiSchema.TaggedEnum({
	ChoosingProvider: {},
	/** Reading the provider's workspaces. */
	Loading: { provider: ChatSyncProvider },
	/** Not connected (or the Discord bot is in no server): authorize it. */
	NeedsAuthorization: { provider: ChatSyncProvider, isRedirecting: Schema.Boolean },
	PickingWorkspace: { provider: ChatSyncProvider, workspaces: Schema.Array(Workspace) },
	/** Finding (or making) the sync connection, and listing its channels. */
	Preparing: { provider: ChatSyncProvider, workspace: Workspace, workspaces: Schema.Array(Workspace) },
	PickingChannels: {
		provider: ChatSyncProvider,
		workspace: Workspace,
		workspaces: Schema.Array(Workspace),
		syncConnectionId: SyncConnectionId,
		channels: Schema.Array(ExternalChannel),
		selected: Schema.Array(ExternalChannelId),
		history: ChatSyncHistoryRange,
		isSubmitting: Schema.Boolean,
	},
	Failed: {
		provider: ChatSyncProvider,
		problem: Problem,
		/** What "Try again" reruns: the workspace list, or preparing `workspace`. */
		workspace: Schema.NullOr(Workspace),
		workspaces: Schema.Array(Workspace),
	},
	/** The progress step: what was linked, and the history importing in the background. */
	Done: {
		provider: ChatSyncProvider,
		workspaceName: Schema.String,
		result: MigrationResult,
		history: ChatSyncHistoryRange,
	},
})
export type Phase = typeof Phase.Type

/** The picks left on Back, restored when the same workspace is picked again. */
export const Remembered = Schema.Struct({
	workspaceId: Schema.String,
	selected: Schema.Array(ExternalChannelId),
	history: ChatSyncHistoryRange,
})
export type Remembered = typeof Remembered.Type

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

/** Case-insensitive name filter; a blank search keeps every row. */
export const filterByName = <A extends { readonly name: string }>(rows: ReadonlyArray<A>, search: string) => {
	const query = search.trim().toLowerCase()
	return query.length === 0 ? rows : rows.filter((row) => row.name.toLowerCase().includes(query))
}

/** A request is running: Back, Skip and a second Go wait for it. */
export const isBusy = (phase: Phase): boolean =>
	Phase.match(phase, {
		ChoosingProvider: () => false,
		Loading: () => true,
		NeedsAuthorization: ({ isRedirecting }) => isRedirecting,
		PickingWorkspace: () => false,
		Preparing: () => true,
		PickingChannels: ({ isSubmitting }) => isSubmitting,
		Failed: () => false,
		Done: () => false,
	})
