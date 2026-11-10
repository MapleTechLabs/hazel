import * as Customers from "@hazel/domain/customers"
import type { CustomerNoteId, CustomerSignalId } from "@hazel/schema"
import { Popover as PopoverControl } from "@foldkit/ui"
import { Option, Result } from "effect"
import { Command } from "foldkit"
import * as AsyncData from "foldkit/asyncData"
import { modifyFields } from "foldkit/struct"
import { failureMessage } from "~/lib/error-messages"
import type { AccountRow, SignalRow } from "../../../customers/queries"
import { errorToastOf, successToast } from "../../../data/actions"
import { AppRoute, type CustomerTab, customerRoute, hrefOf, type RouteOf } from "../../../route"
import * as Menu from "../../../ui/menu"
import * as Modal from "../../../ui/modal"
import * as Popover from "../../../ui/popover"
import type { PageReturn, Shared } from "../../contract"
import { PageOutMessage, requestedOrgNavigation } from "../../out-message"
import {
	AssignCustomerSignal,
	CopyCustomerText,
	CreateCustomerNote,
	DeleteCustomerNote,
	DismissCustomerSignal,
	FetchCustomerContacts,
	FetchCustomerDetail,
	FetchCustomerEvents,
	FetchCustomerInvoices,
	FetchCustomerMrrHistory,
	FetchCustomerUsage,
	FocusNoteComposer,
	MarkCustomerSignalDone,
	SnoozeCustomerSignal,
	UpdateCustomerAccount,
	UpdateCustomerNote,
} from "./commands"
import { Message, type NoteAction, type SignalAction } from "./message"
import {
	ACTIONS_MENU_ID,
	accountOf,
	ASSIGN_ME,
	ActionKey,
	DISMISS,
	DONE_MENU_ID,
	doneEntries,
	EMPTY_PAGE,
	EVENT_TYPE_MENU_ID,
	EVENT_TYPE_PREFIXES,
	EventType,
	METRIC_MENU_ID,
	type Model,
	type NoteRow,
	OPEN_QUEUE,
	OWNER_MENU_ID,
	OWNER_NONE,
	ownerEntries,
	positionOf,
	RAW_MODAL_ID,
	SIGNAL_MORE_MENU_ID,
	type SignalMenu,
	SNOOZE_DAYS,
	SNOOZE_MENU_ID,
	signalMoreEntries,
	snoozeEntries,
	TAG_POPOVER_ID,
	UNASSIGN,
	userIdOfOwnerKey,
} from "./model"

type Return = PageReturn<Model, Message>
type Commands = NonNullable<Return["commands"]>
type Route = RouteOf<"CustomerDetail">

const toast = (request: Parameters<typeof PageOutMessage.RequestedToast>[0]["toast"]) =>
	PageOutMessage.RequestedToast({ toast: request })

/** Runs `step` on a Return's Model and keeps both steps' Commands. */
const then = (first: Return, step: (model: Model) => Return): Return => {
	const second = step(first.model)
	return {
		...second,
		commands: [...(first.commands ?? []), ...(second.commands ?? [])],
		outMessage: second.outMessage ?? first.outMessage,
	}
}

const tabOf = (route: Route): CustomerTab => Option.getOrElse(route.tab, () => "overview" as const)

// LOADING

const target = (model: Model, shared: Shared) =>
	shared.organization === null
		? null
		: { organizationId: shared.organization.id, accountId: model.accountId }

const eventFilterOf = (model: Model) => `${model.eventProvider ?? "all"}:${model.eventType}`

const fetchEvents = (model: Model, shared: Shared, cursor: string | null): Return => {
	const args = target(model, shared)
	if (args === null) return { model }
	return {
		model: modifyFields(model, { events: (events) => modifyFields(events, { status: () => "Loading" }) }),
		commands: [
			FetchCustomerEvents({
				...args,
				filter: eventFilterOf(model),
				providers: model.eventProvider === null ? [] : [model.eventProvider],
				types: EVENT_TYPE_PREFIXES[model.eventType],
				cursor,
			}),
		],
	}
}

