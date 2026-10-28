import { Array, Option, Result } from "effect"
import { Command, Update } from "foldkit"
import * as AsyncData from "foldkit/asyncData"
import { modifyFields } from "foldkit/struct"
import { failureMessage } from "~/lib/error-messages"
import { errorToast, errorToastOf, successToast } from "../../../data/actions"
import { AppRoute, type RouteOf } from "../../../route"
import * as Menu from "../../../ui/menu"
import type { PageReturn, Shared } from "../../contract"
import { PageOutMessage, requestedOrgNavigation } from "../../out-message"
import * as ConfirmAction from "../../shared/confirm-action"
import { CopyText, ListRss, ListWebhooks, RunRowAction, WaitForCopiedReset } from "./command"
import { Message } from "./message"
import {
	CardAction,
	type ChannelRequestFailure,
	type ConfirmTarget,
	emptyCreateForm,
	GitHubRepos,
	itemsOf,
	type Model,
	type ProviderCard,
	type RowActionFailure,
	type RowKind,
	RssFeeds,
	rowMenuId,
	Webhooks,
} from "./model"
import { reflectRowMenus, reload } from "./rows"
import { updateCards } from "./update-cards"

export type Return = PageReturn<Model, Message>

const idleCard: ProviderCard = { action: CardAction.Idle(), confirmVersion: 0, createdToken: null }

export const init = (route: RouteOf<"ChannelSettingsIntegrations">): Return => ({
	model: {
		channelId: route.channelId,
		isGitHubConnected: false,
		webhooks: { version: 1, data: Webhooks.Loading() },
		rss: { version: 1, data: RssFeeds.Loading() },
		// `useEffect`: nothing to load until the GitHub connection is known to exist.
		github: { version: 0, data: GitHubRepos.Idle() },
		rowMenus: [],
		togglingRowIds: [],
		copiedIds: [],
		remove: ConfirmAction.init("integration-row-remove"),
		providers: { openstatus: idleCard, railway: idleCard },
		createForm: emptyCreateForm,
	},
	// Mount effects: `fetchWebhooks()` in the page, `fetchSubscriptions()` in the RSS card.
	commands: [
		ListWebhooks({ channelId: route.channelId, version: 1 }),
		ListRss({ channelId: route.channelId, version: 1 }),
	],
})

/** A list result lands only if it answers the list's latest request; a failure keeps loaded rows (`Stale`). */
const settleList = <A>(
	list: {
		readonly version: number
		readonly data: AsyncData.AsyncData<ReadonlyArray<A>, ChannelRequestFailure>
	},
	version: number,
	result: Result.Result<ReadonlyArray<A>, ChannelRequestFailure>,
) => (list.version === version ? { version, data: AsyncData.settle(list.data, result) } : list)

const settleListOf = (model: Model, kind: RowKind, version: number, reason: ChannelRequestFailure): Model => {
	const failure = Result.fail(reason)
	if (kind === "webhook")
		return modifyFields(model, { webhooks: (list) => settleList(list, version, failure) })
	if (kind === "rss") return modifyFields(model, { rss: (list) => settleList(list, version, failure) })
	return modifyFields(model, { github: (list) => settleList(list, version, failure) })
}

const removeConfirm = Update.foldChild({
	update: (remove: ConfirmAction.Model<ConfirmTarget>, message: ConfirmAction.Message) =>
		ConfirmAction.update(remove, message),
	read: (model: Model) => Option.some(model.remove),
	write: (model: Model, remove: ConfirmAction.Model<ConfirmTarget>): Model =>
		modifyFields(model, { remove: () => remove }),
	toParentMessage: (message: ConfirmAction.Message) => Message.GotRemoveConfirmMessage({ message }),
})

const rowEnabled = (model: Model, kind: RowKind, id: string): boolean => {
	if (kind === "webhook") return itemsOf(model.webhooks).find((row) => row.id === id)?.isEnabled ?? false
	if (kind === "rss") return itemsOf(model.rss).find((row) => row.id === id)?.isEnabled ?? false
	return itemsOf(model.github).find((row) => row.id === id)?.isEnabled ?? false
}

const selectedRowItem = (model: Model, kind: RowKind, id: string, key: string): Return => {
	if (key === "toggle")
		return {
			model: reflectRowMenus(modifyFields(model, { togglingRowIds: (ids) => [...ids, id] })),
			commands: [
				RunRowAction({
					kind,
					id,
					channelId: model.channelId,
					isEnabled: !rowEnabled(model, kind, id),
				}),
			],
		}
	if (key === "remove")
		return { model: modifyFields(model, { remove: (remove) => ConfirmAction.ask(remove, { kind, id }) }) }
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
		Message.GotRowMenuMessage({ rowMenuId: { kind, id }, message: child }),
	)
	const out = next.outMessage
	if (out === undefined || out._tag !== "SelectedItem") return { model: withMenu, commands }
	const selected = selectedRowItem(withMenu, kind, id, out.key)
	return { ...selected, commands: [...commands, ...(selected.commands ?? [])] }
}

