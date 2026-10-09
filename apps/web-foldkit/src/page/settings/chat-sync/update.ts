import { OrganizationId, SyncConnectionId } from "@hazel/schema"
import { Effect, Exit, Option, Schema } from "effect"
import { Command, Update } from "foldkit"
import { modifyFields } from "foldkit/struct"
import { AppRoute } from "../../../route"
import { HazelRpc } from "../../../rpc"
import * as Interaction from "../../../ui/aria/interaction"
import * as Menu from "../../../ui/menu"
import * as Modal from "../../../ui/modal"
import { failureToast, successToast } from "../../../data/actions"
import type { PageReturn, Shared } from "../../contract"
import { PageOutMessage, requestedOrgNavigation } from "../../out-message"
import { addMenuEntries, Message, type Model } from "./model"
import { fetchDiscordGuilds } from "./discord"
import { fetchConnections } from "./rpc"
import { ADD_CONNECTION_MODAL_ID, CreateConnection, FocusGuildSearch } from "./add-connection"
import { embedInteraction } from "../integrations/shared/interaction"

type Return = PageReturn<Model, Message>
type Step = Update.StepWithOutMessage<Model, Message, PageOutMessage>

export const interaction = embedInteraction<Model, Message>((message) =>
	Message.GotInteractionMessage({ message }),
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
			Effect.catch(() => Effect.succeed(Message.FailedListConnections({ organizationId }))),
		),
})

export const DeleteConnection = Command.define("DeleteConnection", {
	args: { syncConnectionId: SyncConnectionId },
	messages: [Message.SucceededDeleteConnection, Message.FailedDeleteConnection],
	execute: ({ syncConnectionId }) =>
		Effect.gen(function* () {
			const client = yield* HazelRpc
			const exit = yield* Effect.exit(client("chatSync.connection.delete", { syncConnectionId }))
			return Exit.match(exit, {
				onSuccess: () => Message.SucceededDeleteConnection(),
				onFailure: (cause) => {
					const toast = failureToast(cause, "exitToast", {
						ChatSyncConnectionNotFoundError: {
							title: "Connection not found",
							description: "This connection may have already been deleted.",
							isRetryable: false,
						},
					})
					return Message.FailedDeleteConnection({ toast })
				},
			})
		}),
})

/** `AddConnectionModal`'s guild query; the modal mounts with the loaded list. */
export const ListDiscordGuilds = Command.define("ListDiscordGuilds", {
	args: { organizationId: OrganizationId, version: Schema.Number },
	messages: [Message.SucceededListDiscordGuilds, Message.FailedListDiscordGuilds],
	execute: ({ organizationId, version }) =>
		fetchDiscordGuilds(organizationId).pipe(
			Effect.map((guilds) => Message.SucceededListDiscordGuilds({ organizationId, version, guilds })),
			Effect.catch(() => Effect.succeed(Message.FailedListDiscordGuilds({ organizationId, version }))),
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
			connections: () => ({ _tag: "Loading" as const }),
		}),
		commands: [ListConnections({ organizationId })],
	}
}

export const init = (_route: unknown, shared: Shared): Return =>
	requestList(
		{
			requestedOrganizationId: null,
			connections: { _tag: "Loading" },
			addMenu: Menu.init({ id: "chat-sync-add", entries: addMenuEntries, placement: "bottom end" }),
			emptyAddMenu: Menu.init({
				id: "chat-sync-add-empty",
				entries: addMenuEntries,
				placement: "bottom end",
			}),
			addModal: Modal.init(ADD_CONNECTION_MODAL_ID),
			discordGuilds: { _tag: "Loading" },
			guildsVersion: 0,
			selectedGuild: null,
			guildSearch: "",
			isGuildSearchFocused: false,
			isCreating: false,
			deleteTarget: null,
			deleteModal: Modal.init("chat-sync-delete"),
			isDeleting: false,
			interaction: Interaction.init(),
		},
		shared,
	)

export const sharedChanged = (model: Model, shared: Shared): Return => requestList(model, shared)

// UPDATE

/** `handleClose`: a closed add modal has no selection and no search. */
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
				}),
	toParentMessage: (message: Modal.Message) => Message.GotAddModalMessage({ message }),
}
const foldAddModalChild = Update.foldChild({ update: Modal.update, ...addModal })
const openAddModal = Update.foldChildStep({ update: Modal.open, ...addModal })
const closeAddModal = Update.foldChildStep({ update: Modal.close, ...addModal })

/** `onOpenChange={(open) => !open && handleClose()}`; the search takes focus once the dialog has it. */
const foldAddModal = (model: Model, message: Modal.Message): Return => {
	const result = foldAddModalChild(model, message)
	const focus =
		result.model.addModal.isOpen && message._tag === "CompletedPortalModal" && hasGuildSearch(model)
			? [FocusGuildSearch()]
			: []
	return { model: result.model, commands: [...(result.commands ?? []), ...focus] }
}

/** The search Input is rendered while the guilds are listed and none is selected. */
const hasGuildSearch = (model: Model) => model.discordGuilds._tag === "Loaded" && model.selectedGuild === null

