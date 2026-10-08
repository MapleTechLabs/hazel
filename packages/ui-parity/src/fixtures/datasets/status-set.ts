import { UserPresenceStatus } from "@hazel/domain/models"
import { UserPresenceStatusResponse } from "@hazel/domain/rpc"
import { TransactionId, UserId, UserPresenceStatusId } from "@hazel/schema"
import { Effect, Schema } from "effect"
import type { Dataset } from "../dataset.ts"
import { stableId } from "../ids.ts"
import { defaultDataset, defaultIds } from "./default.ts"

/**
 * The default workspace with Ada's custom status message set (notifications paused), for the
 * set-status modal's "Clear status" state. No emoji: the user menu's status emoji is not ported yet.
 * Status writes never settle here, so Save shows "Saving..."; clearing succeeds.
 */

const now = defaultDataset.now
const adaPresenceId = stableId("presence:ada")

export const ADA_STATUS_MESSAGE = "Vacationing"

const adaPresence = UserPresenceStatus.Schema.make({
	id: Schema.decodeSync(UserPresenceStatusId)(adaPresenceId),
	userId: Schema.decodeSync(UserId)(defaultIds.user("ada")),
	status: "online",
	customMessage: null,
	statusEmoji: null,
	statusExpiresAt: null,
	activeChannelId: null,
	suppressNotifications: false,
	updatedAt: now,
	lastSeenAt: now,
})

export const statusSetDataset: Dataset = {
	...defaultDataset,
	name: "status-set",
	tables: {
		...defaultDataset.tables,
		user_presence_status: (defaultDataset.tables.user_presence_status ?? []).map((row) =>
			row.id === adaPresenceId
				? {
						...row,
						customMessage: ADA_STATUS_MESSAGE,
						suppressNotifications: true,
					}
				: row,
		),
	},
	rpc: {
		...defaultDataset.rpc,
		"userPresenceStatus.update": () => Effect.never,
		"userPresenceStatus.clearStatus": () =>
			new UserPresenceStatusResponse({
				data: adaPresence,
				transactionId: Schema.decodeSync(TransactionId)(1),
			}),
	},
}
