import { OrganizationId, SyncConnectionId } from "@hazel/schema"
import { Effect, Option } from "effect"
import { Command, Update } from "foldkit"
import * as AsyncData from "foldkit/asyncData"
import { modifyFields } from "foldkit/struct"
import { orgOfChatSyncConnection } from "~/db/routing-hints"
import { failureMessage } from "~/lib/error-messages"
import { AppRoute, hrefOf } from "../../../route"
import { HazelRpc, type Resources } from "../../../rpc"
import * as Interaction from "../../../ui/aria/interaction"
import * as Menu from "../../../ui/menu"
import * as Modal from "../../../ui/modal"
import { catchCommon, errorToastOf, reasonToast, successToast } from "../../../data/actions"
import type { PageReturn, PageSubscriptionInput, Shared } from "../../contract"
import { PageOutMessage, requestedOrgNavigation } from "../../out-message"
import * as ChatMigration from "../../shared/chat-migration"
import * as ConfirmAction from "../../shared/confirm-action"
import { chosenWorkspace, Connections, type DeleteTarget, Message, type Model, Submission } from "./model"
import { type ChatSyncProvider, isChatSyncProvider, PROVIDERS, Workspaces } from "./providers"
import { fetchConnections } from "./rpc"
import {
	ADD_CONNECTION_MODAL_ID,
	CreateConnection,
	FocusWorkspaceSearch,
	ListWorkspaces,
} from "./add-connection"

type Return = PageReturn<Model, Message>
type Step = Update.StepWithOutMessage<Model, Message, PageOutMessage, Resources>

export const interaction = Interaction.embed<Model, Message, PageSubscriptionInput<Model>>(
	(message) => Message.GotInteractionMessage({ message }),
	(input) => input.model,
)

/** Interaction targets in the add connection modal. */
export const WORKSPACE_SEARCH_TARGET = "workspace-search"
export const CONNECT_TARGET = "connect"

// COMMAND

export const ListConnections = Command.define("ListConnections", {
	args: { organizationId: OrganizationId },
	messages: [Message.SucceededListConnections, Message.FailedListConnections],
	execute: ({ organizationId }) =>
		fetchConnections(organizationId).pipe(
			Effect.map((connections) => Message.SucceededListConnections({ organizationId, connections })),
			catchCommon((reason) => Message.FailedListConnections({ organizationId, reason })),
		),
})

export const DeleteConnection = Command.define("DeleteConnection", {
	args: { syncConnectionId: SyncConnectionId },
	messages: [Message.SucceededDeleteConnection, Message.FailedDeleteConnection],
	execute: ({ syncConnectionId }) =>
		HazelRpc.use((rpc) =>
			rpc("chatSync.connection.delete", {
				syncConnectionId,
				organizationId: orgOfChatSyncConnection(syncConnectionId),
			}),
		).pipe(
			Effect.as(Message.SucceededDeleteConnection()),
			Effect.catchTags({
				ChatSyncConnectionNotFoundError: () =>
					Effect.succeed(Message.FailedDeleteConnection({ reason: "NotFound" })),
			}),
			catchCommon((reason) => Message.FailedDeleteConnection({ reason })),
		),
})

// INIT

/** Runs the list query for the current organization (`organizationId!` waits for it in legacy). */
const requestList = (model: Model, shared: Shared): Return => {
	const organizationId = shared.organization?.id ?? null
	if (organizationId === null || organizationId === model.requestedOrganizationId) return { model }
	return {
		model: modifyFields(model, {
			requestedOrganizationId: () => organizationId,
			connections: () => Connections.Loading(),
		}),
		commands: [ListConnections({ organizationId })],
	}
}

export const MIGRATION_MODAL_ID = "chat-sync-migrate"

const toMigrationMessage = (message: ChatMigration.Message) => Message.GotMigrationMessage({ message })

/** A fresh wizard for the current org; the provider's OAuth comes back to this page. */
const migrationReturnTo = (shared: Shared): string =>
	shared.orgSlug === null
		? hrefOf(AppRoute.Root())
		: hrefOf(AppRoute.SettingsChatSync({ orgSlug: shared.orgSlug }))

const freshMigration = (shared: Shared): ChatMigration.Model =>
	ChatMigration.init({
		id: MIGRATION_MODAL_ID,
		organizationId: shared.organization?.id ?? null,
		returnTo: migrationReturnTo(shared),
	})

