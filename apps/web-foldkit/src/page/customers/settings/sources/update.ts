import {
	defaultConfigOf,
	IntegrationConfig,
	type KeyValueListField,
	type SettingsField,
} from "@hazel/customer-integrations"
import type * as Customers from "@hazel/domain/customers"
import type { CustomerConnectionId, UserId } from "@hazel/schema"
import { Record, Redacted, Schema } from "effect"
import { Command } from "foldkit"
import { failureMessage } from "~/lib/error-messages"
import { providerOf } from "../../../../customers/providers"
import { errorToastOf, successToast } from "../../../../data/actions"
import type { AppRoute } from "../../../../route"
import * as Menu from "../../../../ui/menu"
import * as Modal from "../../../../ui/modal"
import type { PageReturn, Shared } from "../../../contract"
import { CustomerSourceConnect } from "../../../../overlay/modal/requests"
import { PageOutMessage } from "../../../out-message"
import {
	CopyCustomerWebhookUrl,
	DisconnectCustomerSource,
	GrantCustomerImpersonator,
	RevokeCustomerImpersonator,
	SaveCustomerSourceSettings,
	SaveMetricUnit,
	SyncCustomerSource,
	UpdateCustomerSourceKeys,
} from "./commands"
import type { DisconnectFailure, ImpersonatorFailure, SyncFailure, UnitFailure } from "./message"
import { Message } from "./message"
import {
	cellOf,
	configList,
	configRows,
	type ConfigRows,
	connectFailureMessage,
	connectionOf,
	DISCONNECT_MODAL_ID,
	grantableMembers,
	IMPERSONATOR_MENU_ID,
	isLive,
	isSettingsDirty,
	isSettingsValid,
	KEYS_MODAL_ID,
	type Model,
	settingsFieldsOf,
	settingsOf,
	withConfigField,
	withConfigValue,
} from "./model"
import type { ConnectionRow } from "./queries"

type Return = PageReturn<Model, Message>
type Route = Extract<AppRoute, { _tag: "CustomersSourceDetail" }>

const connectModal = (modal: Omit<typeof CustomerSourceConnect.Type, "_tag">) =>
	PageOutMessage.RequestedModal({ modal: CustomerSourceConnect.make(modal) })

const isIntegrationConfig = Schema.is(IntegrationConfig)

const toast = (request: Parameters<typeof PageOutMessage.RequestedToast>[0]["toast"]) =>
	PageOutMessage.RequestedToast({ toast: request })

// COPY

const syncFailureMessage = (reason: SyncFailure, provider: Customers.CustomerProvider | undefined) => {
	const name = provider === undefined ? "This source" : providerOf(provider).name
	return failureMessage(reason, {
		NotFound: { title: `${name} is not connected`, description: "Connect it again to sync." },
		ComingSoon: {
			title: `The ${name} integration is coming soon`,
			description: "Hazel can't sync from it yet.",
		},
	})
}

const disconnectFailureMessage = (reason: DisconnectFailure) =>
	failureMessage(reason, { NotFound: { title: "Already disconnected" } })

const unitFailureMessage = (reason: UnitFailure) =>
	failureMessage(reason, {
		NotFound: { title: "This metric is gone", description: "Its source no longer defines it." },
	})

const impersonatorFailureMessage = (reason: ImpersonatorFailure) =>
	failureMessage(reason, {
		NotMember: {
			title: "Couldn't let them impersonate",
			description: "They are no longer a member of this organization.",
		},
	})

// INIT

export const init = (route: Route): Return => ({
	model: {
		provider: route.provider,
		connections: null,
		syncRuns: null,
		members: [],
		syncing: [],
		historyFilter: "all",
		keysModal: Modal.init(KEYS_MODAL_ID),
		keysForm: null,
		disconnectModal: Modal.init(DISCONNECT_MODAL_ID),
		isDisconnecting: false,
		settingsDraft: null,
		settingsListInputs: {},
		isSavingSettings: false,
		unitMetrics: null,
		unitDrafts: {},
		impersonators: [],
		impersonations: [],
		impersonatorMenu: Menu.init({ id: IMPERSONATOR_MENU_ID, placement: "bottom end" }),
		pendingGrants: [],
	},
})

