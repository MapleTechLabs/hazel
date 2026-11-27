import { SyncConnectionId } from "@hazel/schema"
import { Schema } from "effect"
import { CommonReason } from "~/lib/error-messages"
import { ChatSyncProvider } from "./providers"

/** What the connection page (`chat-sync-connection`, PS4) still reads; the list page is native (PS3). */

export const ConnectionStatus = Schema.Literals(["active", "paused", "error", "disabled"])
export type ConnectionStatus = typeof ConnectionStatus.Type

export const Connection = Schema.Struct({
	id: SyncConnectionId,
	provider: ChatSyncProvider,
	/** `externalWorkspaceName`, or the provider's "Discord Server" / "Slack Workspace" */
	displayName: Schema.String,
	status: ConnectionStatus,
	externalWorkspaceId: Schema.String,
	errorMessage: Schema.NullOr(Schema.String),
	lastSyncedAtMs: Schema.NullOr(Schema.Finite),
})
export type Connection = typeof Connection.Type

export const DeleteConnectionFailure = Schema.Union([Schema.Literal("NotFound"), CommonReason])
export type DeleteConnectionFailure = typeof DeleteConnectionFailure.Type
