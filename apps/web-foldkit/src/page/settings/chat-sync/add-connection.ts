import { OrganizationId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import { Command, Render } from "foldkit"
import * as Dom from "foldkit/dom"
import { HazelRpc } from "../../../rpc"
import { catchCommon } from "../../../data/actions"
import { Message } from "./model"
import { ChatSyncProvider, listResource, PROVIDERS } from "./providers"

/** `AddConnectionModal`'s commands (`components/chat-sync/add-connection-modal.tsx`). */

export const ADD_CONNECTION_MODAL_ID = "chat-sync-add-connection"
export const WORKSPACE_SEARCH_ID = `${ADD_CONNECTION_MODAL_ID}-search`

/** `createConnection` (`chatSync.connection.create`). */
export const CreateConnection = Command.define("CreateConnection", {
	args: {
		organizationId: OrganizationId,
		provider: ChatSyncProvider,
		externalWorkspaceId: Schema.String,
		externalWorkspaceName: Schema.String,
	},
	messages: [Message.SucceededCreateConnection, Message.FailedCreateConnection],
	execute: ({ organizationId, provider, externalWorkspaceId, externalWorkspaceName }) =>
		Effect.gen(function* () {
			// React paints the pending button on the click, before any reply; wait for that commit.
			yield* Render.afterCommit
			const client = yield* HazelRpc
			yield* client("chatSync.connection.create", {
				organizationId,
				provider,
				externalWorkspaceId,
				externalWorkspaceName,
			})
			return Message.SucceededCreateConnection()
		}).pipe(
			Effect.catchTags({
				ChatSyncConnectionExistsError: () =>
					Effect.succeed(Message.FailedCreateConnection({ reason: "AlreadyExists" })),
				ChatSyncIntegrationNotConnectedError: () =>
					Effect.succeed(Message.FailedCreateConnection({ reason: "NotConnected" })),
			}),
			catchCommon((reason) => Message.FailedCreateConnection({ reason })),
		),
})

/** The modal's workspace query for its provider; the modal mounts with the loaded list. */
export const ListWorkspaces = Command.define("ListWorkspaces", {
	args: { organizationId: OrganizationId, provider: ChatSyncProvider, version: Schema.Number },
	messages: [Message.SucceededListWorkspaces, Message.FailedListWorkspaces],
	execute: ({ organizationId, provider, version }) =>
		listResource(
			PROVIDERS[provider].fetchWorkspaces(organizationId),
			(workspaces) => Message.SucceededListWorkspaces({ organizationId, version, workspaces }),
			(reason) => Message.FailedListWorkspaces({ organizationId, version, reason }),
		),
})

/** The search Input's `autoFocus`, once it is rendered. */
export const FocusWorkspaceSearch = Command.define("FocusWorkspaceSearch", {
	messages: [Message.CompletedFocusWorkspaceSearch],
	execute: Dom.focus(`#${WORKSPACE_SEARCH_ID}`).pipe(
		Effect.ignoreCause,
		Effect.as(Message.CompletedFocusWorkspaceSearch()),
	),
})