export const init = (_route: unknown, shared: Shared): Return => {
	const listed = requestList(
		{
			requestedOrganizationId: null,
			connections: Connections.Loading(),
			addMenu: Menu.init({ id: "chat-sync-add", placement: "bottom end" }),
			emptyAddMenu: Menu.init({ id: "chat-sync-add-empty", placement: "bottom end" }),
			addModal: Modal.init(ADD_CONNECTION_MODAL_ID),
			addProvider: "discord",
			workspaces: Workspaces.Loading(),
			workspacesVersion: 0,
			selectedWorkspace: null,
			workspaceSearch: "",
			isWorkspaceSearchFocused: false,
			submission: Submission.NotSubmitted(),
			deleteConfirm: ConfirmAction.init("chat-sync-delete"),
			interaction: Interaction.init(),
			migrationModal: Modal.init(MIGRATION_MODAL_ID),
			migration: freshMigration(shared),
		},
		shared,
	)
	// Back from a provider's OAuth that the wizard started: it opens again where it left off.
	const migration = ChatMigration.start(listed.model.migration)
	return {
		...listed,
		commands: [
			...(listed.commands ?? []),
			...Command.mapMessages(migration.commands ?? [], toMigrationMessage),
		],
	}
}

const migrationModal = {
	read: (model: Model) => Option.some(model.migrationModal),
	write: (model: Model, modal: Modal.Model): Model => modifyFields(model, { migrationModal: () => modal }),
	toParentMessage: (message: Modal.Message) => Message.GotMigrationModalMessage({ message }),
	foldOutMessage: Modal.ignoreOutMessage,
}
const foldMigrationModal = Update.foldChild({ update: Modal.update, ...migrationModal })
const openMigrationModal = Update.foldChildStep({ update: Modal.open, ...migrationModal })
const closeMigrationModal = Update.foldChildStep({ update: Modal.close, ...migrationModal })

/** Folds a wizard step: its toast goes up, and finishing closes the modal and lists the new connection. */
const foldMigration = (model: Model, message: ChatMigration.Message, shared: Shared): Return => {
	const result = ChatMigration.update(model.migration, message)
	const commands = Command.mapMessages(result.commands ?? [], toMigrationMessage)
	const next = modifyFields(model, { migration: () => result.model })
	const outcome = result.outcome
	// Back from OAuth: open the modal on the step the wizard resumed at.
	const resumed =
		result.model.phase._tag !== "ChoosingProvider" && !model.migrationModal.isOpen
			? openMigrationModal(next)
			: { model: next }
	if (outcome === undefined)
		return { model: resumed.model, commands: [...commands, ...(resumed.commands ?? [])] }
	if (outcome._tag === "Toast")
		return {
			model: resumed.model,
			commands: [...commands, ...(resumed.commands ?? [])],
			outMessage: PageOutMessage.RequestedToast({ toast: outcome.toast }),
		}
	const closed = Update.combine(modifyFields(resumed.model, { migration: () => freshMigration(shared) }), [
		closeMigrationModal,
		reloadConnections,
	])
	return { ...closed, commands: [...commands, ...(closed.commands ?? [])] }
}

export const sharedChanged = (model: Model, shared: Shared): Return => {
	const listed = requestList(model, shared)
	const organizationId = shared.organization?.id ?? null
	if (organizationId === listed.model.migration.organizationId) return listed
	const migration = ChatMigration.withOrganization(
		listed.model.migration,
		organizationId,
		migrationReturnTo(shared),
	)
	const next = modifyFields(listed.model, { migration: () => migration.model })
	const opened =
		migration.model.phase._tag !== "ChoosingProvider" && !next.migrationModal.isOpen
			? openMigrationModal(next)
			: { model: next }
	return {
		model: opened.model,
		commands: [
			...(listed.commands ?? []),
			...Command.mapMessages(migration.commands ?? [], toMigrationMessage),
			...(opened.commands ?? []),
		],
	}
}

// UPDATE

