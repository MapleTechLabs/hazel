import type { CustomerSignalId } from "@hazel/schema"
import { Command } from "foldkit"
import * as AsyncData from "foldkit/asyncData"
import { modifyFields } from "foldkit/struct"
import { failureMessage } from "~/lib/error-messages"
import type { SignalRow } from "../../../customers/queries"
import { errorToastOf, successToast } from "../../../data/actions"
import { customerRoute } from "../../../route"
import * as Menu from "../../../ui/menu"
import * as Modal from "../../../ui/modal"
import { PICK_DATE_KEY } from "../../../customers/ui/menus"
import type { PageReturn, Shared } from "../../contract"
import { PageOutMessage, requestedOrgNavigation } from "../../out-message"
import {
	AssignSignal,
	CopyAttentionEmail,
	DismissSignal,
	FetchAccountDetail,
	FocusAttentionSearch,
	MarkSignalDone,
	ReopenSignal,
	SnoozeSignal,
} from "./commands"
import { Message, type SignalAction } from "./message"
import {
	ASSIGN_ME,
	ASSIGN_MENU_ID,
	ASSIGN_NONE,
	areActionsShown,
	assignEntries,
	canReopen,
	clearFilter,
	DEFAULT_FILTERS,
	DONE_MODAL_ID,
	FILTER_MENU_ID,
	isSelectionVisible,
	MORE_MENU_ID,
	type Model,
	type QueueKey,
	rowIds,
	selectedSignal,
	signalById,
	isSnoozeOption,
	localDateOf,
	pickedSnoozeMs,
	SNOOZE_DATE_MODAL_ID,
	SNOOZE_MENU_ID,
	snoozeEntries,
	snoozeUntilMs,
	SORT_MENU_ID,
	Sort,
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
		grouping: "signals",
		sort: "priority",
		filters: DEFAULT_FILTERS,
		search: "",
		signals: null,
		accounts: null,
		members: [],
		lastComputedAtMs: null,
		selectedId: null,
		isPreviewOpen: false,
		detail: null,
		assignMenu: Menu.init({ id: ASSIGN_MENU_ID, placement: "bottom end" }),
		snoozeMenu: Menu.init({ id: SNOOZE_MENU_ID, placement: "bottom end" }),
		moreMenu: Menu.init({ id: MORE_MENU_ID, placement: "bottom end" }),
		filterMenu: Menu.init({ id: FILTER_MENU_ID }),
		sortMenu: Menu.init({ id: SORT_MENU_ID, placement: "bottom end", selectionMode: "Single" }),
		doneModal: Modal.init(DONE_MODAL_ID),
		doneForm: null,
		snoozeDateModal: Modal.init(SNOOZE_DATE_MODAL_ID),
		snoozeDateForm: null,
	},
})

// SELECTION AND PREVIEW

/** Loads the selected account's detail for the open preview, unless it is already the one shown. */
const withDetail = (model: Model, shared: Shared): Return => {
	const signal = selectedSignal(model)
	const organizationId = shared.organization?.id
	if (!model.isPreviewOpen || signal === undefined || organizationId === undefined) return { model }
	if (model.detail !== null && model.detail.accountId === signal.accountId) return { model }
	return {
		model: modifyFields(model, {
			detail: () => ({ accountId: signal.accountId, data: AsyncData.Loading() }),
		}),
		commands: [FetchAccountDetail({ organizationId, accountId: signal.accountId })],
	}
}

const select = (model: Model, shared: Shared, signalId: CustomerSignalId | null): Return =>
	withDetail(modifyFields(model, { selectedId: () => signalId }), shared)

/** j / k: the next or previous row; from no selection, the first row. */
const move = (model: Model, shared: Shared, step: 1 | -1): Return => {
	const ids = rowIds(model, viewerOf(shared))
	if (ids.length === 0) return { model }
	const index = model.selectedId === null ? -1 : ids.indexOf(model.selectedId)
	const next = index < 0 ? 0 : Math.min(ids.length - 1, Math.max(0, index + step))
	return select(model, shared, ids[next] ?? null)
}

/** The selection, or the first row when there is none (an action key on an unselected queue). */
const ensureSelection = (model: Model, shared: Shared): Return => {
	if (isSelectionVisible(model, viewerOf(shared))) return { model }
	const first = rowIds(model, viewerOf(shared))[0]
	return first === undefined ? { model } : select(model, shared, first)
}

