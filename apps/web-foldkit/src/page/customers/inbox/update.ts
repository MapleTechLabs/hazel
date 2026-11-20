import type * as Customers from "@hazel/domain/customers"
import type { CustomerIssueId, UserId } from "@hazel/schema"
import { Command } from "foldkit"
import { modifyFields } from "foldkit/struct"
import { failureMessage } from "~/lib/error-messages"
import { type IssueRow, STATUS_LABEL } from "../../../customers/issues"
import { errorToastOf, successToast } from "../../../data/actions"
import { AppRoute, customerRoute } from "../../../route"
import * as Menu from "../../../ui/menu"
import type { PageReturn, Shared } from "../../contract"
import { PageOutMessage, requestedOrgNavigation } from "../../out-message"
import { FocusInboxSearch, UpdateInboxIssue } from "./commands"
import { type IssueAction, Message } from "./message"
import {
	ASSIGN_ME,
	ASSIGN_MENU_ID,
	ASSIGN_NONE,
	assignEntries,
	clearFilter,
	clearNarrowing,
	DEFAULT_FILTERS,
	FILTER_MENU_ID,
	type InboxKey,
	isSelectionVisible,
	issueById,
	type Model,
	PRIORITY_MENU_ID,
	priorityEntries,
	rowIds,
	selectedIssue,
	STATUS_MENU_ID,
	statusEntries,
	toggleFilter,
	userIdOfAssignKey,
	type Viewer,
} from "./model"

type Return = PageReturn<Model, Message>
type Commands = NonNullable<Return["commands"]>

export const viewerOf = (shared: Shared): Viewer => ({
	userId: shared.currentUser?.id ?? null,
	nowMs: shared.nowMs,
})

// INIT

export const init = (): Return => ({
	model: {
		tab: "open",
		filters: DEFAULT_FILTERS,
		search: "",
		issues: null,
		accounts: null,
		channels: [],
		members: [],
		selectedId: null,
		assignMenu: Menu.init({ id: ASSIGN_MENU_ID, placement: "bottom end" }),
		statusMenu: Menu.init({ id: STATUS_MENU_ID, placement: "bottom end" }),
		priorityMenu: Menu.init({ id: PRIORITY_MENU_ID, placement: "bottom end" }),
		filterMenu: Menu.init({ id: FILTER_MENU_ID }),
	},
})

// SELECTION

const select = (model: Model, issueId: CustomerIssueId | null): Model =>
	modifyFields(model, { selectedId: () => issueId })

/** j / k: the next or previous row; from no selection, the first row. */
const move = (model: Model, shared: Shared, step: 1 | -1): Return => {
	const ids = rowIds(model, viewerOf(shared))
	if (ids.length === 0) return { model }
	const index = model.selectedId === null ? -1 : ids.indexOf(model.selectedId)
	const next = index < 0 ? 0 : Math.min(ids.length - 1, Math.max(0, index + step))
	return { model: select(model, ids[next] ?? null) }
}

/** The selection, or the first row when there is none (an action key on an unselected inbox). */
const ensureSelection = (model: Model, shared: Shared): Model => {
	if (isSelectionVisible(model, viewerOf(shared))) return model
	const first = rowIds(model, viewerOf(shared))[0]
	return first === undefined ? model : select(model, first)
}

/**
 * Runs an action key on the selected row. A selection the search or filters now hide only moves to
 * the first row: a key never acts on a row the user has not seen selected.
 */
const withSelected = (
	model: Model,
	shared: Shared,
	run: (model: Model, issue: IssueRow) => Return,
): Return => {
	const isHidden = model.selectedId !== null && !isSelectionVisible(model, viewerOf(shared))
	const next = ensureSelection(model, shared)
	const issue = selectedIssue(next)
	return issue === undefined || isHidden ? { model: next } : run(next, issue)
}

// ACTIONS

const toast = (request: Parameters<typeof PageOutMessage.RequestedToast>[0]["toast"]) =>
	PageOutMessage.RequestedToast({ toast: request })

const actorOf = (shared: Shared) => {
	const organizationId = shared.organization?.id
	const userId = shared.currentUser?.id
	return organizationId === undefined || userId === undefined ? undefined : { organizationId, userId }
}

/**
 * Patches the row at once (the collection confirms or rolls it back); when it leaves the tab or the
 * filters, the selection moves to the row that took its place so the keyboard keeps going.
 */
const act = (
	model: Model,
	shared: Shared,
	issue: IssueRow,
	patch: Partial<IssueRow>,
	command: Commands[number],
): Return => {
	const viewer = viewerOf(shared)
	const before = rowIds(model, viewer)
	const patched = modifyFields(model, {
		issues: (issues) => issues?.map((row) => (row.id === issue.id ? { ...row, ...patch } : row)) ?? null,
	})
	const after = rowIds(patched, viewer)
	const index = before.indexOf(issue.id)
	const stays = after.includes(issue.id)
	const neighbour = stays ? issue.id : (after[Math.min(Math.max(index, 0), after.length - 1)] ?? null)
	return {
		model: model.selectedId === issue.id ? select(patched, neighbour) : patched,
		commands: [command],
	}
}

