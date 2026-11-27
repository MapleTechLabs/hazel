import { DragAndDrop } from "@foldkit/ui"
import { CustomerAccountId, OrganizationId, UserId } from "@hazel/schema"
import { Effect, Match, Option, Queue, Schema, Stream } from "effect"
import { Subscription } from "foldkit"
import {
	accountsStream,
	connectedProvidersStream,
	orgMembersStream,
	settingsSummaryStream,
	signalsStream,
	viewLayoutStream,
} from "../../../customers/queries"
import type { PageSubscriptionInput } from "../../contract"
import { viewRowsStream } from "./data"
import { Message } from "./message"
import type { ListKey, Model } from "./model"
import { isInAssistantPanel } from "../../assistant-context"
import { eventsOf } from "../../../root/bus"
import type { ListHoleEvent } from "./hole"

/** The list's live rows, and its keyboard while nothing else holds it. */

type Input = PageSubscriptionInput<Model>

const KEYS = new Map<string, ListKey>([
	["j", "next"],
	["ArrowDown", "next"],
	["k", "previous"],
	["ArrowUp", "previous"],
	["Enter", "open"],
	["x", "select"],
	["/", "search"],
	["Escape", "escape"],
])

const elementOf = (target: EventTarget | null): HTMLElement | null =>
	typeof HTMLElement !== "undefined" && target instanceof HTMLElement ? target : null

/** The list key a keydown means; none while typing, with a modifier, or Enter on a button or link. */
export const listKeyOf = (event: {
	readonly key: string
	readonly target: EventTarget | null
	readonly altKey: boolean
	readonly ctrlKey: boolean
	readonly metaKey: boolean
}): ListKey | null => {
	const element = elementOf(event.target)
	if (event.altKey || event.ctrlKey || event.metaKey || isInAssistantPanel(event.target)) return null
	// The hazel controls' builder, column picker and sort menu hold the keyboard while open.
	if (element?.closest('[role="dialog"], [role="menu"]') != null) return null
	if (
		element !== null &&
		(element.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName))
	)
		return null
	const key = KEYS.get(event.key.length === 1 ? event.key.toLowerCase() : event.key)
	if (key === undefined) return null
	if (key === "open" && element?.closest("button, a, [role=menuitem]") != null) return null
	return key
}

/** A hole's event as the page's own message. */
export const messageOfHoleEvent = (event: ListHoleEvent): Message =>
	Match.valueTags(event, {
		ChangedSearch: ({ value }) => Message.ChangedSearch({ value }),
		ClearedFilter: ({ field }) => Message.ClearedFilter({ field }),
		AppliedFilters: ({ filters }) => Message.AppliedFilters({ filters }),
		ChangedSort: ({ sort }) => Message.ChangedSort({ sort }),
		ChangedColumns: ({ columns }) => Message.ChangedColumns({ columns }),
		ResetColumns: () => Message.ResetColumns(),
		ClickedSortHeader: ({ column }) => Message.ClickedSortHeader({ column }),
		ToggledRow: ({ accountId, selected }) => Message.ToggledRow({ accountId, isSelected: selected }),
		ToggledAllRows: ({ selected }) => Message.ToggledAllRows({ isSelected: selected }),
		PressedRow: ({ accountId }) => Message.ClickedRow({ accountId }),
		PressedShowMore: () => Message.PressedShowMoreRows(),
		HoveredName: ({ accountId }) =>
			accountId === null
				? Message.UnhoveredRow()
				: Message.HoveredRow({ accountId: Schema.decodeSync(CustomerAccountId)(accountId) }),
	})

const holdsKeyboard = (model: Model) =>
	model.saveModal.isOpen ||
	model.deleteModal.isOpen ||
	model.tagPopover.isOpen ||
	[model.viewMenu, model.ownerMenu].some((menu) => menu.popup._tag === "Open")

const organization = { organizationId: Schema.NullOr(OrganizationId) }
const organizationOf = ({ shared }: Input) => ({ organizationId: shared.organization?.id ?? null })

const viewer = { organizationId: Schema.NullOr(OrganizationId), userId: Schema.NullOr(UserId) }
const viewerOf = ({ shared }: Input) => ({
	organizationId: shared.organization?.id ?? null,
	userId: shared.currentUser?.id ?? null,
})