const togglePreview = (model: Model, shared: Shared): Return =>
	model.isPreviewOpen
		? { model: modifyFields(model, { isPreviewOpen: () => false }) }
		: then(ensureSelection(modifyFields(model, { isPreviewOpen: () => true }), shared), (next) =>
				withDetail(next, shared),
			)

/** Runs `step` on a Return's Model and keeps both steps' Commands. */
const then = (first: Return, step: (model: Model) => Return): Return => {
	const second = step(first.model)
	return {
		...second,
		commands: [...(first.commands ?? []), ...(second.commands ?? [])],
		outMessage: second.outMessage ?? first.outMessage,
	}
}

// ACTIONS

const toast = (request: Parameters<typeof PageOutMessage.RequestedToast>[0]["toast"]) =>
	PageOutMessage.RequestedToast({ toast: request })

const patchSignal = (
	model: Model,
	signalId: CustomerSignalId,
	patch: (signal: SignalRow) => SignalRow,
): Model =>
	modifyFields(model, {
		signals: (signals) =>
			signals?.map((signal) => (signal.id === signalId ? patch(signal) : signal)) ?? null,
	})

/**
 * Applies an action to the row at once (the collection confirms or rolls it back) and, when the row
 * leaves the tab, selects its neighbour so the keyboard keeps going.
 */
const act = (
	model: Model,
	shared: Shared,
	signal: SignalRow,
	patch: (signal: SignalRow) => SignalRow,
	command: Commands[number],
): Return => {
	const viewer = viewerOf(shared)
	const before = rowIds(model, viewer)
	const patched = patchSignal(model, signal.id, patch)
	const after = rowIds(patched, viewer)
	const index = before.indexOf(signal.id)
	const stays = after.includes(signal.id)
	const neighbour = stays ? signal.id : (after[Math.min(index, after.length - 1)] ?? null)
	const next = model.selectedId === signal.id ? select(patched, shared, neighbour) : { model: patched }
	return { ...next, commands: [...(next.commands ?? []), command] }
}

const actorOf = (shared: Shared) => {
	const organizationId = shared.organization?.id
	const userId = shared.currentUser?.id
	return organizationId === undefined || userId === undefined ? undefined : { organizationId, userId }
}

const assign = (model: Model, shared: Shared, signal: SignalRow, key: string): Return => {
	const actor = actorOf(shared)
	if (actor === undefined) return { model }
	const assigneeUserId =
		key === ASSIGN_ME
			? actor.userId
			: key === ASSIGN_NONE
				? null
				: (model.members.find((member) => member.id === userIdOfAssignKey(key))?.id ?? undefined)
	if (assigneeUserId === undefined) return { model }
	return act(
		model,
		shared,
		signal,
		(row) => ({ ...row, assigneeUserId }),
		AssignSignal({ organizationId: actor.organizationId, signalId: signal.id, assigneeUserId }),
	)
}

const snooze = (model: Model, shared: Shared, signal: SignalRow, untilMs: number): Return => {
	const actor = actorOf(shared)
	if (actor === undefined) return { model }
	return act(
		model,
		shared,
		signal,
		(row) => ({
			...row,
			status: "snoozed",
			snoozedUntilMs: untilMs,
			snoozedByUserId: actor.userId,
			snoozedAtMs: shared.nowMs,
		}),
		SnoozeSignal({ ...actor, signalId: signal.id, untilMs }),
	)
}

const dismiss = (model: Model, shared: Shared, signal: SignalRow): Return => {
	const actor = actorOf(shared)
	if (actor === undefined || signal.status !== "open") return { model }
	return act(
		model,
		shared,
		signal,
		(row) => ({
			...row,
			status: "dismissed",
			resolvedAtMs: shared.nowMs,
			resolvedByUserId: actor.userId,
		}),
		DismissSignal({ ...actor, signalId: signal.id }),
	)
}

const reopen = (model: Model, shared: Shared, signal: SignalRow): Return => {
	const organizationId = shared.organization?.id
	if (organizationId === undefined || !canReopen(signal)) return { model }
	return act(
		model,
		shared,
		signal,
		(row) => ({
			...row,
			status: "open",
			snoozedUntilMs: null,
			resolvedAtMs: null,
			resolvedByUserId: null,
			outcome: null,
			resolutionNote: null,
			dismissReason: null,
			closedAtMs: null,
		}),
		ReopenSignal({ organizationId, signalId: signal.id }),
	)
}

const isActionable = (signal: SignalRow) => signal.status === "open" || signal.status === "snoozed"