/** `setRefreshKey(k => k + 1)`: the list loads again, keeping the shown list while it does. */
const reloadConnections = (model: Model): Pick<Return, "model" | "commands"> => {
	const organizationId = model.requestedOrganizationId
	if (organizationId === null) return { model }
	return {
		model: modifyFields(model, {
			connections: (connections) =>
				Option.getOrElse(AsyncData.revalidateOrLoad(connections), () => connections),
		}),
		commands: [ListConnections({ organizationId })],
	}
}

/** A new workspace request for the modal's provider; a reply for an older one is dropped. */
const requestWorkspaces = (model: Model, organizationId: OrganizationId): Return => {
	const version = model.workspacesVersion + 1
	return {
		model: modifyFields(model, {
			workspaces: () => Workspaces.Loading(),
			workspacesVersion: () => version,
		}),
		commands: [ListWorkspaces({ organizationId, provider: model.addProvider, version })],
	}
}

/** `handleClose`: a closed add modal has no selection, no search and no failed attempt. */
const addModal = {
	read: (model: Model) => Option.some(model.addModal),
	write: (model: Model, modal: Modal.Model): Model =>
		modal.isOpen
			? modifyFields(model, { addModal: () => modal })
			: modifyFields(model, {
					addModal: () => modal,
					selectedWorkspace: () => null,
					workspaceSearch: () => "",
					isWorkspaceSearchFocused: () => false,
					submission: (submission) =>
						submission._tag === "Failed" ? Submission.NotSubmitted() : submission,
				}),
	toParentMessage: (message: Modal.Message) => Message.GotAddModalMessage({ message }),
	foldOutMessage: Modal.ignoreOutMessage,
}
const foldAddModalChild = Update.foldChild({ update: Modal.update, ...addModal })
const openAddModal = Update.foldChildStep({ update: Modal.open, ...addModal })
const closeAddModal = Update.foldChildStep({ update: Modal.close, ...addModal })

/** `onOpenChange={(open) => !open && handleClose()}`; the search takes focus once the dialog has it. */
const foldAddModal = (model: Model, message: Modal.Message): Return => {
	const result = foldAddModalChild(model, message)
	const focus =
		result.model.addModal.isOpen && Modal.isReady(message) && hasWorkspaceSearch(model)
			? [FocusWorkspaceSearch()]
			: []
	return { model: result.model, commands: [...(result.commands ?? []), ...focus] }
}

/** The search Input is rendered while a provider's workspaces to pick from are listed and none is picked. */
const hasWorkspaceSearch = (model: Model) =>
	PROVIDERS[model.addProvider].picksWorkspace &&
	AsyncData.isSuccess(model.workspaces) &&
	model.selectedWorkspace === null

/** The add menu's pick: the modal opens for that provider, querying its workspaces when it changed. */
const openAddModalFor = (model: Model, provider: ChatSyncProvider) => {
	const organizationId = model.requestedOrganizationId
	if (provider === model.addProvider || organizationId === null) return openAddModal(model)
	const requested = requestWorkspaces(modifyFields(model, { addProvider: () => provider }), organizationId)
	const opened = openAddModal(requested.model)
	return { ...opened, commands: [...(requested.commands ?? []), ...(opened.commands ?? [])] }
}

const submitConnection = (model: Model): Return => {
	const organizationId = model.requestedOrganizationId
	const workspace = chosenWorkspace(model)
	if (organizationId === null || workspace === null || model.submission._tag === "Submitting")
		return { model }
	return {
		// The Connect button disables while it runs, which ends its hover (useHover).
		model: modifyFields(model, {
			submission: () => Submission.Submitting(),
			interaction: (state) => Interaction.disabledTargets(state, [CONNECT_TARGET]),
		}),
		commands: [
			CreateConnection({
				organizationId,
				provider: model.addProvider,
				externalWorkspaceId: workspace.id,
				externalWorkspaceName: workspace.name,
			}),
		],
	}
}

const foldAddMenuOutMessage = Menu.OutMessage.match<Step>({
	SelectedItem:
		({ key }) =>
		(model) =>
			isChatSyncProvider(key) ? openAddModalFor(model, key) : { model },
	ActivatedLink: () => (model) => ({ model }),
})

const foldAddMenu = Update.foldChild({
	update: Menu.update,
	read: (model: Model) => Option.some(model.addMenu),
	write: (model, addMenu) => modifyFields(model, { addMenu: () => addMenu }),
	toParentMessage: (message) => Message.GotAddMenuMessage({ message }),
	foldOutMessage: foldAddMenuOutMessage,
})

