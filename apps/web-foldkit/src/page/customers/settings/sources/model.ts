import * as Customers from "@hazel/domain/customers"
import { CustomerConnectionId } from "@hazel/schema"
import { Option, Schema } from "effect"
import * as AsyncData from "foldkit/asyncData"
import { CommonReason, failureMessage, type UserErrorMessage } from "~/lib/error-messages"
import { providerOf } from "../../../../customers/providers"
import { MemberRow } from "../../../../customers/queries"
import * as Modal from "../../../../ui/modal"
import { ConnectionRow, SyncRunRow } from "./queries"

/**
 * Data sources (`docs/customers/spec.md` §5): every provider's connection, its sync runs and
 * settings, the connect flow. One page for the overview and a source's detail (`provider` set).
 */

/**
 * What a connect, a key rotation or a settings save can answer beyond the shared reasons: the
 * provider refused the key, could not be reached to check it, has no integration yet, the request
 * was refused as malformed, or the connection is gone.
 */
export const ConnectFailure = Schema.Union([
	Schema.Literals(["Refused", "Unreachable", "ComingSoon", "Invalid", "NotFound"]),
	CommonReason,
])
export type ConnectFailure = typeof ConnectFailure.Type

/** What a connect, a key rotation or a settings save says when it fails. */
export const connectFailureMessage = (
	reason: ConnectFailure,
	provider: Customers.CustomerProvider,
): UserErrorMessage => {
	const name = providerOf(provider).name
	return failureMessage(reason, {
		Refused: {
			title: "Key was refused",
			description: `${name} did not accept this key. Check that it is live and has the permissions listed, then test again. Nothing was imported.`,
		},
		Unreachable: {
			title: `Couldn't reach ${name}`,
			description: "The key could not be checked right now. Try again in a moment.",
		},
		ComingSoon: {
			title: `The ${name} integration is coming soon`,
			description: "Hazel can't sync from it yet. Nothing was stored.",
		},
		Invalid: {
			title: "Hazel couldn't use these settings",
			description: "Check the fields and try again.",
		},
		NotFound: { title: "This connection is gone", description: "It was disconnected meanwhile." },
	})
}

/** The connect modal: the key and matching options, then (once connected) the webhook step. */
export const ConnectForm = Schema.Struct({
	provider: Customers.CustomerProvider,
	/** Rotating the key of this connection (`customers.connection.update`); null: a new connection. */
	reconnectId: Schema.NullOr(CustomerConnectionId),
	apiKey: Schema.String,
	config: Customers.ConnectionConfig,
	/** The connection the key opened: the webhook URL needs its id. */
	connected: Schema.NullOr(
		Schema.Struct({ connectionId: CustomerConnectionId, accountName: Schema.NullOr(Schema.String) }),
	),
	webhookSecret: Schema.String,
	/** The connect (or, once connected, the secret's save) in flight, and how the last one failed. */
	isPending: Schema.Boolean,
	failure: Schema.NullOr(ConnectFailure),
})
export type ConnectForm = typeof ConnectForm.Type

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

export const UnmatchedCount = AsyncData.Schema(Schema.Int, CommonReason)
export type UnmatchedCount = typeof UnmatchedCount.schema.Type

export const Model = Schema.Struct({
	/** The detail route's provider; null on the overview. */
	provider: Schema.NullOr(Customers.CustomerProvider),
	/** Live rows; null until each query answers. */
	connections: Schema.NullOr(Schema.Array(ConnectionRow)),
	syncRuns: Schema.NullOr(Schema.Array(SyncRunRow)),
	accountCount: Schema.NullOr(Schema.Int),
	members: Schema.Array(MemberRow),
	/** Open unmatched records (`customers.unmatched.list`'s `openCount`). */
	unmatched: UnmatchedCount.schema,
	/** "Sync now" sent and not yet answered. */
	syncing: Schema.Array(CustomerConnectionId),
	isSeedingDemo: Schema.Boolean,
	historyFilter: HistoryFilter,
	connectModal: Modal.Model,
	connectForm: Schema.NullOr(ConnectForm),
	keysModal: Modal.Model,
	keysForm: Schema.NullOr(KeysForm),
	disconnectModal: Modal.Model,
	isDisconnecting: Schema.Boolean,
	/** The detail's provider settings while edited; null shows the connection's own. */
	settingsDraft: Schema.NullOr(Customers.ConnectionConfig),
	/** Maple's "add an activity event" field. */
	activityEventInput: Schema.String,
	isSavingSettings: Schema.Boolean,
})
export type Model = typeof Model.Type

export const CONNECT_MODAL_ID = "customers-source-connect"
export const KEYS_MODAL_ID = "customers-source-keys"
export const DISCONNECT_MODAL_ID = "customers-source-disconnect"

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

const isSameConfig = Schema.toEquivalence(Customers.ConnectionConfig)

/** The provider settings the detail shows: the draft while edited, else the connection's. */
export const settingsOf = (model: Model, connection: ConnectionRow): Customers.ConnectionConfig =>
	model.settingsDraft ?? connection.config

export const isSettingsDirty = (model: Model, connection: ConnectionRow): boolean =>
	model.settingsDraft !== null && !isSameConfig(model.settingsDraft, connection.config)

/** Why the settings can't be saved yet: each Maple metric row needs both halves. */
export const settingsProblemOf = (config: Customers.ConnectionConfig): string | null =>
	config._tag !== "maple" ||
	config.metricMappings.every((mapping) => mapping.event.trim() !== "" && mapping.metricKey.trim() !== "")
		? null
		: "Fill in or remove the empty metric rows"

export const isSettingsValid = (config: Customers.ConnectionConfig): boolean =>
	settingsProblemOf(config) === null

/**
 * `config` with one of its fields set, when the value fits the field: a descriptor's `ConfigField`
 * names the key, and the config's schema checks it.
 */
export const withConfigField = (
	config: Customers.ConnectionConfig,
	key: string,
	value: string | boolean,
): Customers.ConnectionConfig =>
	Option.getOrElse(
		Schema.decodeUnknownOption(Customers.ConnectionConfig)({ ...config, [key]: value }),
		() => config,
	)

const fieldOf = (config: Customers.ConnectionConfig, key: string) =>
	Object.entries(config).find(([field]) => field === key)?.[1]

/** A descriptor's Toggle field in `config`. */
export const configFlag = (config: Customers.ConnectionConfig, key: string): boolean =>
	fieldOf(config, key) === true

/** A descriptor's Text field in `config`. */
export const configText = (config: Customers.ConnectionConfig, key: string): string => {
	const value = fieldOf(config, key)
	return typeof value === "string" ? value : ""
}
