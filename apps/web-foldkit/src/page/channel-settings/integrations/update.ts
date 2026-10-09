import { Array, Option } from "effect"
import { Command, Update } from "foldkit"
import { modifyFields } from "foldkit/struct"
import type { ToastRequest } from "../../../overlay/toasts"
import { AppRoute, type RouteOf } from "../../../route"
import * as Menu from "../../../ui/menu"
import * as Modal from "../../../ui/modal"
import { errorToast, successToast } from "../../../data/actions"
import type { PageReturn, Shared } from "../../contract"
import { PageOutMessage, requestedOrgNavigation } from "../../out-message"
import { CopyText, ListRss, ListWebhooks, RunRowAction, WaitForCopiedReset } from "./command"
import { Message } from "./message"
import { type ConfirmTarget, type Model, type ProviderCard, type RowKind, rowMenuId } from "./model"
import { reflectRowMenus, reload } from "./rows"
import { updateCards } from "./update-cards"

export type Return = PageReturn<Model, Message>

const idleCard: ProviderCard = {
	isCreating: false,
	isToggling: false,
	isDeleting: false,
	confirmDelete: false,
	confirmVersion: 0,
	createdToken: null,
}

export const init = (route: RouteOf<"ChannelSettingsIntegrations">): Return => ({
	model: {
		channelId: route.channelId,
		isGitHubConnected: false,
		webhooks: { isLoading: true, version: 1, items: [] },
		rss: { isLoading: true, version: 1, items: [] },
		// `useEffect`: not loading until the GitHub connection is known to exist.
		github: { isLoading: false, version: 0, items: [] },
		rowMenus: [],
		togglingRowIds: [],
		copiedIds: [],
		confirm: { _tag: "Closed" },
		confirmModal: Modal.init("integration-row-remove"),
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
	commands: [
		ListWebhooks({ channelId: route.channelId, version: 1 }),
		ListRss({ channelId: route.channelId, version: 1 }),
	],
})

export const toast = (request: ToastRequest) => PageOutMessage.RequestedToast({ toast: request })

/** The list a row belongs to reloads with its spinner, like `onUpdate` / `onDelete` refetches. */
const confirmModal = {
	read: (model: Model) => Option.some(model.confirmModal),
	// Dismissing the dialog drops a target still being asked about; a running removal keeps going.
	write: (model: Model, modal: Modal.Model): Model =>
		modifyFields(model, {
			confirmModal: () => modal,
			confirm: (confirm) =>
				!modal.isOpen && confirm._tag === "Confirming" ? { _tag: "Closed" as const } : confirm,
		}),
	toParentMessage: (message: Modal.Message) => Message.GotConfirmModalMessage({ message }),
}
const foldConfirmModal = Update.foldChild({ update: Modal.update, ...confirmModal })
const openConfirmModal = Update.foldChildStep({ update: Modal.open, ...confirmModal })
const closeConfirmModal = Update.foldChildStep({ update: Modal.close, ...confirmModal })

const withCommands = (result: Return, commands: Return["commands"]): Return => ({
	...result,
	commands: [...(result.commands ?? []), ...(commands ?? [])],
})

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
	if (key === "remove") {
		const target: ConfirmTarget = { kind, id }
		return openConfirmModal(
			modifyFields(model, { confirm: () => ({ _tag: "Confirming" as const, target }) }),
		)
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

const settleRowAction = (model: Model, kind: RowKind, id: string): Return => {
	const settled = reflectRowMenus(
		modifyFields(model, { togglingRowIds: (ids) => ids.filter((candidate) => candidate !== id) }),
	)
	const isRemoval =
		model.confirm._tag === "Removing" &&
		model.confirm.target.kind === kind &&
		model.confirm.target.id === id
	// `setShowDeleteDialog(false)` after the delete, whatever its outcome, even if Escape closed it already.
	return isRemoval
		? closeConfirmModal(modifyFields(settled, { confirm: () => ({ _tag: "Closed" as const }) }))
		: { model: settled }
}

/** A list result lands only if it answers the list's latest request. */
const isCurrent = (list: { readonly version: number }, version: number) => list.version === version

export const update = (model: Model, message: Message, shared: Shared): Return =>
	Message.match<Return>(message, {
		UpdatedGitHubConnection: ({ isConnected }) => {
			if (isConnected === model.isGitHubConnected) return { model }
			const next = modifyFields(model, { isGitHubConnected: () => isConnected })
			return isConnected
				? reload(next, "github")
				: {
						model: modifyFields(next, {
							github: (list) => modifyFields(list, { isLoading: () => false }),
						}),
					}
		},
		SucceededListWebhooks: ({ version, webhooks }) =>
			isCurrent(model.webhooks, version)
				? {
						model: reflectRowMenus(
							modifyFields(model, {
								webhooks: () => ({ isLoading: false, version, items: webhooks }),
							}),
						),
					}
				: { model },
		SucceededListRss: ({ version, feeds }) =>
			isCurrent(model.rss, version)
				? {
						model: reflectRowMenus(
							modifyFields(model, { rss: () => ({ isLoading: false, version, items: feeds }) }),
						),
					}
				: { model },
		SucceededListGitHub: ({ version, repos }) =>
			isCurrent(model.github, version)
				? {
						model: reflectRowMenus(
							modifyFields(model, {
								github: () => ({ isLoading: false, version, items: repos }),
							}),
						),
					}
				: { model },
		FailedList: ({ list, version, toast: request }) =>
			isCurrent(model[list], version)
				? {
						model: { ...model, [list]: { ...model[list], isLoading: false } },
						outMessage: toast(request),
					}
				: { model },
		// `window.location.href = /$orgSlug/settings/integrations/github`
		ClickedConnectGitHub: () => ({
			model,
			outMessage: requestedOrgNavigation(shared.orgSlug, (orgSlug) =>
				AppRoute.SettingsIntegration({
					orgSlug,
					integrationId: "github",
					connectionStatus: Option.none(),
					errorCode: Option.none(),
				}),
			),
		}),
		// AddGitHubRepoModal and AddRssFeedModal are not ported yet.
		ClickedAddRepo: () => ({ model }),
		ClickedAddFeed: () => ({ model }),
		GotRowMenuMessage: ({ kind, id, message: menuMessage }) => foldRowMenu(model, kind, id, menuMessage),
		SucceededRowAction: ({ kind, id, successMessage }) => {
			const settled = settleRowAction(model, kind, id)
			return {
				...withCommands(reload(settled.model, kind), settled.commands),
				outMessage: toast(successToast(successMessage)),
			}
		},
		FailedRowAction: ({ kind, id, toast: request }) => ({
			...settleRowAction(model, kind, id),
			outMessage: toast(request),
		}),
		ClickedConfirmRemove: () => {
			const confirm = model.confirm
			if (confirm._tag !== "Confirming") return { model }
			return {
				model: modifyFields(model, {
					confirm: () => ({ _tag: "Removing" as const, target: confirm.target }),
				}),
				commands: [RunRowAction({ ...confirm.target, isEnabled: null })],
			}
		},
		GotConfirmModalMessage: ({ message: modalMessage }) => foldConfirmModal(model, modalMessage),
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
				: { model, outMessage: toast(errorToast(toastTitle)) },
		ElapsedCopiedDelay: ({ id }) => ({
			model: modifyFields(model, { copiedIds: (ids) => ids.filter((found) => found !== id) }),
		}),
		...updateCards(model),
	})
