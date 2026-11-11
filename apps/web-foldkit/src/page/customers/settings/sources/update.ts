import type * as Customers from "@hazel/domain/customers"
import type { CustomerConnectionId } from "@hazel/schema"
import { Redacted, Result } from "effect"
import { Command } from "foldkit"
import * as AsyncData from "foldkit/asyncData"
import { failureMessage } from "~/lib/error-messages"
import { defaultConfigOf, providerOf } from "../../../../customers/providers"
import { errorToastOf, successToast } from "../../../../data/actions"
import type { AppRoute } from "../../../../route"
import * as Modal from "../../../../ui/modal"
import type { PageReturn, Shared } from "../../../contract"
import { PageOutMessage } from "../../../out-message"
import { isCustomersAdmin } from "../shared"
import {
	ConnectCustomerSource,
	CopyCustomerWebhookUrl,
	DisconnectCustomerSource,
	FetchUnmatchedCount,
	SaveCustomerSourceSettings,
	SaveCustomerWebhookSecret,
	SeedCustomersDemo,
	SyncCustomerSource,
	UpdateCustomerSourceKeys,
} from "./commands"
import type { ConfigTarget, DisconnectFailure, SeedFailure, SyncFailure } from "./message"
import { Message } from "./message"
import {
	CONNECT_MODAL_ID,
	type ConnectForm,
	connectFailureMessage,
	connectionOf,
	DISCONNECT_MODAL_ID,
	isLive,
	isSettingsDirty,
	isSettingsValid,
	KEYS_MODAL_ID,
	type Model,
	settingsOf,
	withConfigField,
} from "./model"
import type { ConnectionRow } from "./queries"

type Return = PageReturn<Model, Message>
type Route = Extract<AppRoute, { _tag: "CustomersSettingsSources" | "CustomersSourceDetail" }>

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

const seedFailureMessage = (reason: SeedFailure) =>
	failureMessage(reason, {
		Refused: { title: "Demo data is off here", description: "It is only available in dev and preview." },
	})

// INIT

/** The unmatched count is admins' (the RPC refuses members), so only they ask for it. */
const fetchUnmatched = (model: Model, shared: Shared): Return => {
	const organizationId = shared.organization?.id
	return organizationId === undefined || !isCustomersAdmin(shared)
		? { model }
		: {
				model: { ...model, unmatched: AsyncData.Loading() },
				commands: [FetchUnmatchedCount({ organizationId })],
			}
}

export const init = (route: Route, shared: Shared): Return =>
	fetchUnmatched(
		{
			provider: route._tag === "CustomersSourceDetail" ? route.provider : null,
			connections: null,
			syncRuns: null,
			accountCount: null,
			members: [],
			unmatched: AsyncData.Idle(),
			syncing: [],
			isSeedingDemo: false,
			historyFilter: "all",
			connectModal: Modal.init(CONNECT_MODAL_ID),
			connectForm: null,
			keysModal: Modal.init(KEYS_MODAL_ID),
			keysForm: null,
			disconnectModal: Modal.init(DISCONNECT_MODAL_ID),
			isDisconnecting: false,
			settingsDraft: null,
			activityEventInput: "",
			isSavingSettings: false,
		},
		shared,
	)

/** The organization arrived after the page opened. */
export const sharedChanged = (model: Model, shared: Shared): Return =>
	AsyncData.isIdle(model.unmatched) ? fetchUnmatched(model, shared) : { model }

// HELPERS

const detailConnection = (model: Model): ConnectionRow | undefined =>
	model.provider === null ? undefined : connectionOf(model, model.provider)

const withConnectForm = (model: Model, patch: (form: ConnectForm) => ConnectForm): Model =>
	model.connectForm === null ? model : { ...model, connectForm: patch(model.connectForm) }

const openConnect = (model: Model, form: ConnectForm): Return => ({
	model: { ...model, connectForm: form, connectModal: Modal.open(model.connectModal).model },
})

const newConnectForm = (
	provider: Customers.CustomerProvider,
	reconnectId: CustomerConnectionId | null,
	config: Customers.ConnectionConfig,
): ConnectForm => ({
	provider,
	reconnectId,
	apiKey: "",
	config,
	connected: null,
	webhookSecret: "",
	isPending: false,
	failure: null,
})

const closeConnect = (model: Model): Model => ({
	...model,
	connectForm: null,
	connectModal: Modal.close(model.connectModal).model,
})

