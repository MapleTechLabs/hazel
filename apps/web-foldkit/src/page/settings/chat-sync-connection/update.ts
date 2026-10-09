import { Array, Option } from "effect"
import { Command, Update } from "foldkit"
import { modifyFields } from "foldkit/struct"
import type { ToastRequest } from "../../../overlay/toasts"
import type { RouteOf } from "../../../route"
import * as Interaction from "../../../ui/aria/interaction"
import * as Menu from "../../../ui/menu"
import * as Modal from "../../../ui/modal"
import { successToast } from "../../../data/actions"
import type { PageReturn, Shared } from "../../contract"
import { PageOutMessage } from "../../out-message"
import { embedInteraction } from "../integrations/shared/interaction"
import {
	CreateChannelLink,
	DisconnectConnection,
	FocusChannelSearch,
	ListChannelLinks,
	ListConnections,
	ListDiscordChannels,
	RemoveChannelLink,
	UpdateChannelLink,
} from "./command"
import {
	ADD_LINK_MODAL_ID,
	type ChannelLink,
	linkMenuEntries,
	linkMenuId,
	Message,
	type Model,
	SyncDirection,
} from "./model"

type Return = PageReturn<Model, Message>

export const interaction = embedInteraction<Model, Message>((message) =>
	Message.GotInteractionMessage({ message }),
)

/** The link modal's Link Channel button. */
export const CREATE_LINK_TARGET = "create-link"

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
			linksVersion: 1,
			updatingLinkIds: [],
			channelNames: {},
			linkMenus: [],
			addLinkModal: Modal.init(ADD_LINK_MODAL_ID),
			discordChannels: { _tag: "Loading" },
			hazelChannels: [],
			selectedChannel: null,
			selectedDiscordChannel: null,
			direction: "both",
			channelSearch: "",
			discordChannelSearch: "",
			focusedSearch: null,
			isCreatingLink: false,
			deleteTarget: null,
			deleteLinkModal: Modal.init("chat-sync-remove-link"),
			isDeletingLink: false,
			disconnectModal: Modal.init("chat-sync-disconnect"),
			isDisconnecting: false,
			interaction: Interaction.init(),
		},
		shared,
	)
	return {
		...started,
		commands: [
			...(started.commands ?? []),
			ListChannelLinks({ syncConnectionId: route.connectionId, version: 1 }),
		],
	}
}

export const sharedChanged = (model: Model, shared: Shared): Return => requestConnections(model, shared)

/** `setRefreshKey(k => k + 1)`: a new query key, so the links load again. */
const reloadLinks = (model: Model): Pick<Return, "model" | "commands"> => {
	const version = model.linksVersion + 1
	return {
		model: modifyFields(model, {
			links: () => ({ _tag: "Loading" as const }),
			linksVersion: () => version,
		}),
		commands: [ListChannelLinks({ syncConnectionId: model.connectionId, version })],
	}
}

