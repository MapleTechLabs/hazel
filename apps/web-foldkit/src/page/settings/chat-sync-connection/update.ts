import { Array, Option } from "effect"
import { Command } from "foldkit"
import { modifyFields } from "foldkit/struct"
import type { ToastRequest } from "../../../overlay/toasts"
import type { RouteOf } from "../../../route"
import * as Menu from "../../../ui/menu"
import * as Modal from "../../../ui/modal"
import { successToast } from "../../../ui/toast-exit"
import type { PageReturn, Shared } from "../../contract"
import { PageOutMessage } from "../../out-message"
import {
	DisconnectConnection,
	ListChannelLinks,
	ListConnections,
	ListDiscordChannels,
	RemoveChannelLink,
	ScheduleReturnToList,
	UpdateChannelLink,
} from "./command"
import { type ChannelLink, linkMenuEntries, linkMenuId, Message, type Model, SyncDirection } from "./model"

type Return = PageReturn<Model, Message>

const requestConnections = (model: Model, shared: Shared): Return => {
	const organizationId = shared.organization?.id ?? null
	if (organizationId === null || organizationId === model.requestedOrganizationId) return { model }
	return {
		model: modifyFields(model, { requestedOrganizationId: () => organizationId }),
		commands: [ListConnections({ organizationId })],
	}
}

export const init = (route: RouteOf<"SettingsChatSyncConnection">, shared: Shared): Return => {
	const started = requestConnections(
		{
			connectionId: route.connectionId,
			requestedOrganizationId: null,
			connection: { _tag: "Loading" },
			links: { _tag: "Loading" },
			channelNames: {},
			linkMenus: [],
			isAddLinkModalOpen: false,
			discordChannels: { _tag: "Loading" },
			deleteTarget: null,
			deleteLinkModal: Modal.init("chat-sync-remove-link"),
			isDeletingLink: false,
			disconnectModal: Modal.init("chat-sync-disconnect"),
			isDisconnecting: false,
		},
		shared,
	)
	return {
		...started,
		commands: [...(started.commands ?? []), ListChannelLinks({ syncConnectionId: route.connectionId })],
	}
}

export const sharedChanged = (model: Model, shared: Shared): Return => requestConnections(model, shared)

/** `setRefreshKey(k => k + 1)`: a new query key, so the links load again. */
const reloadLinks = (model: Model): Pick<Return, "model" | "commands"> => ({
	model: modifyFields(model, { links: () => ({ _tag: "Loading" as const }) }),
	commands: [ListChannelLinks({ syncConnectionId: model.connectionId })],
})

const toast = (request: ToastRequest) => PageOutMessage.RequestedToast({ toast: request })

/** Keeps one menu per link, preserving the state of menus whose link is still listed. */
const reflectLinkMenus = (model: Model, links: ReadonlyArray<ChannelLink>): Model =>
	modifyFields(model, {
		linkMenus: (menus) =>
			links.map((link) =>
				Option.getOrElse(
					Array.findFirst(menus, (menu) => menu.id === linkMenuId(link.id)),
					() =>
						Menu.init({
							id: linkMenuId(link.id),
							entries: linkMenuEntries,
							placement: "bottom end",
						}),
				),
			),
	})

const foldModal =
	(key: "deleteLinkModal" | "disconnectModal", wrap: (message: Modal.Message) => Message) =>
	(model: Model, message: Modal.Message): Return => {
		const next = Modal.update(model[key], message)
		const closed = !next.model.isOpen
		return {
			model: {
				...model,
				[key]: next.model,
				...(key === "deleteLinkModal" && closed ? { deleteTarget: null } : {}),
			},
			commands: Command.mapMessages(next.commands ?? [], wrap),
		}
	}

const foldDeleteLinkModal = foldModal("deleteLinkModal", (message) =>
	Message.GotDeleteLinkModalMessage({ message }),
)
const foldDisconnectModal = foldModal("disconnectModal", (message) =>
	Message.GotDisconnectModalMessage({ message }),
)

const isDirection = (key: string): key is SyncDirection =>
	SyncDirection.literals.some((literal) => literal === key)

/** A link menu's `onAction`s. */
const selectedLinkAction = (model: Model, link: ChannelLink, key: string): Return => {
	if (key === "toggle")
		return {
			model,
			commands: [UpdateChannelLink({ syncChannelLinkId: link.id, isActive: !link.isActive })],
		}
	if (key === "remove")
		return {
			model: modifyFields(model, {
				deleteTarget: () => ({ id: link.id, name: link.externalName }),
				deleteLinkModal: (modal) => Modal.open(modal).model,
			}),
		}
	if (isDirection(key))
		return { model, commands: [UpdateChannelLink({ syncChannelLinkId: link.id, direction: key })] }
	return { model }
}

const foldLinkMenu = (model: Model, linkId: ChannelLink["id"], message: Menu.Message): Return => {
	const menu = Array.findFirst(model.linkMenus, (candidate) => candidate.id === linkMenuId(linkId))
	if (Option.isNone(menu)) return { model }
	const next = Menu.update(menu.value, message)
	const withMenu = modifyFields(model, {
		linkMenus: Array.map((candidate) => (candidate.id === menu.value.id ? next.model : candidate)),
	})
	const commands = Command.mapMessages(next.commands ?? [], (child) =>
		Message.GotLinkMenuMessage({ linkId, message: child }),
	)
	const links = model.links._tag === "Loaded" ? model.links.links : []
	const link = Array.findFirst(links, (candidate) => candidate.id === linkId)
	const selected = Option.flatMap(Option.fromNullishOr(next.outMessage), (out) =>
		out._tag === "SelectedItem" ? Option.some(out.key) : Option.none(),
	)
	if (Option.isNone(link) || Option.isNone(selected)) return { model: withMenu, commands }
	const action = selectedLinkAction(withMenu, link.value, selected.value)
	return { ...action, commands: [...commands, ...(action.commands ?? [])] }
}

