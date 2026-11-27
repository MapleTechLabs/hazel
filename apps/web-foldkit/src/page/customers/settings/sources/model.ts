import { IntegrationConfig, type SettingsField } from "@hazel/customer-integrations"
import { readField } from "@hazel/shared-screens/customers/settings/sources/config"
import { ConnectFailure } from "@hazel/shared-screens/customers/settings/sources/status"
import type { ConnectionConfig } from "@hazel/domain/customers"
import * as Customers from "@hazel/domain/customers"
import { CustomerConnectionId, UserId } from "@hazel/schema"
import { Option, Schema } from "effect"
import { providerOf } from "../../../../customers/providers"
import { ImpersonatorRow, MemberRow } from "../../../../customers/queries"
import * as Menu from "../../../../ui/menu"
import * as Modal from "../../../../ui/modal"
import { ConnectionRow, ImpersonationRow, SyncRunRow, UnitMetricRow } from "./queries"

/**
 * A data source's detail (`docs/customers/spec.md` §5): its connection, sync runs and settings.
 * The overview and the connect modal are native (`shared-screens/customers/.../sources`).
 */

export { connectFailureMessage } from "@hazel/shared-screens/customers/settings/sources/status"
export { ConnectFailure }
export {
	configFlag,
	configText,
	withConfigField,
} from "@hazel/shared-screens/customers/settings/sources/config"

/** "Update keys": a new API key, a new signing secret, or both; blank keeps the current one. */
export const KeysForm = Schema.Struct({
	connectionId: CustomerConnectionId,
	apiKey: Schema.String,
	webhookSecret: Schema.String,
	isPending: Schema.Boolean,
	failure: Schema.NullOr(ConnectFailure),
})
export type KeysForm = typeof KeysForm.Type

export const HistoryFilter = Schema.Literals(["all", "failed"])
export type HistoryFilter = typeof HistoryFilter.Type

export const Model = Schema.Struct({
	/** The detail route's provider. */
	provider: Customers.CustomerProvider,
	/** Live rows; null until each query answers. */
	connections: Schema.NullOr(Schema.Array(ConnectionRow)),
	syncRuns: Schema.NullOr(Schema.Array(SyncRunRow)),
	members: Schema.Array(MemberRow),
	/** "Sync now" sent and not yet answered. */
	syncing: Schema.Array(CustomerConnectionId),
	historyFilter: HistoryFilter,
	keysModal: Modal.Model,
	keysForm: Schema.NullOr(KeysForm),
	disconnectModal: Modal.Model,
	isDisconnecting: Schema.Boolean,
	/** The detail's provider settings while edited; null shows the connection's own. */
	settingsDraft: Schema.NullOr(IntegrationConfig),
	/** What is typed in each settings string list's "add" field, by the field's config key. */
	settingsListInputs: Schema.Record(Schema.String, Schema.String),
	isSavingSettings: Schema.Boolean,
	/** The sources' own metrics; null until the query answers. */
	unitMetrics: Schema.NullOr(Schema.Array(UnitMetricRow)),
	/** A metric's unit while typed, by key; saved on Enter or blur. */
	unitDrafts: Schema.Record(Schema.String, Schema.String),
	/** The impersonation section: who may, the recent sign-ins, the "Add member" picker. */
	impersonators: Schema.Array(ImpersonatorRow),
	impersonations: Schema.Array(ImpersonationRow),
	impersonatorMenu: Menu.Model,
	/** Grants asked and not answered yet: their Remove waits (a revoke could land before the grant). */
	pendingGrants: Schema.Array(UserId),
})
export type Model = typeof Model.Type

export const KEYS_MODAL_ID = "customers-source-keys"
export const DISCONNECT_MODAL_ID = "customers-source-disconnect"
export const IMPERSONATOR_MENU_ID = "customers-impersonator-add"

// WHAT IS SHOWN

export const connectionOf = (model: Model, provider: Customers.CustomerProvider): ConnectionRow | undefined =>
	model.connections?.find((connection) => connection.provider === provider)

/** Connected, failing or syncing; a disconnected connection's data stays, marked stale. */
export const isLive = (connection: ConnectionRow): boolean => connection.status !== "disconnected"

/** The connection's runs, newest first (the source keeps the last 7 days). */
export const runsOf = (model: Model, connectionId: CustomerConnectionId): ReadonlyArray<SyncRunRow> =>
	(model.syncRuns ?? []).filter((run) => run.connectionId === connectionId)

export const runningRunOf = (model: Model, connectionId: CustomerConnectionId): SyncRunRow | undefined =>
	runsOf(model, connectionId).find((run) => run.status === "running")

export type SourceStatus = "connected" | "syncing" | "failing" | "disconnected"

export const statusOf = (model: Model, connection: ConnectionRow): SourceStatus =>
	connection.status === "disconnected"
		? "disconnected"
		: connection.status === "error"
			? "failing"
			: runningRunOf(model, connection.id) === undefined
				? "connected"
				: "syncing"

export const visibleRuns = (model: Model, connectionId: CustomerConnectionId): ReadonlyArray<SyncRunRow> =>
	runsOf(model, connectionId).filter((run) => model.historyFilter === "all" || run.status === "failed")

/** The members "Add member" offers: those without a grant. */
export const grantableMembers = (model: Model): ReadonlyArray<MemberRow> =>
	model.members.filter((member) => !model.impersonators.some((row) => row.userId === member.id))

const isSameConfig = Schema.toEquivalence(IntegrationConfig)

/** The provider settings the detail shows: the draft while edited, else the connection's. */
export const settingsOf = (model: Model, connection: ConnectionRow): IntegrationConfig =>
	model.settingsDraft ?? connection.config

export const isSettingsDirty = (model: Model, connection: ConnectionRow): boolean =>
	model.settingsDraft !== null && !isSameConfig(model.settingsDraft, connection.config)

/** The `settings` fields the config's integration declares, in order. */
export const settingsFieldsOf = (config: ConnectionConfig): ReadonlyArray<SettingsField> =>
	Object.values(providerOf(config._tag).settings ?? {})

/** Why the settings can't be saved yet: a row of a key-value list has a blank cell. */
export const settingsProblemOf = (config: IntegrationConfig): string | null =>
	settingsFieldsOf(config).flatMap((field) =>
		"columns" in field &&
		configRows(config, field.key).some((row) =>
			field.columns.some((column) => cellOf(row, column.key).trim() === ""),
		)
			? [field.incompleteProblem]
			: [],
	)[0] ?? null

export const isSettingsValid = (config: IntegrationConfig): boolean => settingsProblemOf(config) === null

/** `config` with a settings field replaced: a draft may hold what the schema refuses until saved. */
export const withConfigValue = (
	config: IntegrationConfig,
	key: string,
	value: ConfigRows | ReadonlyArray<string> | number,
): IntegrationConfig => ({ ...config, [key]: value })

const StringList = Schema.Array(Schema.String)
const Rows = Schema.Array(Schema.Record(Schema.String, Schema.String))

/** A settings string list in `config`. */
export const configList = (config: ConnectionConfig, key: string): ReadonlyArray<string> =>
	readField(config, key, StringList, [])

export type ConfigRows = ReadonlyArray<Readonly<Record<string, string>>>

/** A settings key-value list in `config`. */
export const configRows = (config: ConnectionConfig, key: string): ConfigRows =>
	readField(config, key, Rows, [])

export const cellOf = (row: Readonly<Record<string, string>>, key: string): string => row[key] ?? ""

/** A settings number in `config`. */
export const configNumber = (config: ConnectionConfig, key: string): number =>
	readField(config, key, Schema.Number, 0)