const assign = (model: Model, shared: Shared, issue: IssueRow, key: string): Return => {
	const actor = actorOf(shared)
	if (actor === undefined) return { model }
	const assigneeUserId: UserId | null | undefined =
		key === ASSIGN_ME
			? actor.userId
			: key === ASSIGN_NONE
				? null
				: model.members.find((member) => member.id === userIdOfAssignKey(key))?.id
	if (assigneeUserId === undefined || assigneeUserId === issue.assigneeUserId) return { model }
	return act(
		model,
		shared,
		issue,
		{ assigneeUserId },
		UpdateInboxIssue({
			organizationId: actor.organizationId,
			issueId: issue.id,
			actor: actor.userId,
			action: "assign",
			assigneeUserId,
		}),
	)
}

const setStatus = (model: Model, shared: Shared, issue: IssueRow, status: Customers.IssueStatus): Return => {
	const actor = actorOf(shared)
	if (actor === undefined || status === issue.status) return { model }
	const closing = status === "closed"
	const result = act(
		model,
		shared,
		issue,
		{
			status,
			closedAtMs: closing ? shared.nowMs : null,
			reopenCount: issue.status === "closed" ? issue.reopenCount + 1 : issue.reopenCount,
		},
		UpdateInboxIssue({
			organizationId: actor.organizationId,
			issueId: issue.id,
			actor: actor.userId,
			action: "status",
			status,
		}),
	)
	return closing || issue.status === "closed"
		? {
				...result,
				outMessage: toast(successToast(closing ? "Issue closed" : "Issue reopened", issue.title)),
			}
		: result
}

const setPriority = (
	model: Model,
	shared: Shared,
	issue: IssueRow,
	priority: Customers.IssuePriority,
): Return => {
	const actor = actorOf(shared)
	if (actor === undefined || priority === issue.priority) return { model }
	return act(
		model,
		shared,
		issue,
		{ priority },
		UpdateInboxIssue({
			organizationId: actor.organizationId,
			issueId: issue.id,
			actor: actor.userId,
			action: "priority",
			priority,
		}),
	)
}

/**
 * The channel the issue's root message is in, where its thread opens from the message. A channel the
 * person does not see (or a demo issue's stand-in) says so instead of opening a channel that never
 * loads; until the channels list answers, the channel opens.
 */
const openThread = (model: Model, shared: Shared, issue: IssueRow | undefined): Return => {
	if (issue === undefined) return { model }
	const isKnown =
		model.channels.length === 0 || model.channels.some((channel) => channel.id === issue.sourceChannelId)
	return isKnown
		? {
				model,
				outMessage: requestedOrgNavigation(shared.orgSlug, (orgSlug) =>
					AppRoute.ChatChannel({ orgSlug, channelId: issue.sourceChannelId }),
				),
			}
		: {
				model,
				outMessage: toast(
					errorToastOf({
						title: "Can't open this conversation",
						description: "Its channel isn't one you can see.",
					}),
				),
			}
}

const openCustomer = (model: Model, shared: Shared, issue: IssueRow | undefined): Return =>
	issue === undefined
		? { model }
		: {
				model,
				outMessage: requestedOrgNavigation(shared.orgSlug, (orgSlug) =>
					customerRoute(orgSlug, issue.accountId),
				),
			}

const ACTION_VERB = {
	assign: "assign",
	status: "change the status of",
	priority: "change the priority of",
} as const satisfies Record<IssueAction, string>

// MENUS

type MenuField = "assignMenu" | "statusMenu" | "priorityMenu" | "filterMenu"
type MenuCommands = NonNullable<ReturnType<typeof Menu.update>["commands"]>

const mapMenuCommands = (field: MenuField, commands: MenuCommands): Commands => {
	switch (field) {
		case "assignMenu":
			return Command.mapMessages(commands, (message) => Message.GotAssignMenuMessage({ message }))
		case "statusMenu":
			return Command.mapMessages(commands, (message) => Message.GotStatusMenuMessage({ message }))
		case "priorityMenu":
			return Command.mapMessages(commands, (message) => Message.GotPriorityMenuMessage({ message }))
		case "filterMenu":
			return Command.mapMessages(commands, (message) => Message.GotFilterMenuMessage({ message }))
	}
}

/** Folds a menu Message; a picked item runs `onSelect` on the updated Model. */
const updateMenu = (
	model: Model,
	field: MenuField,
	message: Menu.Message,
	onSelect: (model: Model, key: string) => Return,
): Return => {
	const result = Menu.update(model[field], message)
	const next: Model = { ...model, [field]: result.model }
	const menuCommands = mapMenuCommands(field, result.commands ?? [])
	const picked =
		result.outMessage?._tag === "SelectedItem" ? onSelect(next, result.outMessage.key) : { model: next }
	return { ...picked, commands: [...menuCommands, ...(picked.commands ?? [])] }
}

