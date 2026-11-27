import * as Customers from "@hazel/domain/customers"
import { CustomerConnectionId, UserId } from "@hazel/schema"
import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import { CommonReason } from "~/lib/error-messages"
import { ImpersonatorRow, MemberRow } from "../../../../customers/queries"
import * as Menu from "../../../../ui/menu"
import * as Modal from "../../../../ui/modal"
import { ConnectFailure, HistoryFilter } from "./model"
import { ConnectionRow, ImpersonationRow, SyncRunRow, UnitMetricRow } from "./queries"

/** `NotFound`: the connection is gone (disconnected meanwhile); `ComingSoon`: no integration yet. */
export const SyncFailure = Schema.Union([Schema.Literals(["NotFound", "ComingSoon"]), CommonReason])
export type SyncFailure = typeof SyncFailure.Type

export const DisconnectFailure = Schema.Union([Schema.Literals(["NotFound"]), CommonReason])
export type DisconnectFailure = typeof DisconnectFailure.Type

/** `NotFound`: the metric is gone (or is a built-in). */
export const UnitFailure = Schema.Union([Schema.Literals(["NotFound"]), CommonReason])
export type UnitFailure = typeof UnitFailure.Type

/** `NotMember` (a grant): the member left the organization since the picker showed them. */
export const ImpersonatorFailure = Schema.Union([Schema.Literals(["NotMember"]), CommonReason])
export type ImpersonatorFailure = typeof ImpersonatorFailure.Type

export const Message = defineMessageUnion({
	UpdatedConnections: { connections: Schema.Array(ConnectionRow) },
	UpdatedSyncRuns: { runs: Schema.Array(SyncRunRow) },
	UpdatedMembers: { members: Schema.Array(MemberRow) },
	UpdatedUnitMetrics: { metrics: Schema.Array(UnitMetricRow) },

	PressedSyncNow: { connectionId: CustomerConnectionId },
	SucceededSyncNow: { connectionId: CustomerConnectionId },
	FailedSyncNow: { connectionId: CustomerConnectionId, reason: SyncFailure },
	ClickedHistoryFilter: { filter: HistoryFilter },

	// Connect (the native modal) and the matching options in the settings
	PressedConnect: { provider: Customers.CustomerProvider },
	PressedReconnect: { connectionId: CustomerConnectionId },
	ToggledConfigField: { key: Schema.String, isSelected: Schema.Boolean },
	ChangedConfigText: { key: Schema.String, value: Schema.String },
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

	// Provider settings (the `settings` fields of the integration's presentation)
	ChangedSettingsListInput: { key: Schema.String, value: Schema.String },
	AddedSettingsListItem: { key: Schema.String },
	RemovedSettingsListItem: { key: Schema.String, item: Schema.String },
	AddedSettingsRow: { key: Schema.String },
	RemovedSettingsRow: { key: Schema.String, index: Schema.Int },
	ChangedSettingsCell: {
		key: Schema.String,
		index: Schema.Int,
		column: Schema.String,
		value: Schema.String,
	},
	ClickedSettingsNumber: { key: Schema.String, value: Schema.Int },
	PressedDiscardSettings: {},
	PressedSaveSettings: {},
	SucceededSaveSettings: {},
	FailedSaveSettings: { reason: ConnectFailure },

	// Usage units
	ChangedUnit: { metricKey: Schema.String, value: Schema.String },
	SubmittedUnit: { metricKey: Schema.String },
	SucceededSaveUnit: {},
	FailedSaveUnit: { reason: UnitFailure },

	// Impersonation
	UpdatedImpersonators: { impersonators: Schema.Array(ImpersonatorRow) },
	UpdatedImpersonations: { impersonations: Schema.Array(ImpersonationRow) },
	GotImpersonatorMenuMessage: { message: Menu.Message },
	PressedRevokeImpersonator: { userId: UserId },
	SucceededImpersonatorAction: { userId: UserId },
	FailedImpersonatorAction: { userId: UserId, reason: ImpersonatorFailure },
})
export type Message = typeof Message.Type