const isRemoving = (model: Model, kind: RowKind, id: string): boolean =>
	ConfirmAction.isRunning(model.remove) &&
	Option.exists(ConfirmAction.targetOf(model.remove), (target) => target.kind === kind && target.id === id)

/**
 * The row's action settled: its toggle stops running, and a removal closes the dialog on success
 * (even if Escape closed it already) or goes back to asking on failure.
 */
const settleRowAction = (model: Model, kind: RowKind, id: string, isSuccess: boolean): Model => {
	const settled = reflectRowMenus(
		modifyFields(model, { togglingRowIds: (ids) => ids.filter((candidate) => candidate !== id) }),
	)
	if (!isRemoving(model, kind, id)) return settled
	return modifyFields(settled, {
		remove: (remove) => (isSuccess ? ConfirmAction.close(remove) : ConfirmAction.failed(remove)),
	})
}

const ROW_NOUNS: Readonly<Record<RowKind, { readonly title: string; readonly noun: string }>> = {
	webhook: { title: "Webhook not found", noun: "webhook" },
	rss: { title: "Subscription not found", noun: "subscription" },
	github: { title: "Subscription not found", noun: "subscription" },
}

const rowActionFailureMessage = (kind: RowKind, isToggle: boolean, reason: RowActionFailure) => {
	const { title, noun } = ROW_NOUNS[kind]
	return failureMessage(reason, {
		NotFound: {
			title,
			description: isToggle
				? `This ${noun} may have been deleted.`
				: `This ${noun} may have already been deleted.`,
		},
	})
}

export const update = (model: Model, message: Message, shared: Shared): Return =>
	Message.match<Return>(message, {
		UpdatedGitHubConnection: ({ isConnected }) => {
			if (isConnected === model.isGitHubConnected) return { model }
			const next = modifyFields(model, { isGitHubConnected: () => isConnected })
			return isConnected
				? reload(next, "github")
				: // The card hides the list; a request in flight is dropped by the version bump.
					{
						model: modifyFields(next, {
							github: (list) => ({ version: list.version + 1, data: GitHubRepos.Idle() }),
						}),
					}
		},
		SucceededListWebhooks: ({ version, webhooks }) => ({
			model: reflectRowMenus(
				modifyFields(model, {
					webhooks: (list) => settleList(list, version, Result.succeed(webhooks)),
				}),
			),
		}),
		SucceededListRss: ({ version, feeds }) => ({
			model: reflectRowMenus(
				modifyFields(model, { rss: (list) => settleList(list, version, Result.succeed(feeds)) }),
			),
		}),
		SucceededListGitHub: ({ version, repos }) => ({
			model: reflectRowMenus(
				modifyFields(model, { github: (list) => settleList(list, version, Result.succeed(repos)) }),
			),
		}),
		FailedList: ({ kind, version, reason }) => ({ model: settleListOf(model, kind, version, reason) }),
		ClickedRetryList: ({ kind }) => reload(model, kind),
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
		GotRowMenuMessage: ({ rowMenuId: { kind, id }, message: menuMessage }) =>
			foldRowMenu(model, kind, id, menuMessage),
		SucceededRowAction: ({ kind, id, successMessage }) => ({
			...reload(settleRowAction(model, kind, id, true), kind),
			outMessage: PageOutMessage.RequestedToast({ toast: successToast(successMessage) }),
		}),
		FailedRowAction: ({ kind, id, reason }) => ({
			model: settleRowAction(model, kind, id, false),
			outMessage: PageOutMessage.RequestedToast({
				toast: errorToastOf(rowActionFailureMessage(kind, model.togglingRowIds.includes(id), reason)),
			}),
		}),
		ClickedConfirmRemove: () =>
			Option.match(ConfirmAction.confirm(model.remove), {
				onNone: () => ({ model }),
				onSome: ([remove, target]) => ({
					model: modifyFields(model, { remove: () => remove }),
					commands: [RunRowAction({ ...target, channelId: model.channelId, isEnabled: null })],
				}),
			}),
		GotRemoveConfirmMessage: ({ message: confirmMessage }) => removeConfirm(model, confirmMessage),
		ClickedCopy: (copy) => ({ model, commands: [CopyText(copy)] }),
		SucceededCopy: ({ id, successMessage }) => ({
			model: modifyFields(model, { copiedIds: (ids) => [...ids.filter((found) => found !== id), id] }),
			commands: [WaitForCopiedReset({ id })],
			outMessage: PageOutMessage.RequestedToast({ toast: successToast(successMessage) }),
		}),
		FailedCopy: ({ failureMessage: title }) => ({
			model,
			outMessage: PageOutMessage.RequestedToast({ toast: errorToast(title) }),
		}),
		ElapsedCopiedDelay: ({ id }) => ({
			model: modifyFields(model, { copiedIds: (ids) => ids.filter((found) => found !== id) }),
		}),
		...updateCards(model),
	})