const fetchUsage = (model: Model, shared: Shared): Return => {
	const args = target(model, shared)
	if (args === null) return { model }
	return {
		model: modifyFields(model, {
			usage: (usage) => Option.getOrElse(AsyncData.revalidateOrLoad(usage), () => usage),
			hoveredUsage: () => null,
		}),
		commands: [FetchCustomerUsage({ ...args, metricKey: model.usageMetric, range: model.usageRange })],
	}
}

/** What the tab needs that has not been asked for yet; the detail always. */
const load = (model: Model, shared: Shared): Return => {
	const args = target(model, shared)
	if (args === null) return { model }
	const commands: Array<Commands[number]> = []
	let next = model
	if (AsyncData.isIdle(next.detail)) {
		next = modifyFields(next, { detail: () => AsyncData.Loading() })
		commands.push(FetchCustomerDetail(args))
	}
	if (next.tab === "overview" && AsyncData.isIdle(next.usage)) {
		const fetched = fetchUsage(next, shared)
		next = fetched.model
		commands.push(...(fetched.commands ?? []))
	}
	if (next.tab === "users" && next.contacts.status === "Idle") {
		next = modifyFields(next, {
			contacts: (contacts) => modifyFields(contacts, { status: () => "Loading" }),
		})
		commands.push(FetchCustomerContacts({ ...args, cursor: null }))
	}
	if (next.tab === "billing") {
		if (next.invoices.status === "Idle") {
			next = modifyFields(next, {
				invoices: (invoices) => modifyFields(invoices, { status: () => "Loading" }),
			})
			commands.push(FetchCustomerInvoices({ ...args, cursor: null }))
		}
		if (AsyncData.isIdle(next.mrrHistory)) {
			next = modifyFields(next, { mrrHistory: () => AsyncData.Loading() })
			commands.push(FetchCustomerMrrHistory(args))
		}
	}
	if (next.tab === "activity" && next.events.status === "Idle") {
		const fetched = fetchEvents(next, shared, null)
		next = fetched.model
		commands.push(...(fetched.commands ?? []))
	}
	return { model: next, commands }
}

// INIT

export const init = (route: Route, shared: Shared): Return =>
	load(
		{
			accountId: route.accountId,
			tab: tabOf(route),
			accounts: null,
			signals: null,
			notes: null,
			members: [],
			metrics: [],
			connectedProviders: [],
			bands: Customers.DEFAULT_HEALTH_SETTINGS.bands,
			detail: AsyncData.Idle(),
			usageMetric: "active_users",
			usageRange: "30d",
			usage: AsyncData.Idle(),
			hoveredUsage: null,
			mrrHistory: AsyncData.Idle(),
			hoveredMrr: null,
			contacts: EMPTY_PAGE,
			contactFilter: "all",
			contactSearch: "",
			invoices: EMPTY_PAGE,
			events: EMPTY_PAGE,
			eventProvider: null,
			eventType: "all",
			composer: { body: "", pinned: false },
			editingNote: null,
			isSidebarOpen: true,
			ownerMenu: Menu.init({ id: OWNER_MENU_ID }),
			actionsMenu: Menu.init({ id: ACTIONS_MENU_ID, placement: "bottom end" }),
			metricMenu: Menu.init({ id: METRIC_MENU_ID, placement: "bottom end", selectionMode: "Single" }),
			eventTypeMenu: Menu.init({ id: EVENT_TYPE_MENU_ID, selectionMode: "Single" }),
			activeSignalId: null,
			snoozeMenu: Menu.init({ id: SNOOZE_MENU_ID }),
			doneMenu: Menu.init({ id: DONE_MENU_ID }),
			signalMoreMenu: Menu.init({ id: SIGNAL_MORE_MENU_ID, placement: "bottom end" }),
			tagPopover: Popover.init(TAG_POPOVER_ID),
			tagInput: "",
			rawModal: Modal.init(RAW_MODAL_ID),
		},
		shared,
	)