const openDoneDialog = (model: Model, signal: SignalRow): Return =>
	isActionable(signal)
		? {
				model: modifyFields(model, {
					doneForm: () => ({ signalId: signal.id, outcome: "contacted", note: "" }),
					doneModal: (modal) => Modal.open(modal).model,
				}),
			}
		: { model }

const submitDone = (model: Model, shared: Shared): Return => {
	const form = model.doneForm
	const signal = signalById(model, form?.signalId ?? null)
	const actor = actorOf(shared)
	const closed = modifyFields(model, {
		doneForm: () => null,
		doneModal: (modal) => Modal.close(modal).model,
	})
	if (form === null || signal === undefined || actor === undefined) return { model: closed }
	return act(
		closed,
		shared,
		signal,
		(row) => ({
			...row,
			status: "done",
			outcome: form.outcome,
			resolutionNote: form.note.trim() === "" ? null : form.note.trim(),
			resolvedAtMs: shared.nowMs,
			resolvedByUserId: actor.userId,
		}),
		MarkSignalDone({ ...actor, signalId: signal.id, outcome: form.outcome, note: form.note }),
	)
}

const openSnoozeDate = (model: Model, shared: Shared, signal: SignalRow): Return => ({
	model: modifyFields(model, {
		snoozeDateForm: () => ({ signalId: signal.id, date: localDateOf(shared.nowMs, 1) }),
		snoozeDateModal: (modal) => Modal.open(modal).model,
	}),
})

const submitSnoozeDate = (model: Model, shared: Shared): Return => {
	const form = model.snoozeDateForm
	const signal = signalById(model, form?.signalId ?? null)
	const untilMs = form === null ? null : pickedSnoozeMs(form.date, shared.nowMs)
	if (signal === undefined || untilMs === null) return { model }
	return snooze(
		modifyFields(model, {
			snoozeDateForm: () => null,
			snoozeDateModal: (modal) => Modal.close(modal).model,
		}),
		shared,
		signal,
		untilMs,
	)
}

/** A page-local modal's Messages; closing it from inside drops its form. */
const updateModal = (
	model: Model,
	field: "doneModal" | "snoozeDateModal",
	message: Modal.Message,
	toMessage: (message: Modal.Message) => Message,
): Return => {
	const result = Modal.update(model[field], message)
	const isClosed = result.outMessage?._tag === "Closed"
	const next =
		field === "doneModal"
			? modifyFields(model, {
					doneModal: () => result.model,
					doneForm: (form) => (isClosed ? null : form),
				})
			: modifyFields(model, {
					snoozeDateModal: () => result.model,
					snoozeDateForm: (form) => (isClosed ? null : form),
				})
	return { model: next, commands: Command.mapMessages(result.commands ?? [], toMessage) }
}

const openCustomer = (model: Model, shared: Shared, signal: SignalRow | undefined): Return =>
	signal === undefined
		? { model }
		: {
				model,
				outMessage: requestedOrgNavigation(shared.orgSlug, (orgSlug) =>
					customerRoute(orgSlug, signal.accountId),
				),
			}

const ACTION_VERB = {
	assign: "assign",
	snooze: "snooze",
	done: "mark done",
	dismiss: "dismiss",
	reopen: "reopen",
} as const satisfies Record<SignalAction, string>

// MENUS

type MenuField = "assignMenu" | "snoozeMenu" | "moreMenu" | "filterMenu" | "sortMenu"

type MenuCommands = NonNullable<ReturnType<typeof Menu.update>["commands"]>

const mapMenuCommands = (field: MenuField, commands: MenuCommands): Commands => {
	switch (field) {
		case "assignMenu":
			return Command.mapMessages(commands, (message) => Message.GotAssignMenuMessage({ message }))
		case "snoozeMenu":
			return Command.mapMessages(commands, (message) => Message.GotSnoozeMenuMessage({ message }))
		case "moreMenu":
			return Command.mapMessages(commands, (message) => Message.GotMoreMenuMessage({ message }))
		case "filterMenu":
			return Command.mapMessages(commands, (message) => Message.GotFilterMenuMessage({ message }))
		case "sortMenu":
			return Command.mapMessages(commands, (message) => Message.GotSortMenuMessage({ message }))
	}
}

