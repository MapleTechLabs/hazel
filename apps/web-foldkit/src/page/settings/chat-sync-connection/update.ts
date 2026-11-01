import type { OrganizationId, SyncConnectionId } from "@hazel/schema"
import { Array, Option } from "effect"
import { Command, Update } from "foldkit"
import * as AsyncData from "foldkit/asyncData"
import { modifyFields } from "foldkit/struct"
import { failureMessage } from "~/lib/error-messages"
import type { ToastRequest } from "../../../overlay/toasts"
import { AppRoute, type RouteOf } from "../../../route"
import * as Interaction from "../../../ui/aria/interaction"
import * as Menu from "../../../ui/menu"
import * as Modal from "../../../ui/modal"
import { errorToastOf, reasonToast, successToast } from "../../../data/actions"
import type { PageReturn, PageSubscriptionInput, Shared } from "../../contract"
import { PageOutMessage, requestedOrgNavigation } from "../../out-message"
import * as ConfirmAction from "../../shared/confirm-action"
import { ExternalChannels } from "../chat-sync/providers"
import {
	CreateChannelLink,
	DisconnectConnection,
	FocusChannelSearch,
	ListChannelLinks,
	ListChatSyncConnectionsForConnection,
	ListExternalChannels,
	RemoveChannelLink,
	UpdateChannelLink,
} from "./command"
import {
	ADD_LINK_MODAL_ID,
	CHANNEL_SEARCH_ID,
	type ChannelLink,
	ChannelLinks,
	ConnectionLookup,
	foundConnection,
	type LinkFailure,
	type LinkTarget,
	linkMenuId,
	listedLinks,
	listLinksFailureMessage,
	Message,
	type Model,
	Submission,
	SyncDirection,
} from "./model"

type Return = PageReturn<Model, Message>

export const interaction = Interaction.embed<Model, Message, PageSubscriptionInput<Model>>(
	(message) => Message.GotInteractionMessage({ message }),
	(input) => input.model,
)

/** The link modal's Link Channel button. */
export const CREATE_LINK_TARGET = "create-link"

/** Lists the organization's connections to find this one; a shown connection stays while it reloads. */
const loadConnection = (model: Model, organizationId: OrganizationId): Return => ({
	model: modifyFields(model, {
		requestedOrganizationId: () => organizationId,
		connection: (connection) =>
			Option.getOrElse(AsyncData.revalidateOrLoad(connection), () => connection),
	}),
	commands: [ListChatSyncConnectionsForConnection({ organizationId })],
})

const requestConnections = (model: Model, shared: Shared): Return => {
	const organizationId = shared.organization?.id ?? null
	if (organizationId === null || organizationId === model.requestedOrganizationId) return { model }
	return loadConnection(model, organizationId)
}

