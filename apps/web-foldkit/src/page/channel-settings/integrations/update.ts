import { Array, Option } from "effect"
import { Command } from "foldkit"
import { modifyFields } from "foldkit/struct"
import type { ToastRequest } from "../../../overlay/toasts"
import type { RouteOf } from "../../../route"
import { resolveSystemTheme } from "../../../theme"
import * as Menu from "../../../ui/menu"
import * as Modal from "../../../ui/modal"
import { successToast } from "../../../ui/toast-exit"
import type { PageReturn, Shared } from "../../contract"
import { PageOutMessage } from "../../out-message"
import { CopyText, ListGitHub, ListRss, ListWebhooks, RunRowAction, WaitForCopiedReset } from "./command"
import { Message } from "./message"
import { type Model, type ProviderCard, type RowKind, rowMenuId } from "./model"
import { reflectRowMenus } from "./rows"
import { updateCards } from "./update-cards"

export type Return = PageReturn<Model, Message>

const idleCard: ProviderCard = {
	isCreating: false,
	isDeleting: false,
	confirmDelete: false,
	confirmVersion: 0,
	createdToken: null,
}

export const init = (route: RouteOf<"ChannelSettingsIntegrations">): Return => ({
	model: {
		channelId: route.channelId,
		resolvedTheme: resolveSystemTheme(),
		isGitHubConnected: false,
		webhooks: { isLoading: true, items: [] },
		rss: { isLoading: true, items: [] },
		// `useEffect`: not loading until the GitHub connection is known to exist.
		github: { isLoading: false, items: [] },
		rowMenus: [],
		togglingRowIds: [],
		copiedIds: [],
		confirmTarget: null,
		confirmModal: Modal.init("integration-row-remove"),
		isConfirmPending: false,
		providers: { openstatus: idleCard, railway: idleCard },
		createForm: {
			isExpanded: false,
			name: "",
			description: "",
			avatarUrl: "",
			isNameDirty: false,
			isSubmitting: false,
			created: null,
			isTokenVisible: false,
		},
	},
	// Mount effects: `fetchWebhooks()` in the page, `fetchSubscriptions()` in the RSS card.
	commands: [ListWebhooks({ channelId: route.channelId }), ListRss({ channelId: route.channelId })],
})

export const toast = (request: ToastRequest) => PageOutMessage.RequestedToast({ toast: request })
export const errorToast = (title: string, description: string | null) =>
	toast({ intent: "error", title, description })

/** The list a row belongs to reloads with its spinner, like `onUpdate` / `onDelete` refetches. */
export const reload = (model: Model, kind: RowKind): Return => {
	if (kind === "webhook")
		return {
			model: modifyFields(model, { webhooks: (list) => ({ ...list, isLoading: true }) }),
			commands: [ListWebhooks({ channelId: model.channelId })],
		}
	if (kind === "rss")
		return {
			model: modifyFields(model, { rss: (list) => ({ ...list, isLoading: true }) }),
			commands: [ListRss({ channelId: model.channelId })],
		}
	return {
		model: modifyFields(model, { github: (list) => ({ ...list, isLoading: true }) }),
		commands: [ListGitHub({ channelId: model.channelId })],
	}
}

const rowEnabled = (model: Model, kind: RowKind, id: string): boolean => {
	if (kind === "webhook") return model.webhooks.items.find((row) => row.id === id)?.isEnabled ?? false
	if (kind === "rss") return model.rss.items.find((row) => row.id === id)?.isEnabled ?? false
	return model.github.items.find((row) => row.id === id)?.isEnabled ?? false
}

const selectedRowItem = (model: Model, kind: RowKind, id: string, key: string): Return => {
	if (key === "toggle")
		return {
			model: reflectRowMenus(modifyFields(model, { togglingRowIds: (ids) => [...ids, id] })),
			commands: [RunRowAction({ kind, id, isEnabled: !rowEnabled(model, kind, id) })],
		}
	if (key === "remove")
		return {
			model: modifyFields(model, {
				confirmTarget: () => ({ kind, id }),
				confirmModal: (modal) => Modal.open(modal).model,
			}),
		}
	// "edit" opens EditGitHubSubscriptionModal, which is not ported yet.
	return { model }
}

const foldRowMenu = (model: Model, kind: RowKind, id: string, message: Menu.Message): Return => {
	const menuId = rowMenuId(kind, id)
	const menu = Array.findFirst(model.rowMenus, (candidate) => candidate.id === menuId)
	if (Option.isNone(menu)) return { model }
	const next = Menu.update(menu.value, message)
	const withMenu = modifyFields(model, {
		rowMenus: Array.map((candidate) => (candidate.id === menuId ? next.model : candidate)),
	})
	const commands = Command.mapMessages(next.commands ?? [], (child) =>
		Message.GotRowMenuMessage({ kind, id, message: child }),
	)
	const out = next.outMessage
	if (out === undefined || out._tag !== "SelectedItem") return { model: withMenu, commands }
	const selected = selectedRowItem(withMenu, kind, id, out.key)
	return { ...selected, commands: [...commands, ...(selected.commands ?? [])] }
}