// HELPERS

const detailConnection = (model: Model): ConnectionRow | undefined => connectionOf(model, model.provider)

type ModalField = "keysModal" | "disconnectModal"

/** Its request is running: closing now would lose the answer (or let a second one start). */
const isModalPending = (model: Model, field: ModalField): boolean =>
	field === "keysModal" ? model.keysForm?.isPending === true : model.isDisconnecting

/** A Modal's own Messages; closing from inside drops its form, and waits while its request runs. */
const updateModal = (
	model: Model,
	field: ModalField,
	message: Modal.Message,
	toMessage: (message: Modal.Message) => Message,
): Return => {
	if (Modal.isCloseRequest(message) && isModalPending(model, field)) return { model }
	const result = Modal.update(model[field], message)
	const isClosed = result.outMessage?._tag === "Closed"
	const next: Model = { ...model, [field]: result.model }
	return {
		model: !isClosed
			? next
			: field === "keysModal"
				? { ...next, keysForm: null }
				: { ...next, isDisconnecting: false },
		commands: Command.mapMessages(result.commands ?? [], toMessage),
	}
}

/** Edits the detail's settings draft. */
const editConfig = (model: Model, edit: (config: IntegrationConfig) => IntegrationConfig): Model => {
	const connection = detailConnection(model)
	return connection === undefined ? model : { ...model, settingsDraft: edit(settingsOf(model, connection)) }
}

/** Edits a declared settings field of the draft; a key its integration does not declare changes nothing. */
const editSettingsField = (
	model: Model,
	key: string,
	edit: (config: IntegrationConfig, field: SettingsField) => IntegrationConfig,
): Model =>
	editConfig(model, (config) => {
		const field = settingsFieldsOf(config).find((candidate) => candidate.key === key)
		return field === undefined ? config : edit(config, field)
	})

const editStringList = (
	model: Model,
	key: string,
	edit: (values: ReadonlyArray<string>) => ReadonlyArray<string>,
): Model =>
	editSettingsField(model, key, (config, field) =>
		"columns" in field || "options" in field
			? config
			: withConfigValue(config, key, edit(configList(config, key))),
	)

const editRows = (
	model: Model,
	key: string,
	edit: (rows: ConfigRows, field: KeyValueListField) => ConfigRows,
): Model =>
	editSettingsField(model, key, (config, field) =>
		"columns" in field ? withConfigValue(config, key, edit(configRows(config, key), field)) : config,
	)

/** What a save sends: the settings lists trimmed, blank strings dropped. */
const cleaned = (config: IntegrationConfig): IntegrationConfig =>
	settingsFieldsOf(config).reduce((current, field) => {
		if ("options" in field) return current
		if ("columns" in field)
			return withConfigValue(
				current,
				field.key,
				configRows(current, field.key).map((row) =>
					Object.fromEntries(field.columns.map(({ key }) => [key, cellOf(row, key).trim()])),
				),
			)
		return withConfigValue(
			current,
			field.key,
			configList(current, field.key)
				.map((value) => value.trim())
				.filter((value) => value !== ""),
		)
	}, config)

/** The grant (or revoke) for `userId` was answered. */
const settled = (model: Model, userId: UserId): Model => ({
	...model,
	pendingGrants: model.pendingGrants.filter((id) => id !== userId),
})

/** "Add member": grants the picked member, if still without a grant. */
const grantImpersonator = (model: Model, shared: Shared, key: string): Return => {
	const member = grantableMembers(model).find((entry) => entry.id === key)
	const organizationId = shared.organization?.id
	const grantedBy = shared.currentUser?.id
	return member === undefined || organizationId === undefined || grantedBy === undefined
		? { model }
		: {
				model: { ...model, pendingGrants: [...model.pendingGrants, member.id] },
				commands: [GrantCustomerImpersonator({ organizationId, userId: member.id, grantedBy })],
			}
}