type ModalField = "connectModal" | "keysModal" | "disconnectModal"

/** Its request is running: closing now would lose the answer (or let a second one start). */
const isModalPending = (model: Model, field: ModalField): boolean =>
	field === "connectModal"
		? model.connectForm?.isPending === true
		: field === "keysModal"
			? model.keysForm?.isPending === true
			: model.isDisconnecting

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
			: field === "connectModal"
				? { ...next, connectForm: null }
				: field === "keysModal"
					? { ...next, keysForm: null }
					: { ...next, isDisconnecting: false },
		commands: Command.mapMessages(result.commands ?? [], toMessage),
	}
}

/** Edits the connect form's config or the detail's settings draft. */
const editConfig = (
	model: Model,
	target: ConfigTarget,
	edit: (config: Customers.ConnectionConfig) => Customers.ConnectionConfig,
): Model => {
	if (target === "connect")
		return withConnectForm(model, (form) => ({ ...form, config: edit(form.config), failure: null }))
	const connection = detailConnection(model)
	return connection === undefined ? model : { ...model, settingsDraft: edit(settingsOf(model, connection)) }
}

type MapleConfig = Extract<Customers.ConnectionConfig, { _tag: "maple" }>

const editMaple = (model: Model, edit: (config: MapleConfig) => MapleConfig): Model =>
	editConfig(model, "settings", (config) => (config._tag === "maple" ? edit(config) : config))