const settleRowAction = (model: Model, kind: RowKind, id: string): Model => {
	const isConfirmed = model.confirmTarget?.id === id && model.isConfirmPending
	return reflectRowMenus(
		modifyFields(model, {
			togglingRowIds: (ids) => ids.filter((candidate) => candidate !== id),
			// `setShowDeleteDialog(false)` after the delete, whatever its outcome.
			...(isConfirmed
				? {
						isConfirmPending: () => false,
						confirmTarget: () => null,
						confirmModal: (modal: Modal.Model) => Modal.close(modal).model,
					}
				: {}),
		}),
	)
}

export const update = (model: Model, message: Message, shared: Shared): Return =>
	Message.match<Return>(message, {
		ChangedSystemTheme: ({ theme }) => ({ model: modifyFields(model, { resolvedTheme: () => theme }) }),
		UpdatedGitHubConnection: ({ isConnected }) => {
			if (isConnected === model.isGitHubConnected) return { model }
			const next = modifyFields(model, { isGitHubConnected: () => isConnected })
			return isConnected
				? reload(next, "github")
				: { model: modifyFields(next, { github: (list) => ({ ...list, isLoading: false }) }) }
		},
		SucceededListWebhooks: ({ webhooks }) => ({
			model: reflectRowMenus(
				modifyFields(model, { webhooks: () => ({ isLoading: false, items: webhooks }) }),
			),
		}),
		SucceededListRss: ({ feeds }) => ({
			model: reflectRowMenus(modifyFields(model, { rss: () => ({ isLoading: false, items: feeds }) })),
		}),
		SucceededListGitHub: ({ repos }) => ({
			model: reflectRowMenus(
				modifyFields(model, { github: () => ({ isLoading: false, items: repos }) }),
			),
		}),
		FailedList: ({ list, title, description }) => ({
			model: { ...model, [list]: { ...model[list], isLoading: false } },
			outMessage: errorToast(title, description),
		}),
		// `window.location.href = /$orgSlug/settings/integrations/github`
		ClickedConnectGitHub: () => ({
			model,
			outMessage: PageOutMessage.RequestedNavigation({
				href: `/${shared.orgSlug ?? ""}/settings/integrations/github`,
				replace: false,
			}),
		}),
		// AddGitHubRepoModal and AddRssFeedModal are not ported yet.
		ClickedAddRepo: () => ({ model }),
		ClickedAddFeed: () => ({ model }),
		GotRowMenuMessage: ({ kind, id, message: menuMessage }) => foldRowMenu(model, kind, id, menuMessage),
		SucceededRowAction: ({ kind, id, successMessage }) => {
			const reloaded = reload(settleRowAction(model, kind, id), kind)
			return { ...reloaded, outMessage: toast(successToast(successMessage)) }
		},
		FailedRowAction: ({ kind, id, title, description }) => ({
			model: settleRowAction(model, kind, id),
			outMessage: errorToast(title, description),
		}),
		ClickedConfirmRemove: () =>
			model.confirmTarget === null || model.isConfirmPending
				? { model }
				: {
						model: modifyFields(model, { isConfirmPending: () => true }),
						commands: [RunRowAction({ ...model.confirmTarget, isEnabled: null })],
					},
		GotConfirmModalMessage: ({ message: modalMessage }) => {
			const next = Modal.update(model.confirmModal, modalMessage)
			return {
				model: modifyFields(model, {
					confirmModal: () => next.model,
					confirmTarget: (target) => (next.model.isOpen ? target : null),
				}),
				commands: Command.mapMessages(next.commands ?? [], (child) =>
					Message.GotConfirmModalMessage({ message: child }),
				),
			}
		},
		ClickedCopy: (copy) => ({ model, commands: [CopyText(copy)] }),
		CompletedCopy: ({ id, isCopied, toastTitle }) =>
			isCopied
				? {
						model: modifyFields(model, {
							copiedIds: (ids) => [...ids.filter((found) => found !== id), id],
						}),
						commands: [WaitForCopiedReset({ id })],
						outMessage: toast(successToast(toastTitle)),
					}
				: { model, outMessage: errorToast(toastTitle, null) },
		ElapsedCopiedDelay: ({ id }) => ({
			model: modifyFields(model, { copiedIds: (ids) => ids.filter((found) => found !== id) }),
		}),
		...updateCards(model),
	})
