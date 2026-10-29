import { OrganizationId, SyncConnectionId } from "@hazel/schema"
import { Effect, Option, Schema } from "effect"
import { Command, Update } from "foldkit"
import * as AsyncData from "foldkit/asyncData"
import { modifyFields } from "foldkit/struct"
import { orgOfChatSyncConnection } from "~/db/routing-hints"
import { failureMessage } from "~/lib/error-messages"
import { AppRoute } from "../../../route"
import { HazelRpc } from "../../../rpc"
import * as Interaction from "../../../ui/aria/interaction"
import * as Menu from "../../../ui/menu"
import * as Modal from "../../../ui/modal"
import { catchCommon, errorToastOf, reasonToast, successToast } from "../../../data/actions"
import type { PageReturn, PageSubscriptionInput, Shared } from "../../contract"
import { PageOutMessage, requestedOrgNavigation } from "../../out-message"
import * as ConfirmAction from "../../shared/confirm-action"
import { Connections, type DeleteTarget, Message, type Model, Submission } from "./model"
import { DiscordGuilds, fetchDiscordGuilds } from "./discord"
import { fetchConnections } from "./rpc"
import { ADD_CONNECTION_MODAL_ID, CreateConnection, FocusGuildSearch } from "./add-connection"

type Return = PageReturn<Model, Message>
type Step = Update.StepWithOutMessage<Model, Message, PageOutMessage>

export const interaction = Interaction.embed<Model, Message, PageSubscriptionInput<Model>>(
	(message) => Message.GotInteractionMessage({ message }),
	(input) => input.model,
)

/** Interaction targets in the add connection modal. */
export const GUILD_SEARCH_TARGET = "guild-search"
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