const submitConnection = (model: Model): Return => {
	const organizationId = model.requestedOrganizationId
	const guild = model.selectedGuild
	if (organizationId === null || guild === null || model.isCreating) return { model }
	return {
		// The Connect button disables while it runs, which ends its hover (useHover).
		model: modifyFields(model, {
			isCreating: () => true,
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

/** `onOpenChange={(open) => !open && setDeleteTarget(null)}` */
const deleteModal = {
	read: (model: Model) => Option.some(model.deleteModal),
	write: (model: Model, modal: Modal.Model): Model =>
		modifyFields(model, {
			deleteModal: () => modal,
			deleteTarget: (target) => (modal.isOpen ? target : null),
		}),
	toParentMessage: (message: Modal.Message) => Message.GotDeleteModalMessage({ message }),
}
const foldDeleteModal = Update.foldChild({ update: Modal.update, ...deleteModal })
const openDeleteModal = Update.foldChildStep({ update: Modal.open, ...deleteModal })
const closeDeleteModal = Update.foldChildStep({ update: Modal.close, ...deleteModal })

const withCommands = (result: Return, commands: Return["commands"]): Return => ({
	...result,
	commands: [...(result.commands ?? []), ...(commands ?? [])],
})

const isCurrentGuildList = (model: Model, organizationId: OrganizationId, version: number) =>
	organizationId === model.requestedOrganizationId && version === model.guildsVersion

export const update = (model: Model, message: Message, shared: Shared): Return =>
	Message.match<Return>(message, {
		SucceededListConnections: ({ organizationId, connections }) => {
			if (organizationId !== model.requestedOrganizationId) return { model }
			const next = modifyFields(model, {
				connections: () => ({ _tag: "Loaded" as const, connections }),
			})
			// The loading and error states return early, so a fresh list remounts the modal.
			if (model.connections._tag === "Loaded") return { model: next }
			const version = model.guildsVersion + 1
			return {
				model: modifyFields(next, {
					discordGuilds: () => ({ _tag: "Loading" as const }),
					guildsVersion: () => version,
				}),
				commands: [ListDiscordGuilds({ organizationId, version })],
			}
		},
		SucceededListDiscordGuilds: ({ organizationId, version, guilds }) => {
			if (!isCurrentGuildList(model, organizationId, version)) return { model }
			const next = modifyFields(model, {
				discordGuilds: () => ({ _tag: "Loaded" as const, items: guilds }),
			})
			// The search mounts with `autoFocus` when the guilds arrive while the modal is open.
			return {
				model: next,
				commands: model.addModal.isOpen && hasGuildSearch(next) ? [FocusGuildSearch()] : [],
			}
		},
		FailedListDiscordGuilds: ({ organizationId, version }) =>
			isCurrentGuildList(model, organizationId, version)
				? { model: modifyFields(model, { discordGuilds: () => ({ _tag: "Failed" as const }) }) }
				: { model },
		FailedListConnections: ({ organizationId }) =>
			organizationId === model.requestedOrganizationId
				? { model: modifyFields(model, { connections: () => ({ _tag: "Failed" as const }) }) }
				: { model },
		ClickedConnection: ({ connectionId }) => ({
			model,
			outMessage: requestedOrgNavigation(shared.orgSlug, (orgSlug) =>
				AppRoute.SettingsChatSyncConnection({ orgSlug, connectionId }),
			),
		}),
		ClickedDeleteConnection: ({ target }) =>
			openDeleteModal(modifyFields(model, { deleteTarget: () => target })),
		ClickedConfirmDelete: () =>
			model.deleteTarget === null || model.isDeleting
				? { model }
				: {
						model: modifyFields(model, { isDeleting: () => true }),
						commands: [DeleteConnection({ syncConnectionId: model.deleteTarget.id })],
					},
		// `setRefreshKey(k => k + 1)`: a new query key, so the list loads again.
		SucceededDeleteConnection: () => {
			const organizationId = model.requestedOrganizationId
			const closed = closeDeleteModal(
				modifyFields(model, {
					isDeleting: () => false,
					connections: (connections) =>
						organizationId === null ? connections : { _tag: "Loading" as const },
				}),
			)
			return {
				...withCommands(closed, organizationId === null ? [] : [ListConnections({ organizationId })]),
				outMessage: PageOutMessage.RequestedToast({ toast: successToast("Connection deleted") }),
			}
		},
		FailedDeleteConnection: ({ toast }) => ({
			model: modifyFields(model, { isDeleting: () => false }),
			outMessage: PageOutMessage.RequestedToast({ toast }),
		}),
		GotAddMenuMessage: ({ message: menuMessage }) => foldAddMenu(model, menuMessage),
		GotEmptyAddMenuMessage: ({ message: menuMessage }) => foldEmptyAddMenu(model, menuMessage),
		GotDeleteModalMessage: ({ message: modalMessage }) => foldDeleteModal(model, modalMessage),
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
		SucceededCreateConnection: () => {
			const organizationId = model.requestedOrganizationId
			const closed = closeAddModal(
				modifyFields(model, {
					isCreating: () => false,
					connections: (connections) =>
						organizationId === null ? connections : { _tag: "Loading" as const },
				}),
			)
			return {
				...withCommands(closed, organizationId === null ? [] : [ListConnections({ organizationId })]),
				outMessage: PageOutMessage.RequestedToast({
					toast: successToast("Discord connection created"),
				}),
			}
		},
		FailedCreateConnection: ({ toast }) => ({
			model: modifyFields(model, { isCreating: () => false }),
			outMessage: PageOutMessage.RequestedToast({ toast }),
		}),
	})
