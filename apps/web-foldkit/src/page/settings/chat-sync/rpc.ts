import type { ChatSyncConnection } from "@hazel/domain/models"
import type { OrganizationId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import { toDate } from "~/lib/utils"
import { HazelRpc } from "../../../rpc"
import { type Connection, ConnectionStatus } from "./model"
import { isChatSyncProvider, PROVIDERS } from "./providers"

const isStatus = Schema.is(ConnectionStatus)
const statusOf = (status: string) => (isStatus(status) ? status : "active")

const toConnection = (connection: ChatSyncConnection.Type): ReadonlyArray<Connection> => {
	const provider = connection.provider
	// A provider this client does not know has no page to manage it, so it is not listed.
	if (!isChatSyncProvider(provider)) return []
	return [
		{
			id: connection.id,
			provider,
			displayName: connection.externalWorkspaceName || PROVIDERS[provider].workspaceTitle,
			// `(connection.status as ConnectionStatus) || "active"`
			status: statusOf(connection.status),
			externalWorkspaceId: connection.externalWorkspaceId,
			errorMessage: connection.errorMessage ?? null,
			lastSyncedAtMs: connection.lastSyncedAt ? toDate(connection.lastSyncedAt).getTime() : null,
		},
	]
}

/** `chatSync.connection.list`, shaped the way both chat sync pages read it. */
export const fetchConnections = (organizationId: OrganizationId) =>
	Effect.gen(function* () {
		const client = yield* HazelRpc
		const response = yield* client("chatSync.connection.list", { organizationId })
		return response.data.flatMap(toConnection)
	})

/** `toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })` */
export const formatSyncedAt = (ms: number) =>
	new Date(ms).toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
	})