/** Another tab of the same customer. */
export const routeChanged = (model: Model, route: Route, shared: Shared): Return =>
	load(modifyFields(model, { tab: () => tabOf(route), editingNote: () => null }), shared)

/** The organization arrived after the page opened. */
export const sharedChanged = (model: Model, shared: Shared): Return => load(model, shared)

const navigateToTab = (model: Model, shared: Shared, tab: CustomerTab): Return => ({
	model,
	outMessage: requestedOrgNavigation(shared.orgSlug, (orgSlug) =>
		customerRoute(orgSlug, model.accountId, tab === "overview" ? null : tab),
	),
})

// MENUS

type MenuField =
	| "ownerMenu"
	| "actionsMenu"
	| "metricMenu"
	| "eventTypeMenu"
	| "snoozeMenu"
	| "doneMenu"
	| "signalMoreMenu"
type MenuCommands = NonNullable<ReturnType<typeof Menu.update>["commands"]>

const MENU_MESSAGE = {
	ownerMenu: (message: Menu.Message) => Message.GotOwnerMenuMessage({ message }),
	actionsMenu: (message: Menu.Message) => Message.GotActionsMenuMessage({ message }),
	metricMenu: (message: Menu.Message) => Message.GotMetricMenuMessage({ message }),
	eventTypeMenu: (message: Menu.Message) => Message.GotEventTypeMenuMessage({ message }),
	snoozeMenu: (message: Menu.Message) => Message.GotSnoozeMenuMessage({ message }),
	doneMenu: (message: Menu.Message) => Message.GotDoneMenuMessage({ message }),
	signalMoreMenu: (message: Menu.Message) => Message.GotSignalMoreMenuMessage({ message }),
} as const satisfies Record<MenuField, (message: Menu.Message) => Message>

const mapMenuCommands = (field: MenuField, commands: MenuCommands): Commands => {
	const toMessage: (message: Menu.Message) => Message = MENU_MESSAGE[field]
	return Command.mapMessages(commands, toMessage)
}

const updateMenu = (
	model: Model,
	field: MenuField,
	message: Menu.Message,
	onSelect: (model: Model, key: string) => Return,
): Return => {
	const result = Menu.update(model[field], message)
	const next: Model = { ...model, [field]: result.model }
	const picked =
		result.outMessage?._tag === "SelectedItem" ? onSelect(next, result.outMessage.key) : { model: next }
	return {
		...picked,
		commands: [...mapMenuCommands(field, result.commands ?? []), ...(picked.commands ?? [])],
	}
}

/** Opens a menu as its trigger's ArrowDown would: open, first item focused. */
const openMenu = (model: Model, field: MenuField, entries: ReadonlyArray<Menu.Entry>): Return =>
	updateMenu(model, field, Menu.Message.PressedTriggerKey({ key: "ArrowDown", entries }), (next) => ({
		model: next,
	}))

// ACCOUNT

const patchAccount = (model: Model, patch: (account: AccountRow) => AccountRow): Model =>
	modifyFields(model, {
		accounts: (accounts) =>
			accounts?.map((account) => (account.id === model.accountId ? patch(account) : account)) ?? null,
	})

const setOwner = (model: Model, shared: Shared, key: string): Return => {
	const args = target(model, shared)
	const member = model.members.find((entry) => entry.id === userIdOfOwnerKey(key))
	const ownerUserId = key === OWNER_NONE ? null : (member?.id ?? undefined)
	if (args === null || ownerUserId === undefined) return { model }
	return {
		model: patchAccount(model, (account) => ({ ...account, ownerUserId })),
		commands: [UpdateCustomerAccount({ ...args, ownerUserId })],
	}
}

const setTags = (model: Model, shared: Shared, tags: ReadonlyArray<string>): Return => {
	const args = target(model, shared)
	if (args === null) return { model }
	return {
		model: patchAccount(model, (account) => ({ ...account, tags })),
		commands: [UpdateCustomerAccount({ ...args, tags })],
	}
}