/** `AddConnectionModal`'s guild query; the modal mounts with the loaded list. */
export const ListDiscordGuilds = Command.define("ListDiscordGuilds", {
	args: { organizationId: OrganizationId, version: Schema.Number },
	messages: [Message.SucceededListDiscordGuilds, Message.FailedListDiscordGuilds],
	execute: ({ organizationId, version }) =>
		fetchDiscordGuilds(organizationId).pipe(
			Effect.map((guilds) => Message.SucceededListDiscordGuilds({ organizationId, version, guilds })),
			Effect.catchTags({
				IntegrationNotConnectedForPreviewError: () =>
					Effect.succeed(
						Message.FailedListDiscordGuilds({ organizationId, version, reason: "NotConnected" }),
					),
				IntegrationResourceError: () =>
					Effect.succeed(
						Message.FailedListDiscordGuilds({ organizationId, version, reason: "ProviderError" }),
					),
			}),
			catchCommon((reason) => Message.FailedListDiscordGuilds({ organizationId, version, reason })),
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

export const init = (_route: unknown, shared: Shared): Return =>
	requestList(
		{
			requestedOrganizationId: null,
			connections: Connections.Loading(),
			addMenu: Menu.init({ id: "chat-sync-add", placement: "bottom end" }),
			emptyAddMenu: Menu.init({ id: "chat-sync-add-empty", placement: "bottom end" }),
			addModal: Modal.init(ADD_CONNECTION_MODAL_ID),
			discordGuilds: DiscordGuilds.Loading(),
			guildsVersion: 0,
			selectedGuild: null,
			guildSearch: "",
			isGuildSearchFocused: false,
			submission: Submission.NotSubmitted(),
			deleteConfirm: ConfirmAction.init("chat-sync-delete"),
			interaction: Interaction.init(),
		},
		shared,
	)

export const sharedChanged = (model: Model, shared: Shared): Return => requestList(model, shared)

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

/** A new guild request; a reply for an older one is dropped. */
const requestGuilds = (model: Model, organizationId: OrganizationId): Return => {
	const version = model.guildsVersion + 1
	return {
		model: modifyFields(model, {
			discordGuilds: () => DiscordGuilds.Loading(),
			guildsVersion: () => version,
		}),
		commands: [ListDiscordGuilds({ organizationId, version })],
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
					selectedGuild: () => null,
					guildSearch: () => "",
					isGuildSearchFocused: () => false,
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
		result.model.addModal.isOpen && Modal.isReady(message) && hasGuildSearch(model)
			? [FocusGuildSearch()]
			: []
	return { model: result.model, commands: [...(result.commands ?? []), ...focus] }
}

/** The search Input is rendered while the guilds are listed and none is selected. */
const hasGuildSearch = (model: Model) =>
	AsyncData.isSuccess(model.discordGuilds) && model.selectedGuild === null

const submitConnection = (model: Model): Return => {
	const organizationId = model.requestedOrganizationId
	const guild = model.selectedGuild
	if (organizationId === null || guild === null || model.submission._tag === "Submitting") return { model }
	return {
		// The Connect button disables while it runs, which ends its hover (useHover).
		model: modifyFields(model, {
			submission: () => Submission.Submitting(),
			interaction: (state) => Interaction.disabledTargets(state, [CONNECT_TARGET]),
		}),
		commands: [
			CreateConnection({
				organizationId,
				externalWorkspaceId: guild.id,
				externalWorkspaceName: guild.name,
			}),
		],
	}
}

const foldAddMenuOutMessage = Menu.OutMessage.match<Step>({
	SelectedItem:
		({ key }) =>
		(model) =>
			key === "discord" ? openAddModal(model) : { model },
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

const isCurrentGuildList = (model: Model, organizationId: OrganizationId, version: number) =>
	organizationId === model.requestedOrganizationId && version === model.guildsVersion

export const update = (model: Model, message: Message, shared: Shared): Return =>
	Message.match<Return>(message, {
		SucceededListConnections: ({ organizationId, connections }) => {
			if (organizationId !== model.requestedOrganizationId) return { model }
			const next = modifyFields(model, {
				connections: () => Connections.Success({ data: connections }),
			})
			// The add modal mounts with the first list and queries the guilds then; a refresh keeps it mounted.
			return AsyncData.hasData(model.connections)
				? { model: next }
				: requestGuilds(next, organizationId)
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
		SucceededListDiscordGuilds: ({ organizationId, version, guilds }) => {
			if (!isCurrentGuildList(model, organizationId, version)) return { model }
			const next = modifyFields(model, { discordGuilds: () => DiscordGuilds.Success({ data: guilds }) })
			// The search mounts with `autoFocus` when the guilds arrive while the modal is open.
			return {
				model: next,
				commands: model.addModal.isOpen && hasGuildSearch(next) ? [FocusGuildSearch()] : [],
			}
		},
		FailedListDiscordGuilds: ({ organizationId, version, reason }) =>
			isCurrentGuildList(model, organizationId, version)
				? {
						model: modifyFields(model, {
							discordGuilds: () => DiscordGuilds.Failure({ error: reason }),
						}),
					}
				: { model },
		ClickedRetryListDiscordGuilds: () =>
			model.requestedOrganizationId === null
				? { model }
				: requestGuilds(model, model.requestedOrganizationId),
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
		ChangedGuildSearch: ({ value }) => ({ model: modifyFields(model, { guildSearch: () => value }) }),
		FocusedGuildSearch: () => ({ model: modifyFields(model, { isGuildSearchFocused: () => true }) }),
		BlurredGuildSearch: () => ({ model: modifyFields(model, { isGuildSearchFocused: () => false }) }),
		CompletedFocusGuildSearch: () => ({ model }),
		ClickedGuild: ({ guild }) => ({
			model: modifyFields(model, { selectedGuild: () => guild, isGuildSearchFocused: () => false }),
		}),
		ClickedChangeGuild: () => ({
			model: modifyFields(model, { selectedGuild: () => null }),
			commands: [FocusGuildSearch()],
		}),
		ClickedOpenDiscordIntegration: () => ({
			model,
			outMessage: requestedOrgNavigation(shared.orgSlug, (orgSlug) =>
				AppRoute.SettingsIntegration({
					orgSlug,
					integrationId: "discord",
					connectionStatus: Option.none(),
					errorCode: Option.none(),
				}),
			),
		}),
		ClickedConnect: () => submitConnection(model),
		GotInteractionMessage: ({ message }) => interaction.fold(model, message),
		// `onSuccess()` reloads the list (a new query key), then `handleClose()`.
		SucceededCreateConnection: () => ({
			...Update.combine(modifyFields(model, { submission: () => Submission.NotSubmitted() }), [
				closeAddModal,
				reloadConnections,
			]),
			outMessage: PageOutMessage.RequestedToast({ toast: successToast("Discord connection created") }),
		}),
		FailedCreateConnection: ({ reason }) => ({
			model: modifyFields(model, { submission: () => Submission.Failed({ reason }) }),
			outMessage: PageOutMessage.RequestedToast({
				toast: errorToastOf(
					failureMessage(reason, {
						AlreadyExists: {
							title: "Connection already exists",
							description:
								"A connection to this Discord server already exists in your workspace.",
						},
						DiscordNotConnected: {
							title: "Discord not connected",
							description: "Connect Discord first to load your guilds.",
						},
					}),
				),
			}),
		}),
	})