const foldEmptyAddMenu = Update.foldChild({
	update: Menu.update,
	read: (model: Model) => Option.some(model.emptyAddMenu),
	write: (model, emptyAddMenu) => modifyFields(model, { emptyAddMenu: () => emptyAddMenu }),
	toParentMessage: (message) => Message.GotEmptyAddMenuMessage({ message }),
	foldOutMessage: foldAddMenuOutMessage,
})

const foldDeleteConfirm = Update.foldChild({
	update: (confirm: ConfirmAction.Model<DeleteTarget>, message: ConfirmAction.Message) =>
		ConfirmAction.update(confirm, message),
	read: (model: Model) => Option.some(model.deleteConfirm),
	write: (model: Model, deleteConfirm: ConfirmAction.Model<DeleteTarget>): Model =>
		modifyFields(model, { deleteConfirm: () => deleteConfirm }),
	toParentMessage: (message: ConfirmAction.Message) => Message.GotDeleteConfirmMessage({ message }),
})

const withDeleteConfirm = (model: Model, deleteConfirm: ConfirmAction.Model<DeleteTarget>): Model =>
	modifyFields(model, { deleteConfirm: () => deleteConfirm })

const isCurrentWorkspaceList = (model: Model, organizationId: OrganizationId, version: number) =>
	organizationId === model.requestedOrganizationId && version === model.workspacesVersion