const onAction = (model: Model, shared: Shared, key: string): Return => {
	switch (ActionKey.literals.find((literal) => literal === key)) {
		case "copy_link":
			return {
				model,
				commands: [
					CopyCustomerText({
						text: hrefOf(customerRoute(shared.orgSlug ?? "", model.accountId)),
						label: "Link",
					}),
				],
			}
		case "change_owner":
			return openMenu(model, "ownerMenu", ownerEntries(model.members))
		case "raw_data":
			return { model: modifyFields(model, { rawModal: (modal) => Modal.open(modal).model }) }
		default:
			return { model }
	}
}

// SIGNALS

const patchSignal = (
	model: Model,
	signalId: CustomerSignalId,
	patch: (signal: SignalRow) => SignalRow,
): Model =>
	modifyFields(model, {
		signals: (signals) =>
			signals?.map((signal) => (signal.id === signalId ? patch(signal) : signal)) ?? null,
	})

const activeSignal = (model: Model): SignalRow | undefined =>
	model.signals?.find((signal) => signal.id === model.activeSignalId)

const SIGNAL_MENU = {
	snooze: ["snoozeMenu", snoozeEntries],
	done: ["doneMenu", doneEntries],
	more: ["signalMoreMenu", signalMoreEntries],
} as const satisfies Record<SignalMenu, readonly [MenuField, ReadonlyArray<Menu.Entry>]>

/** A day `days` from now at 9:00 local, the queue's snooze hour. */
const snoozeMs = (nowMs: number, days: number) => {
	const date = new Date(nowMs)
	date.setDate(date.getDate() + days)
	date.setHours(9, 0, 0, 0)
	return date.getTime()
}

const onSignalMenu = (model: Model, shared: Shared, menu: SignalMenu, key: string): Return => {
	const signal = activeSignal(model)
	const organizationId = shared.organization?.id
	const userId = shared.currentUser?.id
	if (signal === undefined || organizationId === undefined || userId === undefined) return { model }
	const actor = { organizationId, signalId: signal.id }
	if (menu === "snooze") {
		const days = Object.entries(SNOOZE_DAYS).find(([snoozeKey]) => snoozeKey === key)?.[1]
		if (days === undefined) return { model }
		const untilMs = snoozeMs(shared.nowMs, days)
		return {
			model: patchSignal(model, signal.id, (row) => ({
				...row,
				status: "snoozed",
				snoozedUntilMs: untilMs,
				snoozedAtMs: shared.nowMs,
				snoozedByUserId: userId,
			})),
			commands: [SnoozeCustomerSignal({ ...actor, userId, untilMs })],
		}
	}
	if (menu === "done") {
		const outcome = Customers.SignalOutcome.literals.find((literal) => literal === key)
		if (outcome === undefined) return { model }
		return {
			model: patchSignal(model, signal.id, (row) => ({
				...row,
				status: "done",
				outcome,
				resolvedAtMs: shared.nowMs,
				resolvedByUserId: userId,
			})),
			commands: [MarkCustomerSignalDone({ ...actor, userId, outcome })],
		}
	}
	switch (key) {
		case ASSIGN_ME:
		case UNASSIGN: {
			const assigneeUserId = key === ASSIGN_ME ? userId : null
			return {
				model: patchSignal(model, signal.id, (row) => ({ ...row, assigneeUserId })),
				commands: [AssignCustomerSignal({ ...actor, assigneeUserId })],
			}
		}
		case DISMISS:
			return {
				model: patchSignal(model, signal.id, (row) => ({
					...row,
					status: "dismissed",
					resolvedAtMs: shared.nowMs,
					resolvedByUserId: userId,
				})),
				commands: [DismissCustomerSignal({ ...actor, userId })],
			}
		case OPEN_QUEUE:
			return {
				model,
				outMessage: requestedOrgNavigation(shared.orgSlug, (orgSlug) =>
					AppRoute.CustomersAttention({ orgSlug }),
				),
			}
		default:
			return { model }
	}
}

