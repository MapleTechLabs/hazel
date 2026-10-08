import { OrganizationId, SyncConnectionId } from "@hazel/schema"
import { Effect, Exit, Option } from "effect"
import { Command, Update } from "foldkit"
import { modifyFields } from "foldkit/struct"
import { HazelRpc } from "../../../rpc"
import * as Interaction from "../../../ui/aria/interaction"
import * as Menu from "../../../ui/menu"
import * as Modal from "../../../ui/modal"
import { failureToast, successToast } from "../../../ui/toast-exit"
import type { PageReturn, Shared } from "../../contract"
import { PageOutMessage } from "../../out-message"
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
					const toast = failureToast(cause, {
						ChatSyncConnectionNotFoundError: {
							title: "Connection not found",
							description: "This connection may have already been deleted.",
							isRetryable: false,
						},
					})
					return Message.FailedDeleteConnection({
						title: toast.title,
						description: toast.description,
					})
				},
			})
		}),
})

/** `AddConnectionModal`'s guild query; the modal mounts with the loaded list. */
export const ListDiscordGuilds = Command.define("ListDiscordGuilds", {
	args: { organizationId: OrganizationId },
	messages: [Message.SucceededListDiscordGuilds, Message.FailedListDiscordGuilds],
	execute: ({ organizationId }) =>
		fetchDiscordGuilds(organizationId).pipe(
			Effect.map((guilds) => Message.SucceededListDiscordGuilds({ guilds })),
			Effect.catch(() => Effect.succeed(Message.FailedListDiscordGuilds())),
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

/** `handleClose`: clears the selection and the search, then closes. */
const closedAddModal = (model: Model): Model =>
	modifyFields(model, {
		addModal: (modal) => Modal.close(modal).model,
		selectedGuild: () => null,
		guildSearch: () => "",
		isGuildSearchFocused: () => false,
	})

/** `onOpenChange={(open) => !open && handleClose()}`; the search takes focus once the dialog has it. */
const foldAddModal = (model: Model, message: Modal.Message): Return => {
	const next = Modal.update(model.addModal, message)
	const commands = Command.mapMessages(next.commands ?? [], (child) =>
		Message.GotAddModalMessage({ message: child }),
	)
	if (!next.model.isOpen) return { model: closedAddModal(model), commands }
	const focus = message._tag === "CompletedPortalModal" && hasGuildSearch(model) ? [FocusGuildSearch()] : []
	return { model: modifyFields(model, { addModal: () => next.model }), commands: [...commands, ...focus] }
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
		(model) => ({
			model:
				key === "discord"
					? modifyFields(model, { addModal: (modal) => Modal.open(modal).model })
					: model,
		}),
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
const foldDeleteModal = (model: Model, message: Modal.Message): Return => {
	const next = Modal.update(model.deleteModal, message)
	return {
		model: modifyFields(model, {
			deleteModal: () => next.model,
			deleteTarget: (target) => (next.model.isOpen ? target : null),
		}),
		commands: Command.mapMessages(next.commands ?? [], (child) =>
			Message.GotDeleteModalMessage({ message: child }),
		),
	}
}

export const update = (model: Model, message: Message, shared: Shared): Return =>
	Message.match<Return>(message, {
		SucceededListConnections: ({ organizationId, connections }) => {
			if (organizationId !== model.requestedOrganizationId) return { model }
			const next = modifyFields(model, {
				connections: () => ({ _tag: "Loaded" as const, connections }),
			})
			// The loading and error states return early, so a fresh list remounts the modal.
			if (model.connections._tag === "Loaded") return { model: next }
			return {
				model: modifyFields(next, { discordGuilds: () => ({ _tag: "Loading" as const }) }),
				commands: [ListDiscordGuilds({ organizationId })],
			}
		},
		SucceededListDiscordGuilds: ({ guilds }) => {
			const next = modifyFields(model, {
				discordGuilds: () => ({ _tag: "Loaded" as const, items: guilds }),
			})
			// The search mounts with `autoFocus` when the guilds arrive while the modal is open.
			return {
				model: next,
				commands: model.addModal.isOpen && hasGuildSearch(next) ? [FocusGuildSearch()] : [],
			}
		},
		FailedListDiscordGuilds: () => ({
			model: modifyFields(model, { discordGuilds: () => ({ _tag: "Failed" as const }) }),
		}),
		FailedListConnections: ({ organizationId }) =>
			organizationId === model.requestedOrganizationId
				? { model: modifyFields(model, { connections: () => ({ _tag: "Failed" as const }) }) }
				: { model },
		ClickedConnection: ({ connectionId }) => ({
			model,
			outMessage: PageOutMessage.RequestedNavigation({
				href: `/${shared.orgSlug ?? ""}/settings/chat-sync/${connectionId}`,
				replace: false,
			}),
		}),
		ClickedDeleteConnection: ({ target }) => ({
			model: modifyFields(model, {
				deleteTarget: () => target,
				deleteModal: (modal) => Modal.open(modal).model,
			}),
		}),
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
			return {
				model: modifyFields(model, {
					isDeleting: () => false,
					deleteTarget: () => null,
					deleteModal: (modal) => Modal.close(modal).model,
					connections: (connections) =>
						organizationId === null ? connections : { _tag: "Loading" as const },
				}),
				commands: organizationId === null ? [] : [ListConnections({ organizationId })],
				outMessage: PageOutMessage.RequestedToast({ toast: successToast("Connection deleted") }),
			}
		},
		FailedDeleteConnection: ({ title, description }) => ({
			model: modifyFields(model, { isDeleting: () => false }),
			outMessage: PageOutMessage.RequestedToast({ toast: { intent: "error", title, description } }),
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
			outMessage: PageOutMessage.RequestedNavigation({
				href: `/${shared.orgSlug ?? ""}/settings/integrations/discord`,
				replace: false,
			}),
		}),
		ClickedConnect: () => submitConnection(model),
		GotInteractionMessage: ({ message }) => interaction.fold(model, message),
		// `onSuccess()` reloads the list (a new query key), then `handleClose()`.
		SucceededCreateConnection: () => {
			const organizationId = model.requestedOrganizationId
			return {
				model: modifyFields(closedAddModal(model), {
					isCreating: () => false,
					connections: (connections) =>
						organizationId === null ? connections : { _tag: "Loading" as const },
				}),
				commands: organizationId === null ? [] : [ListConnections({ organizationId })],
				outMessage: PageOutMessage.RequestedToast({
					toast: successToast("Discord connection created"),
				}),
			}
		},
		FailedCreateConnection: ({ title, description }) => ({
			model: modifyFields(model, { isCreating: () => false }),
			outMessage: PageOutMessage.RequestedToast({ toast: { intent: "error", title, description } }),
		}),
	})