export const update = (model: Model, message: Message, shared: Shared): Return =>
	Message.match<Return>(message, {
		SucceededListConnections: ({ organizationId, connections }) => {
			if (organizationId !== model.requestedOrganizationId) return { model }
			const next = modifyFields(model, {
				connections: () => Connections.Success({ data: connections }),
			})
			// The add modal mounts with the first list and queries the workspaces then; a refresh keeps it mounted.
			return AsyncData.hasData(model.connections)
				? { model: next }
				: requestWorkspaces(next, organizationId)
		},
		FailedListConnections: ({ organizationId, reason }) => {
			if (organizationId !== model.requestedOrganizationId) return { model }
			// A failed refresh keeps the shown list and says so; a failed first load replaces the spinner.
			return Option.match(AsyncData.getData(model.connections), {
				onSome: (data) => ({
					model: modifyFields(model, {
						connections: () => Connections.Stale({ error: reason, data }),
					}),
					outMessage: PageOutMessage.RequestedToast({ toast: reasonToast(reason) }),
				}),
				onNone: () => ({
					model: modifyFields(model, { connections: () => Connections.Failure({ error: reason }) }),
				}),
			})
		},
		ClickedRetryListConnections: () => reloadConnections(model),
		SucceededListWorkspaces: ({ organizationId, version, workspaces }) => {
			if (!isCurrentWorkspaceList(model, organizationId, version)) return { model }
			const next = modifyFields(model, { workspaces: () => Workspaces.Success({ data: workspaces }) })
			// The search mounts with `autoFocus` when the workspaces arrive while the modal is open.
			return {
				model: next,
				commands: model.addModal.isOpen && hasWorkspaceSearch(next) ? [FocusWorkspaceSearch()] : [],
			}
		},
		FailedListWorkspaces: ({ organizationId, version, reason }) =>
			isCurrentWorkspaceList(model, organizationId, version)
				? { model: modifyFields(model, { workspaces: () => Workspaces.Failure({ error: reason }) }) }
				: { model },
		ClickedRetryListWorkspaces: () =>
			model.requestedOrganizationId === null
				? { model }
				: requestWorkspaces(model, model.requestedOrganizationId),
		ClickedConnection: ({ connectionId }) => ({
			model,
			outMessage: requestedOrgNavigation(shared.orgSlug, (orgSlug) =>
				AppRoute.SettingsChatSyncConnection({ orgSlug, connectionId }),
			),
		}),
		ClickedDeleteConnection: ({ target }) => ({
			model: withDeleteConfirm(model, ConfirmAction.ask(model.deleteConfirm, target)),
		}),
		ClickedConfirmDelete: () =>
			Option.match(ConfirmAction.confirm(model.deleteConfirm), {
				onNone: () => ({ model }),
				onSome: ([running, target]) => ({
					model: withDeleteConfirm(model, running),
					commands: [DeleteConnection({ syncConnectionId: target.id })],
				}),
			}),
		SucceededDeleteConnection: () => ({
			...reloadConnections(withDeleteConfirm(model, ConfirmAction.close(model.deleteConfirm))),
			outMessage: PageOutMessage.RequestedToast({ toast: successToast("Connection deleted") }),
		}),
		FailedDeleteConnection: ({ reason }) => ({
			model: withDeleteConfirm(model, ConfirmAction.failed(model.deleteConfirm)),
			outMessage: PageOutMessage.RequestedToast({
				toast: errorToastOf(
					failureMessage(reason, {
						NotFound: {
							title: "Connection not found",
							description: "This connection may have already been deleted.",
						},
					}),
				),
			}),
		}),
		GotAddMenuMessage: ({ message: menuMessage }) => foldAddMenu(model, menuMessage),
		GotEmptyAddMenuMessage: ({ message: menuMessage }) => foldEmptyAddMenu(model, menuMessage),
		GotDeleteConfirmMessage: ({ message: confirmMessage }) => foldDeleteConfirm(model, confirmMessage),
		GotAddModalMessage: ({ message: modalMessage }) => foldAddModal(model, modalMessage),
		ChangedWorkspaceSearch: ({ value }) => ({
			model: modifyFields(model, { workspaceSearch: () => value }),
		}),
		FocusedWorkspaceSearch: () => ({
			model: modifyFields(model, { isWorkspaceSearchFocused: () => true }),
		}),
		BlurredWorkspaceSearch: () => ({
			model: modifyFields(model, { isWorkspaceSearchFocused: () => false }),
		}),
		CompletedFocusWorkspaceSearch: () => ({ model }),
		ClickedWorkspace: ({ workspace }) => ({
			model: modifyFields(model, {
				selectedWorkspace: () => workspace,
				isWorkspaceSearchFocused: () => false,
			}),
		}),
		ClickedChangeWorkspace: () => ({
			model: modifyFields(model, { selectedWorkspace: () => null }),
			commands: [FocusWorkspaceSearch()],
		}),
		ClickedOpenIntegration: () => ({
			model,
			outMessage: requestedOrgNavigation(shared.orgSlug, (orgSlug) =>
				AppRoute.SettingsIntegration({
					orgSlug,
					integrationId: PROVIDERS[model.addProvider].integrationId,
					connectionStatus: Option.none(),
					errorCode: Option.none(),
				}),
			),
		}),
		ClickedConnect: () => submitConnection(model),
		ClickedImport: () =>
			openMigrationModal(modifyFields(model, { migration: () => freshMigration(shared) })),
		// Closing it mid-way drops the wizard's progress (unless a request is running, which settles first).
		GotMigrationModalMessage: ({ message: modalMessage }) => {
			const result = foldMigrationModal(model, modalMessage)
			return result.model.migrationModal.isOpen || ChatMigration.isBusy(model.migration)
				? result
				: {
						...result,
						model: modifyFields(result.model, { migration: () => freshMigration(shared) }),
					}
		},
		GotMigrationMessage: ({ message: migrationMessage }) =>
			foldMigration(model, migrationMessage, shared),
		GotInteractionMessage: ({ message }) => interaction.fold(model, message),
		// `onSuccess()` reloads the list (a new query key), then `handleClose()`.
		SucceededCreateConnection: () => ({
			...Update.combine(modifyFields(model, { submission: () => Submission.NotSubmitted() }), [
				closeAddModal,
				reloadConnections,
			]),
			outMessage: PageOutMessage.RequestedToast({
				toast: successToast(`${PROVIDERS[model.addProvider].name} connection created`),
			}),
		}),
		FailedCreateConnection: ({ reason }) => {
			const { name, copy } = PROVIDERS[model.addProvider]
			return {
				model: modifyFields(model, { submission: () => Submission.Failed({ reason }) }),
				outMessage: PageOutMessage.RequestedToast({
					toast: errorToastOf(
						failureMessage(reason, {
							AlreadyExists: {
								title: "Connection already exists",
								description: copy.alreadyConnected,
							},
							NotConnected: {
								title: `${name} not connected`,
								description: copy.createNotConnected,
							},
						}),
					),
				}),
			}
		},
	})