const withMenu = (model: Model, field: MenuField, menu: Menu.Model): Model => {
	switch (field) {
		case "assignMenu":
			return modifyFields(model, { assignMenu: () => menu })
		case "snoozeMenu":
			return modifyFields(model, { snoozeMenu: () => menu })
		case "moreMenu":
			return modifyFields(model, { moreMenu: () => menu })
		case "filterMenu":
			return modifyFields(model, { filterMenu: () => menu })
		case "sortMenu":
			return modifyFields(model, { sortMenu: () => menu })
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
	const next = withMenu(model, field, result.model)
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

const withSelected = (
	model: Model,
	shared: Shared,
	run: (model: Model, signal: SignalRow) => Return,
): Return =>
	then(ensureSelection(model, shared), (next) => {
		const signal = selectedSignal(next)
		return signal === undefined ? { model: next } : run(next, signal)
	})

const onKey = (model: Model, shared: Shared, key: QueueKey): Return => {
	const viewer = viewerOf(shared)
	switch (key) {
		case "next":
			return move(model, shared, 1)
		case "previous":
			return move(model, shared, -1)
		case "preview":
			return togglePreview(model, shared)
		case "close":
			return model.isPreviewOpen
				? { model: modifyFields(model, { isPreviewOpen: () => false }) }
				: { model: modifyFields(model, { selectedId: () => null }) }
		case "open":
			return openCustomer(model, shared, selectedSignal(model))
		case "search":
			return { model, commands: [FocusAttentionSearch()] }
		// Only a menu whose button is on screen opens: Assign on the open tab, Snooze on open and snoozed.
		case "assign":
			return model.tab !== "open"
				? { model }
				: withSelected(model, shared, (next) =>
						areActionsShown(next, viewer)
							? openMenu(next, "assignMenu", assignEntries(next.members, viewer))
							: { model: next },
					)
		case "snooze":
			return model.tab === "done"
				? { model }
				: withSelected(model, shared, (next, signal) =>
						areActionsShown(next, viewer)
							? openMenu(next, "snoozeMenu", snoozeEntries(signal))
							: { model: next },
					)
		case "done":
			return withSelected(model, shared, openDoneDialog)
		case "dismiss":
			return withSelected(model, shared, (next, signal) => dismiss(next, shared, signal))
		case "reopen":
			return withSelected(model, shared, (next, signal) => reopen(next, shared, signal))
	}
}

// UPDATE

export const update = (model: Model, message: Message, shared: Shared): Return =>
	Message.match<Return>(message, {
		UpdatedSignals: ({ signals }) => ({ model: modifyFields(model, { signals: () => signals }) }),
		UpdatedAccounts: ({ accounts }) => ({ model: modifyFields(model, { accounts: () => accounts }) }),
		UpdatedMembers: ({ members }) => ({ model: modifyFields(model, { members: () => members }) }),
		UpdatedLastComputedAt: ({ lastComputedAtMs }) => ({
			model: modifyFields(model, { lastComputedAtMs: () => lastComputedAtMs }),
		}),

		ClickedTab: ({ tab }) => ({
			model: modifyFields(model, {
				tab: () => tab,
				selectedId: () => null,
				isPreviewOpen: () => false,
			}),
		}),
		ClickedGrouping: ({ grouping }) => ({ model: modifyFields(model, { grouping: () => grouping }) }),
		ChangedSearch: ({ value }) => ({ model: modifyFields(model, { search: () => value }) }),
		ClearedSearch: () => ({ model: modifyFields(model, { search: () => "" }) }),
		ClearedFilter: ({ field }) => ({
			model: modifyFields(model, {
				filters: (filters) => clearFilter(filters, field),
			}),
		}),
		PressedShowAllOwners: () => ({
			model: modifyFields(model, { filters: (filters) => clearFilter(filters, "owner") }),
		}),

		ClickedRow: ({ signalId }) =>
			select(modifyFields(model, { isPreviewOpen: () => true }), shared, signalId),
		ClickedRowActions: () => ({ model }),
		ClosedPreview: () => ({ model: modifyFields(model, { isPreviewOpen: () => false }) }),
		PressedQueueKey: ({ key }) => onKey(model, shared, key),
		PressedOpenCustomer: ({ accountId }) => ({
			model,
			outMessage: requestedOrgNavigation(shared.orgSlug, (orgSlug) =>
				customerRoute(orgSlug, accountId),
			),
		}),
		PressedMarkDone: ({ signalId }) => {
			const signal = signalById(model, signalId)
			return signal === undefined ? { model } : openDoneDialog(model, signal)
		},
		PressedReopen: ({ signalId }) => {
			const signal = signalById(model, signalId)
			return signal === undefined ? { model } : reopen(model, shared, signal)
		},

		GotAssignMenuMessage: ({ message: menuMessage }) =>
			updateMenu(model, "assignMenu", menuMessage, (next, key) => {
				const signal = selectedSignal(next)
				return signal === undefined ? { model: next } : assign(next, shared, signal, key)
			}),
		GotSnoozeMenuMessage: ({ message: menuMessage }) =>
			updateMenu(model, "snoozeMenu", menuMessage, (next, key) => {
				const signal = selectedSignal(next)
				if (signal === undefined) return { model: next }
				if (key === PICK_DATE_KEY) return openSnoozeDate(next, shared, signal)
				return isSnoozeOption(key)
					? snooze(next, shared, signal, snoozeUntilMs(key, shared.nowMs, signal))
					: { model: next }
			}),
		GotMoreMenuMessage: ({ message: menuMessage }) =>
			updateMenu(model, "moreMenu", menuMessage, (next, key) => {
				const signal = selectedSignal(next)
				if (signal === undefined) return { model: next }
				return key === "dismiss" ? dismiss(next, shared, signal) : openCustomer(next, shared, signal)
			}),
		GotFilterMenuMessage: ({ message: menuMessage }) =>
			updateMenu(model, "filterMenu", menuMessage, (next, key) => ({
				model: modifyFields(next, { filters: (filters) => toggleFilter(filters, key) }),
			})),
		GotSortMenuMessage: ({ message: menuMessage }) =>
			updateMenu(model, "sortMenu", menuMessage, (next, key) => {
				const sort = Sort.literals.find((literal) => literal === key)
				return sort === undefined
					? { model: next }
					: {
							model: modifyFields(next, {
								sort: () => sort,
								sortMenu: (menu) => modifyFields(menu, { selectedKeys: () => [sort] }),
							}),
						}
			}),

		GotDoneModalMessage: ({ message: modalMessage }) =>
			updateModal(model, "doneModal", modalMessage, (child) =>
				Message.GotDoneModalMessage({ message: child }),
			),
		ChangedDoneOutcome: ({ outcome }) => ({
			model: modifyFields(model, { doneForm: (form) => (form === null ? null : { ...form, outcome }) }),
		}),
		ChangedDoneNote: ({ value }) => ({
			model: modifyFields(model, {
				doneForm: (form) => (form === null ? null : { ...form, note: value }),
			}),
		}),
		SubmittedDone: () => submitDone(model, shared),

		GotSnoozeDateModalMessage: ({ message: modalMessage }) =>
			updateModal(model, "snoozeDateModal", modalMessage, (child) =>
				Message.GotSnoozeDateModalMessage({ message: child }),
			),
		ChangedSnoozeDate: ({ value }) => ({
			model: modifyFields(model, {
				snoozeDateForm: (form) => (form === null ? null : { ...form, date: value }),
			}),
		}),
		SubmittedSnoozeDate: () => submitSnoozeDate(model, shared),

		SucceededSignalAction: () => ({ model }),
		FailedSignalAction: ({ action, reason }) => ({
			model,
			outMessage: toast(
				errorToastOf(
					failureMessage(reason, {
						NotFound: {
							title: `Couldn't ${ACTION_VERB[action]} the signal`,
							description: "It was resolved or removed in the meantime.",
						},
						Stale: {
							title: `Couldn't ${ACTION_VERB[action]} the signal`,
							description: "Someone else acted on it first.",
						},
					}),
				),
			),
		}),

		SucceededFetchDetail: ({ accountId, detail }) => ({
			model: modifyFields(model, {
				detail: (current) =>
					current !== null && current.accountId === accountId
						? { accountId, data: AsyncData.Success({ data: detail }) }
						: current,
			}),
		}),
		FailedFetchDetail: ({ accountId, reason }) => ({
			model: modifyFields(model, {
				detail: (current) =>
					current !== null && current.accountId === accountId
						? { accountId, data: AsyncData.Failure({ error: reason }) }
						: current,
			}),
		}),

		PressedRetryDetail: () => withDetail(modifyFields(model, { detail: () => null }), shared),
		PressedCopyEmail: ({ email }) => ({ model, commands: [CopyAttentionEmail({ email })] }),
		SucceededCopyEmail: ({ email }) => ({
			model,
			outMessage: toast(successToast("Email copied", email)),
		}),
		FailedCopyEmail: () => ({
			model,
			outMessage: toast(errorToastOf({ title: "Couldn't copy the email" })),
		}),
		CompletedFocusSearch: () => ({ model }),
		CompletedScrollRow: () => ({ model }),
	})