export const init = (route: RouteOf<"SettingsChatSyncConnection">, shared: Shared): Return => {
	const started = requestConnections(
		{
			connectionId: route.connectionId,
			requestedOrganizationId: null,
			connection: ConnectionLookup.Loading(),
			links: ChannelLinks.Loading(),
			linksVersion: 1,
			updatingLinkIds: [],
			channelNames: {},
			linkMenus: [],
			addLinkModal: Modal.init(ADD_LINK_MODAL_ID, { focusSelector: `#${CHANNEL_SEARCH_ID}` }),
			externalChannels: ExternalChannels.Loading(),
			hazelChannels: [],
			selectedChannel: null,
			selectedExternalChannel: null,
			direction: "both",
			channelSearch: "",
			externalChannelSearch: "",
			focusedSearch: null,
			submission: Submission.NotSubmitted(),
			removeLinkConfirm: ConfirmAction.init("chat-sync-remove-link"),
			disconnectConfirm: ConfirmAction.init("chat-sync-disconnect"),
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

/** `setRefreshKey(k => k + 1)`: a new query key, so the links load again (the shown ones stay meanwhile). */
const reloadLinks = (model: Model): Pick<Return, "model" | "commands"> => {
	const version = model.linksVersion + 1
	return {
		model: modifyFields(model, {
			links: (links) => Option.getOrElse(AsyncData.revalidateOrLoad(links), () => links),
			linksVersion: () => version,
		}),
		commands: [ListChannelLinks({ syncConnectionId: model.connectionId, version })],
	}
}

/** Keeps one menu per link, preserving the state of menus whose link is still listed. */
const reflectLinkMenus = (model: Model, links: ReadonlyArray<ChannelLink>): Model =>
	modifyFields(model, {
		linkMenus: (menus) =>
			links.map((link) =>
				Option.getOrElse(
					Array.findFirst(menus, (menu) => menu.id === linkMenuId(link.id)),
					() => Menu.init({ id: linkMenuId(link.id), placement: "bottom end" }),
				),
			),
	})

const foldRemoveLinkConfirm = Update.foldChild({
	update: (confirm: ConfirmAction.Model<LinkTarget>, message: ConfirmAction.Message) =>
		ConfirmAction.update(confirm, message),
	read: (model: Model) => Option.some(model.removeLinkConfirm),
	write: (model: Model, removeLinkConfirm: ConfirmAction.Model<LinkTarget>): Model =>
		modifyFields(model, { removeLinkConfirm: () => removeLinkConfirm }),
	toParentMessage: (message: ConfirmAction.Message) => Message.GotRemoveLinkConfirmMessage({ message }),
})

const withRemoveLinkConfirm = (model: Model, removeLinkConfirm: ConfirmAction.Model<LinkTarget>): Model =>
	modifyFields(model, { removeLinkConfirm: () => removeLinkConfirm })

const foldDisconnectConfirm = Update.foldChild({
	update: (confirm: ConfirmAction.Model<SyncConnectionId>, message: ConfirmAction.Message) =>
		ConfirmAction.update(confirm, message),
	read: (model: Model) => Option.some(model.disconnectConfirm),
	write: (model: Model, disconnectConfirm: ConfirmAction.Model<SyncConnectionId>): Model =>
		modifyFields(model, { disconnectConfirm: () => disconnectConfirm }),
	toParentMessage: (message: ConfirmAction.Message) => Message.GotDisconnectConfirmMessage({ message }),
})

const withDisconnectConfirm = (
	model: Model,
	disconnectConfirm: ConfirmAction.Model<SyncConnectionId>,
): Model => modifyFields(model, { disconnectConfirm: () => disconnectConfirm })

const isDirection = (key: string): key is SyncDirection =>
	SyncDirection.literals.some((literal) => literal === key)

/** A link menu's `onAction`s. */
const selectedLinkAction = (model: Model, link: ChannelLink, key: string): Return => {
	if (key === "remove")
		return {
			model: withRemoveLinkConfirm(
				model,
				ConfirmAction.ask(model.removeLinkConfirm, { id: link.id, name: link.externalName }),
			),
		}
	if (key !== "toggle" && !isDirection(key)) return { model }
	// One update per link at a time; the menu stays enabled as in legacy.
	const connection = foundConnection(model)
	if (connection === null || model.updatingLinkIds.includes(link.id)) return { model }
	const target = { syncChannelLinkId: link.id, provider: connection.provider }
	return {
		model: modifyFields(model, { updatingLinkIds: (ids) => [...ids, link.id] }),
		commands: [
			key === "toggle"
				? UpdateChannelLink({ ...target, isActive: !link.isActive })
				: UpdateChannelLink({ ...target, direction: key }),
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
	const link = Array.findFirst(listedLinks(model), (candidate) => candidate.id === linkId)
	const selected = Option.flatMap(Option.fromNullishOr(next.outMessage), (out) =>
		out._tag === "SelectedItem" ? Option.some(out.key) : Option.none(),
	)
	if (Option.isNone(link) || Option.isNone(selected)) return { model: withMenu, commands }
	const action = selectedLinkAction(withMenu, link.value, selected.value)
	return { ...action, commands: [...commands, ...(action.commands ?? [])] }
}

/** `handleClose`: a closed link modal has an empty form and no failed attempt. */
const addLinkModal = {
	read: (model: Model) => Option.some(model.addLinkModal),
	write: (model: Model, modal: Modal.Model): Model =>
		modal.isOpen
			? modifyFields(model, { addLinkModal: () => modal })
			: modifyFields(model, {
					addLinkModal: () => modal,
					selectedChannel: () => null,
					selectedExternalChannel: () => null,
					direction: () => "both" as const,
					channelSearch: () => "",
					externalChannelSearch: () => "",
					focusedSearch: () => null,
					submission: (submission) =>
						submission._tag === "Failed" ? Submission.NotSubmitted() : submission,
				}),
	toParentMessage: (message: Modal.Message) => Message.GotAddLinkModalMessage({ message }),
	foldOutMessage: Modal.ignoreOutMessage,
}
/** `onOpenChange={(open) => !open && handleClose()}`; the portal Mount focuses the channel search (`autoFocus`). */
const foldAddLinkModal = Update.foldChild({ update: Modal.update, ...addLinkModal })
const openAddLinkModal = Update.foldChildStep({ update: Modal.open, ...addLinkModal })
const closeAddLinkModal = Update.foldChildStep({ update: Modal.close, ...addLinkModal })

const submitLink = (model: Model): Return => {
	const channel = model.selectedChannel
	const externalChannel = model.selectedExternalChannel
	if (channel === null || externalChannel === null || model.submission._tag === "Submitting")
		return { model }
	return {
		// Link Channel disables while it runs, which ends its hover (useHover).
		model: modifyFields(model, {
			submission: () => Submission.Submitting(),
			interaction: (state) => Interaction.disabledTargets(state, [CREATE_LINK_TARGET]),
		}),
		commands: [
			CreateChannelLink({
				syncConnectionId: model.connectionId,
				hazelChannelId: channel.id,
				hazelChannelName: channel.name,
				externalChannelId: externalChannel.id,
				externalChannelName: externalChannel.name,
				direction: model.direction,
			}),
		],
	}
}

/** The channel list belongs to the workspace of the connection currently shown. */
const isCurrentWorkspace = (model: Model, workspaceId: string) =>
	foundConnection(model)?.externalWorkspaceId === workspaceId

const requestExternalChannels = (model: Model): Return => {
	const organizationId = model.requestedOrganizationId
	const connection = foundConnection(model)
	if (organizationId === null || connection === null) return { model }
	return {
		model: modifyFields(model, { externalChannels: () => ExternalChannels.Loading() }),
		commands: [
			ListExternalChannels({
				organizationId,
				provider: connection.provider,
				workspaceId: connection.externalWorkspaceId,
			}),
		],
	}
}

const toList = (shared: Shared, toast?: ToastRequest) =>
	requestedOrgNavigation(shared.orgSlug, (orgSlug) => AppRoute.SettingsChatSync({ orgSlug }), { toast })

const linkFailureToast = (reason: LinkFailure) =>
	PageOutMessage.RequestedToast({
		toast: errorToastOf(
			failureMessage(reason, {
				LinkNotFound: {
					title: "Link not found",
					description: "This channel link may have already been removed.",
				},
			}),
		),
	})

export const update = (model: Model, message: Message, shared: Shared): Return =>
	Message.match<Return>(message, {
		SucceededListConnections: ({ organizationId, connections }) => {
			if (organizationId !== model.requestedOrganizationId) return { model }
			const connection = connections.find((found) => found.id === model.connectionId) ?? null
			const next = modifyFields(model, {
				connection: () => ConnectionLookup.Success({ data: connection }),
			})
			// `AddChannelLinkModal` mounts once the connection is found, and queries its workspace's channels.
			const previous = foundConnection(model)
			if (connection === null || previous?.externalWorkspaceId === connection.externalWorkspaceId)
				return { model: next }
			return requestExternalChannels(next)
		},
		// A failed list is an error to show (and retry), not a missing connection.
		FailedListConnections: ({ organizationId, reason }) => {
			if (organizationId !== model.requestedOrganizationId) return { model }
			return Option.match(AsyncData.getData(model.connection), {
				onSome: (data) => ({
					model: modifyFields(model, {
						connection: () => ConnectionLookup.Stale({ error: reason, data }),
					}),
					outMessage: PageOutMessage.RequestedToast({ toast: reasonToast(reason) }),
				}),
				onNone: () => ({
					model: modifyFields(model, {
						connection: () => ConnectionLookup.Failure({ error: reason }),
					}),
				}),
			})
		},
		ClickedRetryLoadConnection: () =>
			model.requestedOrganizationId === null
				? { model }
				: loadConnection(model, model.requestedOrganizationId),
		SucceededListExternalChannels: ({ workspaceId, channels }) =>
			isCurrentWorkspace(model, workspaceId)
				? {
						model: modifyFields(model, {
							externalChannels: () => ExternalChannels.Success({ data: channels }),
						}),
					}
				: { model },
		FailedListExternalChannels: ({ workspaceId, reason }) =>
			isCurrentWorkspace(model, workspaceId)
				? {
						model: modifyFields(model, {
							externalChannels: () => ExternalChannels.Failure({ error: reason }),
						}),
					}
				: { model },
		ClickedRetryListExternalChannels: () => requestExternalChannels(model),
		SucceededListChannelLinks: ({ version, links }) =>
			version !== model.linksVersion
				? { model }
				: {
						model: reflectLinkMenus(
							modifyFields(model, { links: () => ChannelLinks.Success({ data: links }) }),
							links,
						),
					},
		// A failed first list shows the error with a retry; a failed reload keeps the shown links.
		FailedListChannelLinks: ({ version, reason }) => {
			if (version !== model.linksVersion) return { model }
			return Option.match(AsyncData.getData(model.links), {
				onSome: (data) => ({
					model: modifyFields(model, { links: () => ChannelLinks.Stale({ error: reason, data }) }),
					outMessage: PageOutMessage.RequestedToast({
						toast: errorToastOf(listLinksFailureMessage(reason)),
					}),
				}),
				onNone: () => ({
					model: reflectLinkMenus(
						modifyFields(model, { links: () => ChannelLinks.Failure({ error: reason }) }),
						[],
					),
				}),
			})
		},
		ClickedRetryListChannelLinks: () => reloadLinks(model),
		UpdatedChannelNames: ({ names }) => ({ model: modifyFields(model, { channelNames: () => names }) }),
		ClickedBack: () => ({
			model,
			outMessage: toList(shared),
		}),
		ClickedDisconnect: () => ({
			model: withDisconnectConfirm(
				model,
				ConfirmAction.ask(model.disconnectConfirm, model.connectionId),
			),
		}),
		ClickedConfirmDisconnect: () =>
			Option.match(ConfirmAction.confirm(model.disconnectConfirm), {
				onNone: () => ({ model }),
				onSome: ([running, syncConnectionId]) => ({
					model: withDisconnectConfirm(model, running),
					commands: [DisconnectConnection({ syncConnectionId })],
				}),
			}),
		SucceededDisconnect: () => ({
			model: withDisconnectConfirm(model, ConfirmAction.close(model.disconnectConfirm)),
			outMessage: toList(shared, successToast("Connection deleted")),
		}),
		FailedDisconnect: ({ reason }) => ({
			model: withDisconnectConfirm(model, ConfirmAction.failed(model.disconnectConfirm)),
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
		ClickedLinkChannel: () => openAddLinkModal(model),
		GotAddLinkModalMessage: ({ message: modalMessage }) => foldAddLinkModal(model, modalMessage),
		UpdatedHazelChannels: ({ channels }) => ({
			model: modifyFields(model, { hazelChannels: () => channels }),
		}),
		ChangedChannelSearch: ({ value }) => ({ model: modifyFields(model, { channelSearch: () => value }) }),
		ChangedExternalChannelSearch: ({ value }) => ({
			model: modifyFields(model, { externalChannelSearch: () => value }),
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
		ClickedExternalChannel: ({ channel }) => ({
			model: modifyFields(model, {
				selectedExternalChannel: () => channel,
				externalChannelSearch: () => "",
				focusedSearch: () => null,
			}),
		}),
		GotInteractionMessage: ({ message }) => interaction.fold(model, message),
		ClickedChangeExternalChannel: () => ({
			model: modifyFields(model, { selectedExternalChannel: () => null }),
		}),
		ClickedDirection: ({ direction }) => ({ model: modifyFields(model, { direction: () => direction }) }),
		ClickedCreateLink: () => submitLink(model),
		// `onSuccess()` reloads the links (a new query key), then `handleClose()`.
		SucceededCreateLink: ({ successMessage }) => ({
			...Update.combine(modifyFields(model, { submission: () => Submission.NotSubmitted() }), [
				closeAddLinkModal,
				reloadLinks,
			]),
			outMessage: PageOutMessage.RequestedToast({ toast: successToast(successMessage) }),
		}),
		FailedCreateLink: ({ reason }) => ({
			model: modifyFields(model, { submission: () => Submission.Failed({ reason }) }),
			outMessage: PageOutMessage.RequestedToast({
				toast: errorToastOf(
					failureMessage(reason, {
						ConnectionNotFound: {
							title: "Connection not found",
							description: "This sync connection may have been deleted.",
						},
						// This pair, or the external channel synced by another organization.
						AlreadyLinked: {
							title: "Link already exists",
							description: "This channel is already synced.",
						},
					}),
				),
			}),
		}),
		ClickedConfirmRemoveLink: () =>
			Option.match(ConfirmAction.confirm(model.removeLinkConfirm), {
				onNone: () => ({ model }),
				onSome: ([running, target]) => ({
					model: withRemoveLinkConfirm(model, running),
					commands: [RemoveChannelLink({ syncChannelLinkId: target.id })],
				}),
			}),
		SucceededRemoveLink: () => ({
			...reloadLinks(withRemoveLinkConfirm(model, ConfirmAction.close(model.removeLinkConfirm))),
			outMessage: PageOutMessage.RequestedToast({ toast: successToast("Channel link removed") }),
		}),
		FailedRemoveLink: ({ reason }) => ({
			model: withRemoveLinkConfirm(model, ConfirmAction.failed(model.removeLinkConfirm)),
			outMessage: linkFailureToast(reason),
		}),
		SucceededUpdateLink: ({ linkId, successMessage }) => ({
			...reloadLinks(settledLink(model, linkId)),
			outMessage: PageOutMessage.RequestedToast({ toast: successToast(successMessage) }),
		}),
		FailedUpdateLink: ({ linkId, reason }) => ({
			model: settledLink(model, linkId),
			outMessage: linkFailureToast(reason),
		}),
		GotLinkMenuMessage: ({ linkId, message: menuMessage }) => foldLinkMenu(model, linkId, menuMessage),
		GotRemoveLinkConfirmMessage: ({ message: confirmMessage }) =>
			foldRemoveLinkConfirm(model, confirmMessage),
		GotDisconnectConfirmMessage: ({ message: confirmMessage }) =>
			foldDisconnectConfirm(model, confirmMessage),
	})