const withCommands = (
	result: Pick<Return, "model" | "commands">,
	commands: Return["commands"],
): Pick<Return, "model" | "commands"> => ({
	model: result.model,
	commands: [...(result.commands ?? []), ...(commands ?? [])],
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

const deleteLinkModal = {
	read: (model: Model) => Option.some(model.deleteLinkModal),
	// A closed dialog forgets its target (`onOpenChange(false)`).
	write: (model: Model, modal: Modal.Model): Model =>
		modifyFields(model, {
			deleteLinkModal: () => modal,
			deleteTarget: (target) => (modal.isOpen ? target : null),
		}),
	toParentMessage: (message: Modal.Message) => Message.GotDeleteLinkModalMessage({ message }),
}
const foldDeleteLinkModal = Update.foldChild({ update: Modal.update, ...deleteLinkModal })
const openDeleteLinkModal = Update.foldChildStep({ update: Modal.open, ...deleteLinkModal })
const closeDeleteLinkModal = Update.foldChildStep({ update: Modal.close, ...deleteLinkModal })

const disconnectModal = {
	read: (model: Model) => Option.some(model.disconnectModal),
	write: (model: Model, modal: Modal.Model): Model => modifyFields(model, { disconnectModal: () => modal }),
	toParentMessage: (message: Modal.Message) => Message.GotDisconnectModalMessage({ message }),
}
const foldDisconnectModal = Update.foldChild({ update: Modal.update, ...disconnectModal })
const openDisconnectModal = Update.foldChildStep({ update: Modal.open, ...disconnectModal })
const closeDisconnectModal = Update.foldChildStep({ update: Modal.close, ...disconnectModal })

const isDirection = (key: string): key is SyncDirection =>
	SyncDirection.literals.some((literal) => literal === key)

/** A link menu's `onAction`s. */
const selectedLinkAction = (model: Model, link: ChannelLink, key: string): Return => {
	if (key === "remove")
		return openDeleteLinkModal(
			modifyFields(model, { deleteTarget: () => ({ id: link.id, name: link.externalName }) }),
		)
	if (key !== "toggle" && !isDirection(key)) return { model }
	// One update per link at a time; the menu stays enabled as in legacy.
	if (model.updatingLinkIds.includes(link.id)) return { model }
	return {
		model: modifyFields(model, { updatingLinkIds: (ids) => [...ids, link.id] }),
		commands: [
			key === "toggle"
				? UpdateChannelLink({ syncChannelLinkId: link.id, isActive: !link.isActive })
				: UpdateChannelLink({ syncChannelLinkId: link.id, direction: key }),
		],
	}
}

const settledLink = (model: Model, linkId: ChannelLink["id"]): Model =>
	modifyFields(model, { updatingLinkIds: (ids) => ids.filter((id) => id !== linkId) })

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

/** `handleClose`: a closed link modal has an empty form. */
const addLinkModal = {
	read: (model: Model) => Option.some(model.addLinkModal),
	write: (model: Model, modal: Modal.Model): Model =>
		modal.isOpen
			? modifyFields(model, { addLinkModal: () => modal })
			: modifyFields(model, {
					addLinkModal: () => modal,
					selectedChannel: () => null,
					selectedDiscordChannel: () => null,
					direction: () => "both" as const,
					channelSearch: () => "",
					discordChannelSearch: () => "",
					focusedSearch: () => null,
				}),
	toParentMessage: (message: Modal.Message) => Message.GotAddLinkModalMessage({ message }),
}
/** `onOpenChange={(open) => !open && handleClose()}`; the portal Mount focuses the channel search (`autoFocus`). */
const foldAddLinkModal = Update.foldChild({ update: Modal.update, ...addLinkModal })
const openAddLinkModal = Update.foldChildStep({ update: Modal.open, ...addLinkModal })
const closeAddLinkModal = Update.foldChildStep({ update: Modal.close, ...addLinkModal })

const submitLink = (model: Model): Return => {
	const channel = model.selectedChannel
	const discordChannel = model.selectedDiscordChannel
	if (channel === null || discordChannel === null || model.isCreatingLink) return { model }
	return {
		// Link Channel disables while it runs, which ends its hover (useHover).
		model: modifyFields(model, {
			isCreatingLink: () => true,
			interaction: (state) => Interaction.disabledTargets(state, [CREATE_LINK_TARGET]),
		}),
		commands: [
			CreateChannelLink({
				syncConnectionId: model.connectionId,
				hazelChannelId: channel.id,
				hazelChannelName: channel.name,
				externalChannelId: discordChannel.id,
				externalChannelName: discordChannel.name,
				direction: model.direction,
			}),
		],
	}
}

/** The Discord channel list belongs to the guild of the connection currently shown. */
const isCurrentGuild = (model: Model, guildId: string) =>
	model.connection._tag === "Loaded" && model.connection.connection?.externalWorkspaceId === guildId

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
		SucceededListDiscordChannels: ({ guildId, channels }) =>
			isCurrentGuild(model, guildId)
				? {
						model: modifyFields(model, {
							discordChannels: () => ({ _tag: "Loaded" as const, items: channels }),
						}),
					}
				: { model },
		FailedListDiscordChannels: ({ guildId }) =>
			isCurrentGuild(model, guildId)
				? { model: modifyFields(model, { discordChannels: () => ({ _tag: "Failed" as const }) }) }
				: { model },
		// A failed query is not "initial", and no connection is found in it.
		FailedListConnections: ({ organizationId }) =>
			organizationId === model.requestedOrganizationId
				? {
						model: modifyFields(model, {
							connection: () => ({ _tag: "Loaded" as const, connection: null }),
						}),
					}
				: { model },
		SucceededListChannelLinks: ({ version, links }) =>
			version !== model.linksVersion
				? { model }
				: {
						model: reflectLinkMenus(
							modifyFields(model, { links: () => ({ _tag: "Loaded" as const, links }) }),
							links,
						),
					},
		FailedListChannelLinks: ({ version }) =>
			version !== model.linksVersion
				? { model }
				: {
						model: reflectLinkMenus(
							modifyFields(model, { links: () => ({ _tag: "Loaded" as const, links: [] }) }),
							[],
						),
					},
		UpdatedChannelNames: ({ names }) => ({ model: modifyFields(model, { channelNames: () => names }) }),
		ClickedBack: () => ({
			model,
			outMessage: PageOutMessage.RequestedNavigation({ href: listHref(shared), replace: false }),
		}),
		ClickedDisconnect: () => openDisconnectModal(model),
		ClickedConfirmDisconnect: () =>
			model.isDisconnecting
				? { model }
				: {
						model: modifyFields(model, { isDisconnecting: () => true }),
						commands: [DisconnectConnection({ syncConnectionId: model.connectionId })],
					},
		SucceededDisconnect: () => ({
			...closeDisconnectModal(modifyFields(model, { isDisconnecting: () => false })),
			outMessage: PageOutMessage.RequestedNavigation({
				href: listHref(shared),
				replace: false,
				toast: successToast("Connection deleted"),
			}),
		}),
		FailedDisconnect: ({ toast: request }) => ({
			...closeDisconnectModal(modifyFields(model, { isDisconnecting: () => false })),
			outMessage: toast(request),
		}),
		ClickedLinkChannel: () => openAddLinkModal(model),
		GotAddLinkModalMessage: ({ message: modalMessage }) => foldAddLinkModal(model, modalMessage),
		UpdatedHazelChannels: ({ channels }) => ({
			model: modifyFields(model, { hazelChannels: () => channels }),
		}),
		ChangedChannelSearch: ({ value }) => ({ model: modifyFields(model, { channelSearch: () => value }) }),
		ChangedDiscordChannelSearch: ({ value }) => ({
			model: modifyFields(model, { discordChannelSearch: () => value }),
		}),
		FocusedSearch: ({ search }) => ({ model: modifyFields(model, { focusedSearch: () => search }) }),
		BlurredSearch: () => ({ model: modifyFields(model, { focusedSearch: () => null }) }),
		CompletedFocusChannelSearch: () => ({ model }),
		ClickedHazelChannel: ({ channel }) => ({
			model: modifyFields(model, {
				selectedChannel: () => channel,
				channelSearch: () => "",
				focusedSearch: () => null,
			}),
		}),
		ClickedChangeHazelChannel: () => ({
			model: modifyFields(model, { selectedChannel: () => null }),
			commands: [FocusChannelSearch()],
		}),
		ClickedDiscordChannel: ({ channel }) => ({
			model: modifyFields(model, {
				selectedDiscordChannel: () => channel,
				discordChannelSearch: () => "",
				focusedSearch: () => null,
			}),
		}),
		GotInteractionMessage: ({ message }) => interaction.fold(model, message),
		ClickedChangeDiscordChannel: () => ({
			model: modifyFields(model, { selectedDiscordChannel: () => null }),
		}),
		ClickedDirection: ({ direction }) => ({ model: modifyFields(model, { direction: () => direction }) }),
		ClickedCreateLink: () => submitLink(model),
		// `onSuccess()` reloads the links (a new query key), then `handleClose()`.
		SucceededCreateLink: ({ successMessage }) => {
			const closed = closeAddLinkModal(modifyFields(model, { isCreatingLink: () => false }))
			return {
				...withCommands(reloadLinks(closed.model), closed.commands),
				outMessage: toast(successToast(successMessage)),
			}
		},
		FailedCreateLink: ({ toast: request }) => ({
			model: modifyFields(model, { isCreatingLink: () => false }),
			outMessage: toast(request),
		}),
		ClickedConfirmRemoveLink: () =>
			model.deleteTarget === null || model.isDeletingLink
				? { model }
				: {
						model: modifyFields(model, { isDeletingLink: () => true }),
						commands: [RemoveChannelLink({ syncChannelLinkId: model.deleteTarget.id })],
					},
		SucceededRemoveLink: () => {
			const closed = closeDeleteLinkModal(modifyFields(model, { isDeletingLink: () => false }))
			return {
				...withCommands(reloadLinks(closed.model), closed.commands),
				outMessage: toast(successToast("Channel link removed")),
			}
		},
		FailedRemoveLink: ({ toast: request }) => ({
			model: modifyFields(model, { isDeletingLink: () => false }),
			outMessage: toast(request),
		}),
		SucceededUpdateLink: ({ linkId, successMessage }) => ({
			...reloadLinks(settledLink(model, linkId)),
			outMessage: toast(successToast(successMessage)),
		}),
		FailedUpdateLink: ({ linkId, toast: request }) => ({
			model: settledLink(model, linkId),
			outMessage: toast(request),
		}),
		GotLinkMenuMessage: ({ linkId, message: menuMessage }) => foldLinkMenu(model, linkId, menuMessage),
		GotDeleteLinkModalMessage: ({ message: modalMessage }) => foldDeleteLinkModal(model, modalMessage),
		GotDisconnectModalMessage: ({ message: modalMessage }) => foldDisconnectModal(model, modalMessage),
	})