/** What a save sends: Maple's lists trimmed, blank activity events dropped. */
const cleaned = (config: Customers.ConnectionConfig): Customers.ConnectionConfig =>
	config._tag === "maple"
		? {
				...config,
				activityEvents: config.activityEvents
					.map((event) => event.trim())
					.filter((event) => event !== ""),
				metricMappings: config.metricMappings.map((mapping) => ({
					event: mapping.event.trim(),
					metricKey: mapping.metricKey.trim(),
				})),
			}
		: config

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
		UpdatedAccountCount: ({ count }) => ({ model: { ...model, accountCount: count } }),
		UpdatedMembers: ({ members }) => ({ model: { ...model, members } }),
		SucceededFetchUnmatchedCount: ({ count }) => ({
			model: { ...model, unmatched: AsyncData.settle(model.unmatched, Result.succeed(count)) },
		}),
		FailedFetchUnmatchedCount: ({ reason }) => ({
			model: { ...model, unmatched: AsyncData.settle(model.unmatched, Result.fail(reason)) },
		}),

		PressedSyncNow: ({ connectionId }) => syncNow(model, shared, [connectionId]),
		PressedSyncAll: () =>
			syncNow(
				model,
				shared,
				(model.connections ?? []).filter(isLive).map((connection) => connection.id),
			),
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
		PressedLoadDemo: () => {
			const organizationId = shared.organization?.id
			return organizationId === undefined || model.isSeedingDemo
				? { model }
				: {
						model: { ...model, isSeedingDemo: true },
						commands: [SeedCustomersDemo({ organizationId })],
					}
		},
		SucceededSeedDemo: () => ({
			model: { ...model, isSeedingDemo: false },
			outMessage: toast(successToast("Demo data loaded", "Fake customers from demo connections.")),
		}),
		FailedSeedDemo: ({ reason }) => ({
			model: { ...model, isSeedingDemo: false },
			outMessage: toast(errorToastOf(seedFailureMessage(reason))),
		}),
		ClickedHistoryFilter: ({ filter }) => ({ model: { ...model, historyFilter: filter } }),

		// CONNECT

		PressedConnect: ({ provider }) =>
			openConnect(
				model,
				newConnectForm(
					provider,
					null,
					connectionOf(model, provider)?.config ?? defaultConfigOf(provider),
				),
			),
		PressedReconnect: ({ connectionId }) => {
			const connection = model.connections?.find((row) => row.id === connectionId)
			return connection === undefined
				? { model }
				: openConnect(model, newConnectForm(connection.provider, connection.id, connection.config))
		},
		GotConnectModalMessage: ({ message: modalMessage }) =>
			updateModal(model, "connectModal", modalMessage, (child) =>
				Message.GotConnectModalMessage({ message: child }),
			),
		ChangedApiKey: ({ value }) => ({
			model: withConnectForm(model, (form) => ({ ...form, apiKey: value, failure: null })),
		}),
		ToggledConfigField: ({ target, key, isSelected }) => ({
			model: editConfig(model, target, (config) => withConfigField(config, key, isSelected)),
		}),
		ChangedConfigText: ({ target, key, value }) => ({
			model: editConfig(model, target, (config) => withConfigField(config, key, value)),
		}),
		SubmittedConnect: () => {
			const form = model.connectForm
			const organizationId = shared.organization?.id
			if (form === null || organizationId === undefined || form.isPending || form.apiKey.trim() === "")
				return { model }
			return {
				model: withConnectForm(model, (current) => ({ ...current, isPending: true, failure: null })),
				commands: [
					ConnectCustomerSource({
						organizationId,
						provider: form.provider,
						reconnectId: form.reconnectId,
						apiKey: Redacted.make(form.apiKey.trim()),
						config: form.config,
					}),
				],
			}
		},
		SucceededConnect: ({ provider, connectionId, accountName }) =>
			model.connectForm?.provider !== provider
				? { model }
				: {
						model: withConnectForm(model, (form) => ({
							...form,
							apiKey: "",
							isPending: false,
							connected: { connectionId, accountName },
						})),
					},
		FailedConnect: ({ provider, reason }) =>
			model.connectForm?.provider !== provider
				? { model }
				: {
						model: withConnectForm(model, (form) => ({
							...form,
							isPending: false,
							failure: reason,
						})),
					},
		ChangedWebhookSecret: ({ value }) => ({
			model: withConnectForm(model, (form) => ({ ...form, webhookSecret: value, failure: null })),
		}),
		// Done: saves the signing secret first when one was pasted.
		SubmittedWebhookSecret: () => {
			const form = model.connectForm
			const organizationId = shared.organization?.id
			if (form === null || form.connected === null || organizationId === undefined || form.isPending)
				return { model }
			const webhookSecret = form.webhookSecret.trim()
			if (webhookSecret === "") return { model: closeConnect(model) }
			return {
				model: withConnectForm(model, (current) => ({ ...current, isPending: true, failure: null })),
				commands: [
					SaveCustomerWebhookSecret({
						organizationId,
						connectionId: form.connected.connectionId,
						webhookSecret: Redacted.make(webhookSecret),
					}),
				],
			}
		},
		SucceededSaveWebhookSecret: ({ connectionId }) => ({
			model: model.connectForm?.connected?.connectionId === connectionId ? closeConnect(model) : model,
			outMessage: toast(successToast("Signing secret saved")),
		}),
		FailedSaveWebhookSecret: ({ connectionId, reason }) =>
			model.connectForm?.connected?.connectionId !== connectionId
				? { model }
				: {
						model: withConnectForm(model, (form) => ({
							...form,
							isPending: false,
							failure: reason,
						})),
					},
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

		ChangedActivityEventInput: ({ value }) => ({ model: { ...model, activityEventInput: value } }),
		AddedActivityEvent: () => {
			const event = model.activityEventInput.trim()
			if (event === "") return { model }
			return {
				model: {
					...editMaple(model, (config) =>
						config.activityEvents.includes(event)
							? config
							: { ...config, activityEvents: [...config.activityEvents, event] },
					),
					activityEventInput: "",
				},
			}
		},
		RemovedActivityEvent: ({ event }) => ({
			model: editMaple(model, (config) => ({
				...config,
				activityEvents: config.activityEvents.filter((current) => current !== event),
			})),
		}),
		AddedMetricMapping: () => ({
			model: editMaple(model, (config) => ({
				...config,
				metricMappings: [...config.metricMappings, { event: "", metricKey: "" }],
			})),
		}),
		RemovedMetricMapping: ({ index }) => ({
			model: editMaple(model, (config) => ({
				...config,
				metricMappings: config.metricMappings.filter((_, current) => current !== index),
			})),
		}),
		ChangedMetricMapping: ({ index, field, value }) => ({
			model: editMaple(model, (config) => ({
				...config,
				metricMappings: config.metricMappings.map((mapping, current) =>
					current === index ? { ...mapping, [field]: value } : mapping,
				),
			})),
		}),
		ClickedLookback: ({ days }) => ({
			model: editMaple(model, (config) => ({ ...config, lookbackDays: days })),
		}),
		PressedDiscardSettings: () => ({ model: { ...model, settingsDraft: null, activityEventInput: "" } }),
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
			// Settings are saved from a source's detail, where `provider` is set.
			return model.provider === null
				? { model: next }
				: {
						model: next,
						outMessage: toast(errorToastOf(connectFailureMessage(reason, model.provider))),
					}
		},
	})