const SIGNAL_VERB = {
	assign: "assign",
	snooze: "snooze",
	done: "mark done",
	dismiss: "dismiss",
} as const satisfies Record<SignalAction, string>

// NOTES

const patchNote = (model: Model, noteId: CustomerNoteId, patch: (note: NoteRow) => NoteRow | null): Model =>
	modifyFields(model, {
		notes: (notes) =>
			notes?.flatMap((note) => {
				if (note.id !== noteId) return [note]
				const next = patch(note)
				return next === null ? [] : [next]
			}) ?? null,
	})

const submitNote = (model: Model, shared: Shared): Return => {
	const args = target(model, shared)
	const authorUserId = shared.currentUser?.id
	const body = model.composer.body.trim()
	if (args === null || authorUserId === undefined || body === "") return { model }
	return {
		model: modifyFields(model, { composer: () => ({ body: "", pinned: false }) }),
		commands: [CreateCustomerNote({ ...args, authorUserId, body, pinned: model.composer.pinned })],
	}
}

const submitEdit = (model: Model, shared: Shared): Return => {
	const editing = model.editingNote
	const organizationId = shared.organization?.id
	const body = editing?.body.trim() ?? ""
	if (editing === null || organizationId === undefined || body === "") return { model }
	return {
		model: modifyFields(
			patchNote(model, editing.noteId, (note) => ({ ...note, body, editedAtMs: shared.nowMs })),
			{
				editingNote: () => null,
			},
		),
		commands: [UpdateCustomerNote({ organizationId, noteId: editing.noteId, body })],
	}
}

const NOTE_VERB = { create: "save", update: "update", delete: "delete" } as const satisfies Record<
	NoteAction,
	string
>

// UPDATE

const settle = <A, E>(current: AsyncData.AsyncData<A, E>, result: Result.Result<A, E>) =>
	AsyncData.settle(current, result)