/** A shortcut opens a menu as its trigger's ArrowDown would: open, first item focused. */
const openMenu = (model: Model, field: MenuField, entries: ReadonlyArray<Menu.Entry>): Return =>
	updateMenu(model, field, Menu.Message.PressedTriggerKey({ key: "ArrowDown", entries }), (next) => ({
		model: next,
	}))

const onKey = (model: Model, shared: Shared, key: InboxKey): Return => {
	switch (key) {
		case "next":
			return move(model, shared, 1)
		case "previous":
			return move(model, shared, -1)
		case "deselect":
			return { model: select(model, null) }
		case "search":
			return { model, commands: [FocusInboxSearch()] }
		case "open":
			return withSelected(model, shared, (next, issue) => openThread(next, shared, issue))
		case "openCustomer":
			return withSelected(model, shared, (next, issue) => openCustomer(next, shared, issue))
		case "assign":
			return withSelected(model, shared, (next) =>
				openMenu(next, "assignMenu", assignEntries(next.members, viewerOf(shared))),
			)
		case "assignToMe":
			return withSelected(model, shared, (next, issue) => assign(next, shared, issue, ASSIGN_ME))
		case "status":
			return withSelected(model, shared, (next) => openMenu(next, "statusMenu", statusEntries))
		case "priority":
			return withSelected(model, shared, (next) => openMenu(next, "priorityMenu", priorityEntries))
		case "close":
			return withSelected(model, shared, (next, issue) =>
				setStatus(next, shared, issue, issue.status === "closed" ? "waiting_on_us" : "closed"),
			)
	}
}

const isStatus = (key: string): key is Customers.IssueStatus => key in STATUS_LABEL
const isPriority = (key: string): key is Customers.IssuePriority =>
	["none", "low", "medium", "high", "urgent"].includes(key)

// UPDATE

export const update = (model: Model, message: Message, shared: Shared): Return =>
	Message.match<Return>(message, {
		UpdatedIssues: ({ issues }) => ({ model: modifyFields(model, { issues: () => issues }) }),
		UpdatedAccounts: ({ accounts }) => ({ model: modifyFields(model, { accounts: () => accounts }) }),
		UpdatedChannels: ({ channels }) => ({ model: modifyFields(model, { channels: () => channels }) }),
		UpdatedMembers: ({ members }) => ({ model: modifyFields(model, { members: () => members }) }),

		ClickedTab: ({ tab }) => ({ model: modifyFields(model, { tab: () => tab, selectedId: () => null }) }),
		ChangedSearch: ({ value }) => ({ model: modifyFields(model, { search: () => value }) }),
		ClearedSearch: () => ({ model: modifyFields(model, { search: () => "" }) }),
		ClearedFilter: ({ field }) => ({
			model: modifyFields(model, { filters: (filters) => clearFilter(filters, field) }),
		}),
		PressedClearNarrowing: () => ({
			model: modifyFields(model, { search: () => "", filters: clearNarrowing }),
		}),
		PressedShowAllAssignees: () => ({
			model: modifyFields(model, { filters: (filters) => clearFilter(filters, "assignee") }),
		}),

		ClickedRow: ({ issueId }) =>
			model.selectedId === issueId
				? openThread(model, shared, issueById(model, issueId))
				: { model: select(model, issueId) },
		ClickedRowActions: () => ({ model }),
		PressedInboxKey: ({ key }) => onKey(model, shared, key),

		GotAssignMenuMessage: ({ message: menuMessage }) =>
			updateMenu(model, "assignMenu", menuMessage, (next, key) => {
				const issue = selectedIssue(next)
				return issue === undefined ? { model: next } : assign(next, shared, issue, key)
			}),
		GotStatusMenuMessage: ({ message: menuMessage }) =>
			updateMenu(model, "statusMenu", menuMessage, (next, key) => {
				const issue = selectedIssue(next)
				return issue === undefined || !isStatus(key)
					? { model: next }
					: setStatus(next, shared, issue, key)
			}),
		GotPriorityMenuMessage: ({ message: menuMessage }) =>
			updateMenu(model, "priorityMenu", menuMessage, (next, key) => {
				const issue = selectedIssue(next)
				return issue === undefined || !isPriority(key)
					? { model: next }
					: setPriority(next, shared, issue, key)
			}),
		GotFilterMenuMessage: ({ message: menuMessage }) =>
			updateMenu(model, "filterMenu", menuMessage, (next, key) => ({
				model: modifyFields(next, { filters: (filters) => toggleFilter(filters, key) }),
			})),

		SucceededIssueAction: () => ({ model }),
		FailedIssueAction: ({ action, reason }) => ({
			model,
			outMessage: toast(
				errorToastOf(
					failureMessage(reason, {
						NotFound: {
							title: `Couldn't ${ACTION_VERB[action]} the issue`,
							description: "It was removed in the meantime.",
						},
						Stale: {
							title: `Couldn't ${ACTION_VERB[action]} the issue`,
							description: "That person is no longer in the organization.",
						},
					}),
				),
			),
		}),
		CompletedFocusSearch: () => ({ model }),
		CompletedScrollRow: () => ({ model }),
	})
