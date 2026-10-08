import { UserPresenceStatus } from "@hazel/domain/models"
import { UserPresenceStatusResponse } from "@hazel/domain/rpc"
import { TransactionId, UserId, UserPresenceStatusId } from "@hazel/schema"
import { Effect, Option, Schema } from "effect"
import { pushChange } from "../../backend/live-events.ts"
import type { Dataset } from "../dataset.ts"
import { stableId } from "../ids.ts"
import { defaultDataset, defaultIds } from "./default.ts"

/**
 * Ada with an emoji status (the user menu shows it next to her name and on "Set status"), plus
 * variants whose status writes sync back like Electric would: the RPC pushes the new presence row.
 */

const now = defaultDataset.now
const adaPresenceId = stableId("presence:ada")

export const ADA_STATUS_EMOJI = "🌴"
export const ADA_STATUS_MESSAGE = "Vacationing"

interface AdaStatus {
	readonly statusEmoji: string | null
	readonly customMessage: string | null
	readonly statusExpiresAt: Date | null
	readonly suppressNotifications: boolean
}

const noStatus: AdaStatus = {
	statusEmoji: null,
	customMessage: null,
	statusExpiresAt: null,
	suppressNotifications: false,
}

const emojiStatus: AdaStatus = {
	statusEmoji: ADA_STATUS_EMOJI,
	customMessage: ADA_STATUS_MESSAGE,
	statusExpiresAt: new Date(now.getTime() + 2 * 60 * 60 * 1000),
	suppressNotifications: false,
}

const emojiStatusTables: Dataset["tables"] = {
	...defaultDataset.tables,
	user_presence_status: (defaultDataset.tables.user_presence_status ?? []).map((row) =>
		row.id === adaPresenceId ? { ...row, ...emojiStatus } : row,
	),
}

/** Ada's presence row (the default dataset's, online) with a custom status. */
const adaPresence = (status: AdaStatus) =>
	UserPresenceStatus.Schema.make({
		id: Schema.decodeSync(UserPresenceStatusId)(adaPresenceId),
		userId: Schema.decodeSync(UserId)(defaultIds.user("ada")),
		status: "online",
		activeChannelId: null,
		updatedAt: now,
		lastSeenAt: now,
		...status,
	})

const respond = (status: AdaStatus) =>
	new UserPresenceStatusResponse({
		data: adaPresence(status),
		transactionId: Schema.decodeSync(TransactionId)(1),
	})

/** Postgres text encoding, as `/__parity/push` expects it. */
const encodeRow = (row: Readonly<Record<string, unknown>>): Record<string, string | null> =>
	Object.fromEntries(
		Object.entries(row).map(([column, value]) => [
			column,
			value === null || value === undefined
				? null
				: value instanceof Date
					? value.toISOString()
					: String(value),
		]),
	)

/** Writes Ada's row back through the live shape, like Electric after the real RPC. */
const syncAdaStatus = (datasetName: string, status: AdaStatus) =>
	Effect.sync(() => {
		pushChange(datasetName, {
			table: "user_presence_status",
			operation: "update",
			row: encodeRow({ ...adaPresence(status) }),
		})
		return respond(status)
	})

/** `setCustomStatus` payloads; presence status syncs carry no `statusEmoji`. */
const CustomStatusPayload = Schema.Struct({
	statusEmoji: Schema.NullOr(Schema.String),
	customMessage: Schema.NullOr(Schema.String),
	statusExpiresAt: Schema.optionalKey(Schema.NullOr(Schema.Date)),
	suppressNotifications: Schema.optionalKey(Schema.Boolean),
})

const presenceWrites = (datasetName: string, initial: AdaStatus): Dataset["rpc"] => ({
	"userPresenceStatus.update": (payload) =>
		Option.match(Schema.decodeUnknownOption(CustomStatusPayload)(payload), {
			onNone: () => respond(initial),
			onSome: (status) =>
				syncAdaStatus(datasetName, {
					statusEmoji: status.statusEmoji,
					customMessage: status.customMessage,
					statusExpiresAt: status.statusExpiresAt ?? null,
					suppressNotifications: status.suppressNotifications ?? false,
				}),
		}),
	"userPresenceStatus.clearStatus": () => syncAdaStatus(datasetName, noStatus),
})

export const statusEmojiDataset: Dataset = {
	...defaultDataset,
	name: "status-emoji",
	tables: emojiStatusTables,
}

/** No status yet; saving one shows its emoji in the user menu. */
export const statusEmojiSaveDataset: Dataset = {
	...defaultDataset,
	name: "status-emoji-save",
	rpc: { ...defaultDataset.rpc, ...presenceWrites("status-emoji-save", noStatus) },
}

/** The emoji status set; clearing it removes the emoji from the user menu. */
export const statusEmojiClearDataset: Dataset = {
	...defaultDataset,
	name: "status-emoji-clear",
	tables: emojiStatusTables,
	rpc: { ...defaultDataset.rpc, ...presenceWrites("status-emoji-clear", emojiStatus) },
}
