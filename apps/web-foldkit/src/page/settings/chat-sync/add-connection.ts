import { OrganizationId } from "@hazel/schema"
import { Effect, Exit, Schema } from "effect"
import { Command, Render } from "foldkit"
import * as Dom from "foldkit/dom"
import { HazelRpc } from "../../../rpc"
import { failureToast } from "../../../ui/toast-exit"
import { Message } from "./model"

/** `AddConnectionModal`'s commands (`components/chat-sync/add-connection-modal.tsx`). */

export const ADD_CONNECTION_MODAL_ID = "chat-sync-add-connection"
export const GUILD_SEARCH_ID = `${ADD_CONNECTION_MODAL_ID}-search`

/** `createConnection` (`chatSync.connection.create`) with the modal's `exitToast` handlers. */
export const CreateConnection = Command.define("CreateConnection", {
	args: {
		organizationId: OrganizationId,
		externalWorkspaceId: Schema.String,
		externalWorkspaceName: Schema.String,
	},
	messages: [Message.SucceededCreateConnection, Message.FailedCreateConnection],
	execute: ({ organizationId, externalWorkspaceId, externalWorkspaceName }) =>
		Effect.gen(function* () {
			// React paints the pending button on the click, before any reply; wait for that commit.
			yield* Render.afterCommit
			const client = yield* HazelRpc
			const exit = yield* Effect.exit(
				client("chatSync.connection.create", {
					organizationId,
					provider: "discord",
					externalWorkspaceId,
					externalWorkspaceName,
				}),
			)
			return Exit.match(exit, {
				onSuccess: () => Message.SucceededCreateConnection(),
				onFailure: (cause) => {
					const toast = failureToast(cause, {
						ChatSyncConnectionExistsError: {
							title: "Connection already exists",
							description: "A connection to this Discord server already exists in your workspace.",
							isRetryable: false,
						},
						ChatSyncIntegrationNotConnectedError: {
							title: "Discord not connected",
							description: "Connect Discord first to load your guilds.",
							isRetryable: false,
						},
					})
					return Message.FailedCreateConnection({ title: toast.title, description: toast.description })
				},
			})
		}),
})

/** The search Input's `autoFocus`, once it is rendered. */
export const FocusGuildSearch = Command.define("FocusGuildSearch", {
	messages: [Message.CompletedFocusGuildSearch],
	execute: Dom.focus(`#${GUILD_SEARCH_ID}`).pipe(
		Effect.ignoreCause,
		Effect.as(Message.CompletedFocusGuildSearch()),
	),
})
