import * as Customers from "@hazel/domain/customers"
import { CustomerConnectionId } from "@hazel/schema"
import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import { CommonReason } from "~/lib/error-messages"
import { MemberRow } from "../../../../customers/queries"
import * as Modal from "../../../../ui/modal"
import { ConnectFailure, HistoryFilter } from "./model"
import { ConnectionRow, SyncRunRow } from "./queries"

/** Which form a config field edits: the connect modal's, or the detail's provider settings. */
export const ConfigTarget = Schema.Literals(["connect", "settings"])
export type ConfigTarget = typeof ConfigTarget.Type

/** `NotFound`: the connection is gone (disconnected meanwhile); `ComingSoon`: no integration yet. */
export const SyncFailure = Schema.Union([Schema.Literals(["NotFound", "ComingSoon"]), CommonReason])
export type SyncFailure = typeof SyncFailure.Type

export const DisconnectFailure = Schema.Union([Schema.Literals(["NotFound"]), CommonReason])
export type DisconnectFailure = typeof DisconnectFailure.Type

/** Demo data is refused outside dev and preview stages. */
export const SeedFailure = Schema.Union([Schema.Literals(["Refused"]), CommonReason])
export type SeedFailure = typeof SeedFailure.Type

export const Message = defineMessageUnion({
	UpdatedConnections: { connections: Schema.Array(ConnectionRow) },
	UpdatedSyncRuns: { runs: Schema.Array(SyncRunRow) },
	UpdatedAccountCount: { count: Schema.Int },
	UpdatedMembers: { members: Schema.Array(MemberRow) },
	SucceededFetchUnmatchedCount: { count: Schema.Int },
	FailedFetchUnmatchedCount: { reason: CommonReason },

	PressedSyncNow: { connectionId: CustomerConnectionId },
	PressedSyncAll: {},
	SucceededSyncNow: { connectionId: CustomerConnectionId },
	FailedSyncNow: { connectionId: CustomerConnectionId, reason: SyncFailure },
	PressedLoadDemo: {},
	SucceededSeedDemo: {},
	FailedSeedDemo: { reason: SeedFailure },
	ClickedHistoryFilter: { filter: HistoryFilter },

	// Connect modal
	PressedConnect: { provider: Customers.CustomerProvider },
	PressedReconnect: { connectionId: CustomerConnectionId },
	GotConnectModalMessage: { message: Modal.Message },
	ChangedApiKey: { value: Schema.String },
	ToggledConfigField: { target: ConfigTarget, key: Schema.String, isSelected: Schema.Boolean },
	ChangedConfigText: { target: ConfigTarget, key: Schema.String, value: Schema.String },
	SubmittedConnect: {},
	/** `provider` / `connectionId` name the form asked from: an answer for a form closed since is dropped. */
	SucceededConnect: {
		provider: Customers.CustomerProvider,
		connectionId: CustomerConnectionId,
		accountName: Schema.NullOr(Schema.String),
	},
	FailedConnect: { provider: Customers.CustomerProvider, reason: ConnectFailure },
	ChangedWebhookSecret: { value: Schema.String },
	SubmittedWebhookSecret: {},
	SucceededSaveWebhookSecret: { connectionId: CustomerConnectionId },
	FailedSaveWebhookSecret: { connectionId: CustomerConnectionId, reason: ConnectFailure },
	PressedCopyWebhookUrl: { url: Schema.String },
	SucceededCopyWebhookUrl: {},
	FailedCopyWebhookUrl: {},

	// Update keys modal
	PressedUpdateKeys: { connectionId: CustomerConnectionId },
	GotKeysModalMessage: { message: Modal.Message },
	ChangedKeysApiKey: { value: Schema.String },
	ChangedKeysWebhookSecret: { value: Schema.String },
	SubmittedKeys: {},
	SucceededUpdateKeys: {},
	FailedUpdateKeys: { reason: ConnectFailure },

	// Disconnect
	PressedDisconnect: {},
	GotDisconnectModalMessage: { message: Modal.Message },
	ConfirmedDisconnect: { connectionId: CustomerConnectionId },
	SucceededDisconnect: { provider: Customers.CustomerProvider },
	FailedDisconnect: { reason: DisconnectFailure },

	// Provider settings (Maple's own fields beyond the descriptor's)
	ChangedActivityEventInput: { value: Schema.String },
	AddedActivityEvent: {},
	RemovedActivityEvent: { event: Schema.String },
	AddedMetricMapping: {},
	RemovedMetricMapping: { index: Schema.Int },
	ChangedMetricMapping: {
		index: Schema.Int,
		field: Schema.Literals(["event", "metricKey"]),
		value: Schema.String,
	},
	ClickedLookback: { days: Schema.Int },
	PressedDiscardSettings: {},
	PressedSaveSettings: {},
	SucceededSaveSettings: {},
	FailedSaveSettings: { reason: ConnectFailure },
})
export type Message = typeof Message.Type