const live = Subscription.make<Input, Message>()((entry) => ({
	accounts: entry(organization, {
		modelToDependencies: organizationOf,
		dependenciesToStream: ({ organizationId }) =>
			organizationId === null
				? Stream.empty
				: accountsStream(organizationId, (accounts) => Message.UpdatedAccounts({ accounts })),
	}),
	signals: entry(organization, {
		modelToDependencies: organizationOf,
		dependenciesToStream: ({ organizationId }) =>
			organizationId === null
				? Stream.empty
				: signalsStream(organizationId, (signals) => Message.UpdatedSignals({ signals })),
	}),
	views: entry(viewer, {
		modelToDependencies: viewerOf,
		dependenciesToStream: ({ organizationId, userId }) =>
			organizationId === null || userId === null
				? Stream.empty
				: viewRowsStream(organizationId, userId, (views) => Message.UpdatedViews({ views })),
	}),
	viewLayout: entry(viewer, {
		modelToDependencies: viewerOf,
		dependenciesToStream: ({ organizationId, userId }) =>
			organizationId === null || userId === null
				? Stream.empty
				: viewLayoutStream(organizationId, userId, (layout) => Message.UpdatedViewLayout({ layout })),
	}),
	members: entry(organization, {
		modelToDependencies: organizationOf,
		dependenciesToStream: ({ organizationId }) =>
			organizationId === null
				? Stream.empty
				: orgMembersStream(organizationId, (members) => Message.UpdatedMembers({ members })),
	}),
	connections: entry(organization, {
		modelToDependencies: organizationOf,
		dependenciesToStream: ({ organizationId }) =>
			organizationId === null
				? Stream.empty
				: connectedProvidersStream(organizationId, (providers) =>
						Message.UpdatedConnectedProviders({ providers }),
					),
	}),
	lastComputedAt: entry(organization, {
		modelToDependencies: organizationOf,
		dependenciesToStream: ({ organizationId }) =>
			organizationId === null
				? Stream.empty
				: settingsSummaryStream(organizationId, (settings) =>
						Message.UpdatedSettings({
							lastComputedAtMs: settings?.lastComputedAtMs ?? null,
							reportingCurrency: settings?.reportingCurrency ?? "USD",
						}),
					),
	}),
	// What the hazel controls and table ask for (the shell draws them in the page's holes).
	listEvents: entry(
		{},
		{
			modelToDependencies: () => ({}),
			dependenciesToStream: () =>
				eventsOf("CustomersList").pipe(Stream.map(({ event }) => messageOfHoleEvent(event))),
		},
	),
	keys: entry(
		{ isActive: Schema.Boolean },
		{
			modelToDependencies: ({ model, shared }) => ({
				isActive: !shared.isOverlayOpen && !holdsKeyboard(model),
			}),
			dependenciesToStream: ({ isActive }) =>
				isActive
					? Stream.callback<Message>((queue) =>
							Effect.acquireRelease(
								Effect.sync(() => {
									const onKeyDown = (event: KeyboardEvent) => {
										const key = listKeyOf(event)
										if (key === null) return
										event.preventDefault()
										Queue.offerUnsafe(queue, Message.PressedListKey({ key }))
									}
									document.addEventListener("keydown", onKeyDown)
									return onKeyDown
								}),
								(onKeyDown) =>
									Effect.sync(() => document.removeEventListener("keydown", onKeyDown)),
							).pipe(Effect.flatMap(() => Effect.never)),
						)
					: Stream.empty,
		},
	),
}))

const tabDrag = Subscription.lift(DragAndDrop.subscriptions)<Input, Message>({
	read: ({ model }) => Option.some(model.tabDrag),
	toParentMessage: (message) => Message.GotTabDragMessage({ message }),
})

/** The tab drag's document listeners. */
export const tabDragSubscriptions = {
	tabDragPointer: tabDrag.documentPointer,
	tabDragEscape: tabDrag.documentEscape,
	tabDragScroll: tabDrag.autoScroll,
}

export const subscriptions = Subscription.aggregate(live, tabDragSubscriptions)
