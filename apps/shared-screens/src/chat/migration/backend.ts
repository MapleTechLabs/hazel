// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * What the wizard asks of its host, with every failure already in the wizard's words. The web
 * host builds it from its HTTP API client (provider resources, OAuth) and `HazelRpc` (connections,
 * `chatSync.migrate`), as today's `chat-migration/command.ts` does.
 */
import type { ChatSyncMigrationChannel } from "@hazel/domain/rpc"
import type { OrganizationId, SyncConnectionId } from "@hazel/schema"
import { Context, type Effect } from "effect"
import type {
	ChatSyncHistoryRange,
	ChatSyncProvider,
	ExternalChannel,
	MigrationResult,
	Problem,
	Workspace,
} from "./model"

/** Listing workspaces failed: not connected (authorize it), or a problem to show. */
export type ListFailure =
	| { readonly _tag: "NotConnected" }
	| { readonly _tag: "Problem"; readonly problem: Problem }

/** Back from the provider's OAuth (`?connection_status=&provider=&error_code=`), read once. */
export type OAuthReturn =
	| { readonly _tag: "None" }
	| { readonly _tag: "Returned"; readonly provider: ChatSyncProvider }
	| { readonly _tag: "Refused"; readonly provider: ChatSyncProvider; readonly errorCode: string | null }

export class ChatMigrationBackend extends Context.Service<
	ChatMigrationBackend,
	{
		readonly readOAuthReturn: Effect.Effect<OAuthReturn>
		readonly listWorkspaces: (
			organizationId: OrganizationId,
			provider: ChatSyncProvider,
		) => Effect.Effect<ReadonlyArray<Workspace>, ListFailure>
		/** The workspace's sync connection (made now if none) and its channels, A to Z. */
		readonly prepare: (
			organizationId: OrganizationId,
			provider: ChatSyncProvider,
			workspace: Workspace,
		) => Effect.Effect<
			{
				readonly syncConnectionId: SyncConnectionId
				readonly channels: ReadonlyArray<ExternalChannel>
			},
			Problem
		>
		/** The provider's consent page; its callback comes back to `returnTo`. */
		readonly authorizationUrl: (
			organizationId: OrganizationId,
			provider: ChatSyncProvider,
			returnTo: string,
		) => Effect.Effect<string, Problem>
		/** Leaves for the provider: a full load of `url`. */
		readonly redirect: (url: string) => Effect.Effect<void>
		readonly migrate: (payload: {
			readonly organizationId: OrganizationId
			readonly syncConnectionId: SyncConnectionId
			readonly channels: ReadonlyArray<ChatSyncMigrationChannel>
			readonly history: ChatSyncHistoryRange
		}) => Effect.Effect<MigrationResult, Problem>
	}
>()("hazel/chat-migration/Backend") {}
