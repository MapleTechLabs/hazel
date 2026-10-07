import type { OrganizationId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import { toDate } from "~/lib/utils"
import { HazelRpc } from "../../../rpc"
import { type Connection, ConnectionStatus } from "./model"

const isStatus = Schema.is(ConnectionStatus)

/** `chatSync.connection.list`, shaped the way both chat sync pages read it. */
export const fetchConnections = (organizationId: OrganizationId) =>
	Effect.gen(function* () {
		const client = yield* HazelRpc
		const response = yield* client("chatSync.connection.list", { organizationId })
		return response.data.map(
			(connection): Connection => ({
				id: connection.id,
				displayName: connection.externalWorkspaceName || "Discord Server",
				// `(connection.status as ConnectionStatus) || "active"`
				status: isStatus(connection.status) ? connection.status : "active",
				externalWorkspaceId: connection.externalWorkspaceId,
				errorMessage: connection.errorMessage ?? null,
				lastSyncedAtMs: connection.lastSyncedAt ? toDate(connection.lastSyncedAt).getTime() : null,
			}),
		)
	})

/** `toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })` */
export const formatSyncedAt = (ms: number) =>
	new Date(ms).toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
	})