const listHref = (shared: Shared) => `/${shared.orgSlug ?? ""}/settings/chat-sync`

export const update = (model: Model, message: Message, shared: Shared): Return =>
	Message.match<Return>(message, {
		SucceededListConnections: ({ organizationId, connections }) => {
			if (organizationId !== model.requestedOrganizationId) return { model }
			const connection = connections.find((found) => found.id === model.connectionId) ?? null
			const next = modifyFields(model, {
				connection: () => ({ _tag: "Loaded" as const, connection }),
			})
			// `AddChannelLinkModal` mounts once the connection is found, and queries its guild.
			const previous = model.connection._tag === "Loaded" ? model.connection.connection : null
			if (connection === null || previous?.externalWorkspaceId === connection.externalWorkspaceId)
				return { model: next }
			return {
				model: modifyFields(next, { discordChannels: () => ({ _tag: "Loading" as const }) }),
				commands: [ListDiscordChannels({ organizationId, guildId: connection.externalWorkspaceId })],
			}
		},
		SucceededListDiscordChannels: ({ channels }) => ({
			model: modifyFields(model, {
				discordChannels: () => ({ _tag: "Loaded" as const, items: channels }),
			}),
		}),
		FailedListDiscordChannels: () => ({
			model: modifyFields(model, { discordChannels: () => ({ _tag: "Failed" as const }) }),
		}),
		// A failed query is not "initial", and no connection is found in it.
		FailedListConnections: ({ organizationId }) =>
			organizationId === model.requestedOrganizationId
				? {
						model: modifyFields(model, {
							connection: () => ({ _tag: "Loaded" as const, connection: null }),
						}),
					}
				: { model },
		SucceededListChannelLinks: ({ links }) => ({
			model: reflectLinkMenus(
				modifyFields(model, { links: () => ({ _tag: "Loaded" as const, links }) }),
				links,
			),
		}),
		FailedListChannelLinks: () => ({
			model: reflectLinkMenus(
				modifyFields(model, { links: () => ({ _tag: "Loaded" as const, links: [] }) }),
				[],
			),
		}),
		UpdatedChannelNames: ({ names }) => ({ model: modifyFields(model, { channelNames: () => names }) }),
		ClickedBack: () => ({
			model,
			outMessage: PageOutMessage.RequestedNavigation({ href: listHref(shared), replace: false }),
		}),
		ClickedDisconnect: () => ({
			model: modifyFields(model, { disconnectModal: (modal) => Modal.open(modal).model }),
		}),
		ClickedConfirmDisconnect: () =>
			model.isDisconnecting
				? { model }
				: {
						model: modifyFields(model, { isDisconnecting: () => true }),
						commands: [DisconnectConnection({ syncConnectionId: model.connectionId })],
					},
		// One OutMessage per update: the toast now, the navigation on the next Message.
		SucceededDisconnect: () => ({
			model: modifyFields(model, {
				isDisconnecting: () => false,
				disconnectModal: (modal) => Modal.close(modal).model,
			}),
			commands: [ScheduleReturnToList()],
			outMessage: toast(successToast("Connection deleted")),
		}),
		ReachedReturnToList: () => ({
			model,
			outMessage: PageOutMessage.RequestedNavigation({ href: listHref(shared), replace: false }),
		}),
		FailedDisconnect: ({ title, description }) => ({
			model: modifyFields(model, {
				isDisconnecting: () => false,
				disconnectModal: (modal) => Modal.close(modal).model,
			}),
			outMessage: toast({ intent: "error", title, description }),
		}),
		ClickedLinkChannel: () => ({ model: modifyFields(model, { isAddLinkModalOpen: () => true }) }),
		ClickedConfirmRemoveLink: () =>
			model.deleteTarget === null || model.isDeletingLink
				? { model }
				: {
						model: modifyFields(model, { isDeletingLink: () => true }),
						commands: [RemoveChannelLink({ syncChannelLinkId: model.deleteTarget.id })],
					},
		SucceededRemoveLink: () => ({
			...reloadLinks(
				modifyFields(model, {
					isDeletingLink: () => false,
					deleteTarget: () => null,
					deleteLinkModal: (modal) => Modal.close(modal).model,
				}),
			),
			outMessage: toast(successToast("Channel link removed")),
		}),
		FailedRemoveLink: ({ title, description }) => ({
			model: modifyFields(model, { isDeletingLink: () => false }),
			outMessage: toast({ intent: "error", title, description }),
		}),
		SucceededUpdateLink: ({ successMessage }) => ({
			...reloadLinks(model),
			outMessage: toast(successToast(successMessage)),
		}),
		FailedLinkAction: ({ title, description }) => ({
			model,
			outMessage: toast({ intent: "error", title, description }),
		}),
		GotLinkMenuMessage: ({ linkId, message: menuMessage }) => foldLinkMenu(model, linkId, menuMessage),
		GotDeleteLinkModalMessage: ({ message: modalMessage }) => foldDeleteLinkModal(model, modalMessage),
		GotDisconnectModalMessage: ({ message: modalMessage }) => foldDisconnectModal(model, modalMessage),
	})