const syncNow = (
	model: Model,
	shared: Shared,
	connectionIds: ReadonlyArray<CustomerConnectionId>,
): Return => {
	const organizationId = shared.organization?.id
	const ids = connectionIds.filter((id) => !model.syncing.includes(id))
	if (organizationId === undefined || ids.length === 0) return { model }
	return {
		model: { ...model, syncing: [...model.syncing, ...ids] },
		commands: ids.map((connectionId) => SyncCustomerSource({ organizationId, connectionId })),
	}
}

// UPDATE

export const update = (model: Model, message: Message, shared: Shared): Return =>
	Message.match<Return>(message, {
		UpdatedConnections: ({ connections }) => {
			const next = { ...model, connections }
			// A saved draft is done once the synced row has it.
			const connection = detailConnection(next)
			return {
				model:
					connection !== undefined &&
					next.settingsDraft !== null &&
					!isSettingsDirty(next, connection)
						? { ...next, settingsDraft: null }
						: next,
			}
		},
		UpdatedSyncRuns: ({ runs }) => ({ model: { ...model, syncRuns: runs } }),
		UpdatedMembers: ({ members }) => ({ model: { ...model, members } }),
		UpdatedUnitMetrics: ({ metrics }) => ({ model: { ...model, unitMetrics: metrics } }),
		PressedSyncNow: ({ connectionId }) => syncNow(model, shared, [connectionId]),
		// The card shows the run once it starts; only a failure says anything.
		SucceededSyncNow: ({ connectionId }) => ({
			model: { ...model, syncing: model.syncing.filter((id) => id !== connectionId) },
		}),
		FailedSyncNow: ({ connectionId, reason }) => ({
			model: { ...model, syncing: model.syncing.filter((id) => id !== connectionId) },
			outMessage: toast(
				errorToastOf(
					syncFailureMessage(
						reason,
						model.connections?.find((connection) => connection.id === connectionId)?.provider,
					),
				),
			),
		}),
		ClickedHistoryFilter: ({ filter }) => ({ model: { ...model, historyFilter: filter } }),

		// CONNECT (the native modal)

		PressedConnect: ({ provider }) => {
			const config = connectionOf(model, provider)?.config ?? defaultConfigOf(provider)
			return isIntegrationConfig(config)
				? { model, outMessage: connectModal({ provider, reconnectId: null, config }) }
				: { model }
		},
		PressedReconnect: ({ connectionId }) => {
			const connection = model.connections?.find((row) => row.id === connectionId)
			return connection === undefined
				? { model }
				: {
						model,
						outMessage: connectModal({
							provider: connection.provider,
							reconnectId: connection.id,
							config: connection.config,
						}),
					}
		},
		ToggledConfigField: ({ key, isSelected }) => ({
			model: editConfig(model, (config) => withConfigField(config, key, isSelected)),
		}),
		ChangedConfigText: ({ key, value }) => ({
			model: editConfig(model, (config) => withConfigField(config, key, value)),
		}),
		PressedCopyWebhookUrl: ({ url }) => ({ model, commands: [CopyCustomerWebhookUrl({ url })] }),
		SucceededCopyWebhookUrl: () => ({ model, outMessage: toast(successToast("Webhook URL copied")) }),
		FailedCopyWebhookUrl: () => ({
			model,
			outMessage: toast(
				errorToastOf({
					title: "Couldn't copy the URL",
					description: "Select it and copy it by hand.",
				}),
			),
		}),

		// KEYS

		PressedUpdateKeys: ({ connectionId }) => ({
			model: {
				...model,
				keysForm: { connectionId, apiKey: "", webhookSecret: "", isPending: false, failure: null },
				keysModal: Modal.open(model.keysModal).model,
			},
		}),
		GotKeysModalMessage: ({ message: modalMessage }) =>
			updateModal(model, "keysModal", modalMessage, (child) =>
				Message.GotKeysModalMessage({ message: child }),
			),
		ChangedKeysApiKey: ({ value }) => ({
			model: {
				...model,
				keysForm:
					model.keysForm === null ? null : { ...model.keysForm, apiKey: value, failure: null },
			},
		}),
		ChangedKeysWebhookSecret: ({ value }) => ({
			model: {
				...model,
				keysForm:
					model.keysForm === null
						? null
						: { ...model.keysForm, webhookSecret: value, failure: null },
			},
		}),
		SubmittedKeys: () => {
			const form = model.keysForm
			const organizationId = shared.organization?.id
			if (form === null || organizationId === undefined || form.isPending) return { model }
			const apiKey = form.apiKey.trim()
			const webhookSecret = form.webhookSecret.trim()
			if (apiKey === "" && webhookSecret === "") return { model }
			return {
				model: { ...model, keysForm: { ...form, isPending: true, failure: null } },
				commands: [
					UpdateCustomerSourceKeys({
						organizationId,
						connectionId: form.connectionId,
						apiKey: apiKey === "" ? null : Redacted.make(apiKey),
						webhookSecret: webhookSecret === "" ? null : Redacted.make(webhookSecret),
					}),
				],
			}
		},
		SucceededUpdateKeys: () => ({
			model: { ...model, keysForm: null, keysModal: Modal.close(model.keysModal).model },
			outMessage: toast(successToast("Keys updated")),
		}),
		FailedUpdateKeys: ({ reason }) => ({
			model: {
				...model,
				keysForm:
					model.keysForm === null ? null : { ...model.keysForm, isPending: false, failure: reason },
			},
		}),

		// DISCONNECT

		PressedDisconnect: () => ({
			model: { ...model, disconnectModal: Modal.open(model.disconnectModal).model },
		}),
		GotDisconnectModalMessage: ({ message: modalMessage }) =>
			updateModal(model, "disconnectModal", modalMessage, (child) =>
				Message.GotDisconnectModalMessage({ message: child }),
			),
		ConfirmedDisconnect: ({ connectionId }) => {
			const connection = model.connections?.find((row) => row.id === connectionId)
			const organizationId = shared.organization?.id
			if (connection === undefined || organizationId === undefined || model.isDisconnecting)
				return { model }
			return {
				model: { ...model, isDisconnecting: true },
				commands: [
					DisconnectCustomerSource({ organizationId, connectionId, provider: connection.provider }),
				],
			}
		},
		SucceededDisconnect: ({ provider }) => ({
			model: {
				...model,
				isDisconnecting: false,
				settingsDraft: null,
				disconnectModal: Modal.close(model.disconnectModal).model,
			},
			outMessage: toast(
				successToast(`${providerOf(provider).name} disconnected`, "Its data stays, marked stale."),
			),
		}),
		FailedDisconnect: ({ reason }) => ({
			model: { ...model, isDisconnecting: false },
			outMessage: toast(errorToastOf(disconnectFailureMessage(reason))),
		}),

		// PROVIDER SETTINGS

		ChangedSettingsListInput: ({ key, value }) => ({
			model: { ...model, settingsListInputs: { ...model.settingsListInputs, [key]: value } },
		}),
		AddedSettingsListItem: ({ key }) => {
			const item = (model.settingsListInputs[key] ?? "").trim()
			if (item === "") return { model }
			return {
				model: {
					...editStringList(model, key, (values) =>
						values.includes(item) ? values : [...values, item],
					),
					settingsListInputs: { ...model.settingsListInputs, [key]: "" },
				},
			}
		},
		RemovedSettingsListItem: ({ key, item }) => ({
			model: editStringList(model, key, (values) => values.filter((current) => current !== item)),
		}),
		AddedSettingsRow: ({ key }) => ({
			model: editRows(model, key, (rows, { columns }) => [
				...rows,
				Object.fromEntries(columns.map((column) => [column.key, ""])),
			]),
		}),
		RemovedSettingsRow: ({ key, index }) => ({
			model: editRows(model, key, (rows) => rows.filter((_, current) => current !== index)),
		}),
		ChangedSettingsCell: ({ key, index, column, value }) => ({
			model: editRows(model, key, (rows) =>
				rows.map((row, current) => (current === index ? { ...row, [column]: value } : row)),
			),
		}),
		ClickedSettingsNumber: ({ key, value }) => ({
			model: editSettingsField(model, key, (config, field) =>
				"options" in field ? withConfigValue(config, key, value) : config,
			),
		}),
		PressedDiscardSettings: () => ({ model: { ...model, settingsDraft: null, settingsListInputs: {} } }),
		PressedSaveSettings: () => {
			const connection = detailConnection(model)
			const organizationId = shared.organization?.id
			if (
				connection === undefined ||
				organizationId === undefined ||
				model.isSavingSettings ||
				!isSettingsDirty(model, connection) ||
				!isSettingsValid(settingsOf(model, connection))
			)
				return { model }
			const config = cleaned(settingsOf(model, connection))
			return {
				model: { ...model, settingsDraft: config, isSavingSettings: true },
				commands: [
					SaveCustomerSourceSettings({ organizationId, connectionId: connection.id, config }),
				],
			}
		},
		// The draft stays until the synced row has it (`UpdatedConnections`).
		SucceededSaveSettings: () => ({
			model: { ...model, isSavingSettings: false },
			outMessage: toast(successToast("Settings saved")),
		}),
		FailedSaveSettings: ({ reason }) => {
			const next = { ...model, isSavingSettings: false }
			return {
				model: next,
				outMessage: toast(errorToastOf(connectFailureMessage(reason, model.provider))),
			}
		},

		// USAGE UNITS

		ChangedUnit: ({ metricKey, value }) => ({
			model: { ...model, unitDrafts: { ...model.unitDrafts, [metricKey]: value } },
		}),
		// The draft goes: the metric row takes the unit at once (rolled back if the save fails).
		SubmittedUnit: ({ metricKey }) => {
			const draft = model.unitDrafts[metricKey]
			const metric = model.unitMetrics?.find((row) => row.key === metricKey)
			const organizationId = shared.organization?.id
			if (draft === undefined || metric === undefined || organizationId === undefined) return { model }
			const next = { ...model, unitDrafts: Record.remove(model.unitDrafts, metricKey) }
			const unit = draft.trim() === "" ? null : draft.trim()
			return unit === metric.customUnit
				? { model: next }
				: {
						model: next,
						commands: [SaveMetricUnit({ organizationId, metricId: metric.id, metricKey, unit })],
					}
		},
		SucceededSaveUnit: () => ({ model }),
		FailedSaveUnit: ({ reason }) => ({
			model,
			outMessage: toast(errorToastOf(unitFailureMessage(reason))),
		}),

		// IMPERSONATION

		UpdatedImpersonators: ({ impersonators }) => ({ model: { ...model, impersonators } }),
		UpdatedImpersonations: ({ impersonations }) => ({ model: { ...model, impersonations } }),
		GotImpersonatorMenuMessage: ({ message: menuMessage }) => {
			const result = Menu.update(model.impersonatorMenu, menuMessage)
			const next = { ...model, impersonatorMenu: result.model }
			const granted =
				result.outMessage?._tag === "SelectedItem"
					? grantImpersonator(next, shared, result.outMessage.key)
					: { model: next }
			return {
				...granted,
				commands: [
					...Command.mapMessages(result.commands ?? [], (child) =>
						Message.GotImpersonatorMenuMessage({ message: child }),
					),
					...(granted.commands ?? []),
				],
			}
		},
		// The synced rows change at once (the optimistic action), and come back if the RPC fails.
		PressedRevokeImpersonator: ({ userId }) => {
			const row = model.impersonators.find((entry) => entry.userId === userId)
			const organizationId = shared.organization?.id
			return row === undefined || organizationId === undefined
				? { model }
				: {
						model,
						commands: [
							RevokeCustomerImpersonator({ organizationId, impersonatorId: row.id, userId }),
						],
					}
		},
		SucceededImpersonatorAction: ({ userId }) => ({ model: settled(model, userId) }),
		FailedImpersonatorAction: ({ userId, reason }) => ({
			model: settled(model, userId),
			outMessage: toast(errorToastOf(impersonatorFailureMessage(reason))),
		}),
	})