export const update = (model: Model, message: Message, shared: Shared): Return =>
	Message.match<Return>(message, {
		UpdatedAccounts: ({ accounts }) => ({ model: modifyFields(model, { accounts: () => accounts }) }),
		UpdatedSignals: ({ signals }) => ({ model: modifyFields(model, { signals: () => signals }) }),
		UpdatedNotes: ({ notes }) => ({ model: modifyFields(model, { notes: () => notes }) }),
		UpdatedMembers: ({ members }) => ({ model: modifyFields(model, { members: () => members }) }),
		UpdatedMetrics: ({ metrics }) => ({ model: modifyFields(model, { metrics: () => metrics }) }),
		UpdatedConnectedProviders: ({ providers }) => ({
			model: modifyFields(model, { connectedProviders: () => providers }),
		}),

		UpdatedBands: ({ bands }) => ({ model: modifyFields(model, { bands: () => bands }) }),

		ClickedTab: ({ tab }) => (tab === model.tab ? { model } : navigateToTab(model, shared, tab)),
		PressedNeighbour: ({ step }) => {
			const position = positionOf(model)
			const neighbour = step === -1 ? position?.previous : position?.next
			return neighbour === null || neighbour === undefined
				? { model }
				: {
						model,
						outMessage: requestedOrgNavigation(shared.orgSlug, (orgSlug) =>
							customerRoute(orgSlug, neighbour.id, model.tab === "overview" ? null : model.tab),
						),
					}
		},
		ToggledSidebar: () => ({ model: modifyFields(model, { isSidebarOpen: (isOpen) => !isOpen }) }),
		PressedAddNote: () => {
			const result = model.tab === "notes" ? { model } : navigateToTab(model, shared, "notes")
			return { ...result, commands: [FocusNoteComposer()] }
		},
		PressedRetryDetail: () => load(modifyFields(model, { detail: () => AsyncData.Idle() }), shared),

		SucceededFetchDetail: ({ detail }) => ({
			model: modifyFields(model, { detail: (current) => settle(current, Result.succeed(detail)) }),
		}),
		FailedFetchDetail: ({ reason }) => ({
			model: modifyFields(model, { detail: (current) => settle(current, Result.fail(reason)) }),
		}),

		GotMetricMenuMessage: ({ message: menuMessage }) =>
			updateMenu(model, "metricMenu", menuMessage, (next, key) =>
				key === next.usageMetric
					? { model: next }
					: fetchUsage(
							modifyFields(next, {
								usageMetric: () => key,
								metricMenu: (menu) => modifyFields(menu, { selectedKeys: () => [key] }),
							}),
							shared,
						),
			),
		ClickedUsageRange: ({ range }) =>
			range === model.usageRange
				? { model }
				: fetchUsage(modifyFields(model, { usageRange: () => range }), shared),
		HoveredUsage: ({ index }) => ({ model: modifyFields(model, { hoveredUsage: () => index }) }),
		// An answer for a metric or range the user already left is dropped.
		SucceededFetchUsage: ({ metricKey, range, series }) =>
			metricKey === model.usageMetric && range === model.usageRange
				? {
						model: modifyFields(model, {
							usage: (current) => settle(current, Result.succeed(series)),
						}),
					}
				: { model },
		FailedFetchUsage: ({ metricKey, range, reason }) =>
			metricKey === model.usageMetric && range === model.usageRange
				? { model: modifyFields(model, { usage: (current) => settle(current, Result.fail(reason)) }) }
				: { model },
		SucceededFetchMrrHistory: ({ series }) => ({
			model: modifyFields(model, { mrrHistory: (current) => settle(current, Result.succeed(series)) }),
		}),
		FailedFetchMrrHistory: ({ reason }) => ({
			model: modifyFields(model, { mrrHistory: (current) => settle(current, Result.fail(reason)) }),
		}),
		HoveredMrr: ({ index }) => ({ model: modifyFields(model, { hoveredMrr: () => index }) }),

		ClickedContactFilter: ({ filter }) => ({
			model: modifyFields(model, { contactFilter: () => filter }),
		}),
		ChangedContactSearch: ({ value }) => ({ model: modifyFields(model, { contactSearch: () => value }) }),
		ClearedContactSearch: () => ({ model: modifyFields(model, { contactSearch: () => "" }) }),
		PressedMoreContacts: () => {
			const args = target(model, shared)
			return args === null || model.contacts.nextCursor === null || model.contacts.status === "Loading"
				? { model }
				: {
						model: modifyFields(model, {
							contacts: (contacts) => modifyFields(contacts, { status: () => "Loading" }),
						}),
						commands: [FetchCustomerContacts({ ...args, cursor: model.contacts.nextCursor })],
					}
		},
		SucceededFetchContacts: ({ page }) => ({
			model: modifyFields(model, {
				contacts: (contacts) => ({
					items: [...contacts.items, ...page.items],
					nextCursor: page.nextCursor,
					status: "Loaded",
				}),
			}),
		}),
		FailedFetchContacts: () => ({
			model: modifyFields(model, {
				contacts: (contacts) => modifyFields(contacts, { status: () => "Failed" }),
			}),
		}),

		PressedMoreInvoices: () => {
			const args = target(model, shared)
			return args === null || model.invoices.nextCursor === null || model.invoices.status === "Loading"
				? { model }
				: {
						model: modifyFields(model, {
							invoices: (invoices) => modifyFields(invoices, { status: () => "Loading" }),
						}),
						commands: [FetchCustomerInvoices({ ...args, cursor: model.invoices.nextCursor })],
					}
		},
		SucceededFetchInvoices: ({ page }) => ({
			model: modifyFields(model, {
				invoices: (invoices) => ({
					items: [...invoices.items, ...page.items],
					nextCursor: page.nextCursor,
					status: "Loaded",
				}),
			}),
		}),
		FailedFetchInvoices: () => ({
			model: modifyFields(model, {
				invoices: (invoices) => modifyFields(invoices, { status: () => "Failed" }),
			}),
		}),

		ClickedEventProvider: ({ provider }) =>
			provider === model.eventProvider
				? { model }
				: fetchEvents(
						modifyFields(model, { eventProvider: () => provider, events: () => EMPTY_PAGE }),
						shared,
						null,
					),
		GotEventTypeMenuMessage: ({ message: menuMessage }) =>
			updateMenu(model, "eventTypeMenu", menuMessage, (next, key) => {
				const type = EventType.literals.find((literal) => literal === key)
				return type === undefined || type === next.eventType
					? { model: next }
					: fetchEvents(
							modifyFields(next, {
								eventType: () => type,
								events: () => EMPTY_PAGE,
								eventTypeMenu: (menu) => modifyFields(menu, { selectedKeys: () => [type] }),
							}),
							shared,
							null,
						)
			}),
		PressedMoreEvents: () =>
			model.events.nextCursor === null || model.events.status === "Loading"
				? { model }
				: fetchEvents(model, shared, model.events.nextCursor),
		SucceededFetchEvents: ({ filter, page }) =>
			filter === eventFilterOf(model)
				? {
						model: modifyFields(model, {
							events: (events) => ({
								items: [...events.items, ...page.items],
								nextCursor: page.nextCursor,
								status: "Loaded",
							}),
						}),
					}
				: { model },
		FailedFetchEvents: ({ filter }) =>
			filter === eventFilterOf(model)
				? {
						model: modifyFields(model, {
							events: (events) => modifyFields(events, { status: () => "Failed" }),
						}),
					}
				: { model },

		GotOwnerMenuMessage: ({ message: menuMessage }) =>
			updateMenu(model, "ownerMenu", menuMessage, (next, key) => setOwner(next, shared, key)),
		GotActionsMenuMessage: ({ message: menuMessage }) =>
			updateMenu(model, "actionsMenu", menuMessage, (next, key) => onAction(next, shared, key)),
		GotTagPopoverMessage: ({ message: popoverMessage }) => {
			const result = Popover.update(model.tagPopover, popoverMessage)
			return {
				model: modifyFields(model, { tagPopover: () => result.model }),
				commands: Command.mapMessages(result.commands ?? [], (child) =>
					Message.GotTagPopoverMessage({ message: child }),
				),
			}
		},
		ChangedTagInput: ({ value }) => ({ model: modifyFields(model, { tagInput: () => value }) }),
		SubmittedTag: () => {
			const tag = model.tagInput.trim()
			const tags = accountOf(model)?.tags ?? []
			const closed = PopoverControl.close(model.tagPopover)
			const next = modifyFields(model, { tagInput: () => "", tagPopover: () => closed.model })
			const commands = Command.mapMessages(closed.commands ?? [], (child) =>
				Message.GotTagPopoverMessage({ message: child }),
			)
			if (tag === "" || tags.includes(tag)) return { model: next, commands }
			return then({ model: next, commands }, (current) => setTags(current, shared, [...tags, tag]))
		},
		RemovedTag: ({ tag }) =>
			setTags(
				model,
				shared,
				(accountOf(model)?.tags ?? []).filter((entry) => entry !== tag),
			),
		SucceededAccountUpdate: () => ({ model }),
		FailedAccountUpdate: ({ reason }) => ({
			model,
			outMessage: toast(
				errorToastOf(
					failureMessage(reason, {
						NotFound: { title: "Couldn't update the customer", description: "It was removed." },
						Stale: { title: "Couldn't update the customer" },
					}),
				),
			),
		}),
		GotRawModalMessage: ({ message: modalMessage }) => {
			const result = Modal.update(model.rawModal, modalMessage)
			return {
				model: modifyFields(model, { rawModal: () => result.model }),
				commands: Command.mapMessages(result.commands ?? [], (child) =>
					Message.GotRawModalMessage({ message: child }),
				),
			}
		},

		PressedSignalMenu: ({ signalId, menu }) => {
			const [field, entries] = SIGNAL_MENU[menu]
			return openMenu(modifyFields(model, { activeSignalId: () => signalId }), field, entries)
		},
		GotSnoozeMenuMessage: ({ message: menuMessage }) =>
			updateMenu(model, "snoozeMenu", menuMessage, (next, key) =>
				onSignalMenu(next, shared, "snooze", key),
			),
		GotDoneMenuMessage: ({ message: menuMessage }) =>
			updateMenu(model, "doneMenu", menuMessage, (next, key) =>
				onSignalMenu(next, shared, "done", key),
			),
		GotSignalMoreMenuMessage: ({ message: menuMessage }) =>
			updateMenu(model, "signalMoreMenu", menuMessage, (next, key) =>
				onSignalMenu(next, shared, "more", key),
			),
		SucceededSignalAction: () => ({ model }),
		FailedSignalAction: ({ action, reason }) => ({
			model,
			outMessage: toast(
				errorToastOf(
					failureMessage(reason, {
						NotFound: {
							title: `Couldn't ${SIGNAL_VERB[action]} the signal`,
							description: "It was resolved or removed in the meantime.",
						},
						Stale: {
							title: `Couldn't ${SIGNAL_VERB[action]} the signal`,
							description: "Someone else acted on it first.",
						},
					}),
				),
			),
		}),

		ChangedComposer: ({ value }) => ({
			model: modifyFields(model, {
				composer: (composer) => modifyFields(composer, { body: () => value }),
			}),
		}),
		ToggledComposerPin: ({ pinned }) => ({
			model: modifyFields(model, {
				composer: (composer) => modifyFields(composer, { pinned: () => pinned }),
			}),
		}),
		SubmittedNote: () => submitNote(model, shared),
		PressedEditNote: ({ noteId }) => {
			const note = model.notes?.find((entry) => entry.id === noteId)
			return note === undefined
				? { model }
				: { model: modifyFields(model, { editingNote: () => ({ noteId, body: note.body }) }) }
		},
		ChangedEditNote: ({ value }) => ({
			model: modifyFields(model, {
				editingNote: (editing) => (editing === null ? null : { ...editing, body: value }),
			}),
		}),
		CanceledEditNote: () => ({ model: modifyFields(model, { editingNote: () => null }) }),
		SubmittedEditNote: () => submitEdit(model, shared),
		PressedPinNote: ({ noteId, pinned }) => {
			const organizationId = shared.organization?.id
			return organizationId === undefined
				? { model }
				: {
						model: patchNote(model, noteId, (note) => ({ ...note, pinned })),
						commands: [UpdateCustomerNote({ organizationId, noteId, pinned })],
					}
		},
		PressedDeleteNote: ({ noteId }) => {
			const organizationId = shared.organization?.id
			return organizationId === undefined
				? { model }
				: {
						model: modifyFields(
							patchNote(model, noteId, () => null),
							{
								editingNote: (editing) => (editing?.noteId === noteId ? null : editing),
							},
						),
						commands: [DeleteCustomerNote({ organizationId, noteId })],
					}
		},
		SucceededNoteAction: ({ action }) =>
			action === "create" ? { model, outMessage: toast(successToast("Note saved")) } : { model },
		FailedNoteAction: ({ action, reason }) => ({
			model,
			outMessage: toast(
				errorToastOf(
					failureMessage(reason, {
						NotFound: {
							title: `Couldn't ${NOTE_VERB[action]} the note`,
							description: "It was deleted.",
						},
						Stale: { title: `Couldn't ${NOTE_VERB[action]} the note` },
					}),
				),
			),
		}),

		PressedCopy: ({ text, label }) => ({ model, commands: [CopyCustomerText({ text, label })] }),
		CompletedCopy: ({ label, isCopied }) => ({
			model,
			outMessage: toast(
				isCopied
					? successToast(`${label} copied`)
					: errorToastOf({ title: `Couldn't copy the ${label.toLowerCase()}` }),
			),
		}),
		CompletedFocusComposer: () => ({ model }),
	})
