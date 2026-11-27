// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * What the chat sync pages ask of their host, every failure already in the page's words. The web
 * builds it from `HazelRpc` (connections, inboxes) and its HTTP API client (provider resources), as
 * today's `chat-sync/{rpc,add-connection,email}.ts` do.
 */
import type { ChannelId, OrganizationId, SyncConnectionId } from "@hazel/schema"
import { Context, type Effect } from "effect"
import type {
	ChatSyncList,
	ChatSyncProvider,
	CommonReason,
	CreateConnectionFailure,
	DeleteConnectionFailure,
	EmailInbox,
	EmailInboxFailure,
	ResourceFailure,
	Workspace,
} from "./model"

export class ChatSyncBackend extends Context.Service<
	ChatSyncBackend,
	{
		/** The Slack and Discord connections, and each email inbox with its link. */
		readonly list: (organizationId: OrganizationId) => Effect.Effect<ChatSyncList, CommonReason>
		/** Discord: every server the bot is in; Slack: the one installed workspace. */
		readonly listWorkspaces: (
			organizationId: OrganizationId,
			provider: ChatSyncProvider,
		) => Effect.Effect<ReadonlyArray<Workspace>, ResourceFailure>
		readonly createConnection: (payload: {
			readonly organizationId: OrganizationId
			readonly provider: ChatSyncProvider
			readonly externalWorkspaceId: string
			readonly externalWorkspaceName: string
		}) => Effect.Effect<void, CreateConnectionFailure>
		/** A connection or an inbox (an inbox is its connection). */
		readonly deleteConnection: (
			organizationId: OrganizationId,
			syncConnectionId: SyncConnectionId,
		) => Effect.Effect<void, DeleteConnectionFailure>
		readonly createEmailInbox: (payload: {
			readonly organizationId: OrganizationId
			readonly displayName: string
			readonly supportAddress: string | null
			readonly hazelChannelId: ChannelId
		}) => Effect.Effect<EmailInbox, EmailInboxFailure>
		readonly updateEmailInbox: (payload: {
			readonly organizationId: OrganizationId
			readonly syncConnectionId: SyncConnectionId
			readonly displayName: string
			readonly supportAddress: string | null
		}) => Effect.Effect<void, EmailInboxFailure>
		/** Whether the URL carries a provider's OAuth return the migration wizard should resume. */
		readonly hasMigrationReturn: Effect.Effect<boolean>
		readonly copy: (text: string) => Effect.Effect<void, "CopyFailed">
	}
>()("hazel/chat-sync/Backend") {}
