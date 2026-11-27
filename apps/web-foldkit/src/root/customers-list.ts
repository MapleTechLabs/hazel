// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The customers list's hazel controls and table, drawn in today's Foldkit list page's holes: each
 * reads the page's state off its hole (`page/customers/list/hole.ts`), the accounts and members
 * from the live queries, and publishes what the user asks for on the bus. Part of the adapter.
 */
import { Command, Component, Mount, Subscription, UiSchema } from "@effect/ui"
import { Html } from "@effect/ui/html"
import { listRows } from "@hazel/shared-screens/customers/list/columns"
import { ListControls, ListControlsEvents } from "@hazel/shared-screens/customers/list/ListControls"
import { ListTable, ListTableEvents } from "@hazel/shared-screens/customers/list/ListTable"
import { withSearch } from "@hazel/shared-screens/customers/list/filters"
import { OrganizationId, UserId } from "@hazel/schema"
import { Effect, Option, Queue, Schema, Stream } from "effect"
import { HOLE_ATTRIBUTE, type HoleName } from "../app/holes"
import { AccountRow, accountsStream, MemberRow, orgMembersStream } from "../customers/queries"
import {
	decodeHoleState,
	type ListHoleEvent,
	ListHoleState,
	STATE_ATTRIBUTE,
} from "../page/customers/list/hole"
import { publish } from "./bus"

const Part = Schema.Literals(["controls", "table"])

export const holeOfPart = (part: typeof Part.Type): HoleName =>
	part === "controls" ? "customers-list-controls" : "customers-list-table"

const Watched = UiSchema.TaggedEnum({
	ReadState: { json: Schema.String },
	HoveredName: { accountId: Schema.NullOr(Schema.String) },
	MeasuredWidth: { width: Schema.Finite },
})
type Watched = typeof Watched.Type

/**
 * Follows the hole this element sits in (the page may replace it): its state attribute, and, in the
 * table's, the pointer entering and leaving a row's name cell.
 */
const WatchListHole = Mount.makeStream(
	"WatchListHole",
	{ args: { hole: Schema.String } },
	(node: HTMLElement, { hole }) =>
		Stream.callback<Watched>((queue) =>
			Effect.acquireRelease(
				Effect.sync(() => {
					const view = node.ownerDocument.defaultView
					let current: Element | null = null
					let last: string | null = null
					let hovered: string | null = null
					const read = () => {
						const json = current?.getAttribute(STATE_ATTRIBUTE) ?? null
						if (json === null || json === last) return
						last = json
						Queue.offerUnsafe(queue, Watched.ReadState({ json }))
					}
					const attributes = new (view?.MutationObserver ?? MutationObserver)(read)
					// The table drops columns by its own width, as today's container queries did.
					let width = -1
					const measure = () => {
						const next = current === null ? -1 : Math.round(current.getBoundingClientRect().width)
						if (next <= 0 || next === width) return
						width = next
						Queue.offerUnsafe(queue, Watched.MeasuredWidth({ width }))
					}
					const sizes = view?.ResizeObserver === undefined ? null : new view.ResizeObserver(measure)
					const follow = () => {
						const next = node.closest(`[${HOLE_ATTRIBUTE}="${hole}"]`)
						if (next === current) return
						attributes.disconnect()
						sizes?.disconnect()
						current = next
						if (current !== null) {
							attributes.observe(current, { attributeFilter: [STATE_ATTRIBUTE] })
							sizes?.observe(current)
						}
						read()
						measure()
					}
					const tree = new (view?.MutationObserver ?? MutationObserver)(follow)
					tree.observe(node.ownerDocument.body, { childList: true, subtree: true })
					follow()
					const hover = (accountId: string | null) => {
						if (accountId === hovered) return
						hovered = accountId
						Queue.offerUnsafe(queue, Watched.HoveredName({ accountId }))
					}
					const onOver = (event: Event) => {
						const cell =
							event.target instanceof Element
								? event.target.closest('[data-hz="tableCell"]')
								: null
						const row = cell?.closest("[data-hz-key]")
						hover(
							cell?.getAttribute("data-column") === "name"
								? (row?.getAttribute("data-hz-key") ?? null)
								: null,
						)
					}
					const onLeave = () => hover(null)
					node.addEventListener("mouseover", onOver)
					node.addEventListener("mouseleave", onLeave)
					return () => {
						tree.disconnect()
						attributes.disconnect()
						sizes?.disconnect()
						node.removeEventListener("mouseover", onOver)
						node.removeEventListener("mouseleave", onLeave)
					}
				}),
				(release) => Effect.sync(release),
			).pipe(Effect.andThen(Effect.never)),
		),
)

/** What a hole asks the page for, on the bus (`listEvents` in the page's subscriptions). */
const PublishListEvent = Command.make("PublishListEvent", { args: { event: Schema.Unknown } }, ({ event }) =>
	Effect.sync(() => publish({ _tag: "CustomersList", event: event as ListHoleEvent })).pipe(
		Effect.as(Component.noop),
	),
)

const HoleMessage = UiSchema.TaggedEnum({
	Watched: { watched: Watched },
	UpdatedAccounts: { accounts: Schema.Array(AccountRow) },
	UpdatedMembers: { members: Schema.Array(MemberRow) },
	Asked: { event: Schema.Union([ListControlsEvents, ListTableEvents]) },
})

export const CustomersListHole = Html.component({
	name: "CustomersListHole",
	props: Schema.Struct({ organizationId: OrganizationId, userId: UserId, part: Part }),
	model: Schema.Struct({
		state: Schema.NullOr(ListHoleState),
		accounts: Schema.NullOr(Schema.Array(AccountRow)),
		members: Schema.Array(MemberRow),
		width: Schema.NullOr(Schema.Finite),
	}),
	message: HoleMessage,
	restore: false,
}).make({
	init: () => ({ state: null, accounts: null, members: [], width: null }),
	update: {
		Watched: ($, { watched }) =>
			Watched.match(watched, {
				ReadState: ({ json }) =>
					Option.match(decodeHoleState(json), {
						onNone: () => $.model,
						onSome: (state) => $.evolve({ state: () => state }),
					}),
				HoveredName: ({ accountId }) =>
					$.run(PublishListEvent.make({ event: { _tag: "HoveredName", accountId } })),
				MeasuredWidth: ({ width }) => $.evolve({ width: () => width }),
			}),
		UpdatedAccounts: ($, { accounts }) => $.evolve({ accounts: () => accounts }),
		UpdatedMembers: ($, { members }) => $.evolve({ members: () => members }),
		Asked: ($, { event }) => $.run(PublishListEvent.make({ event })),
	},
	subscriptions: ({ props }) => [
		Subscription.make("accounts", [props.organizationId], ([organizationId]) =>
			accountsStream(organizationId, (accounts) => HoleMessage.UpdatedAccounts({ accounts })),
		),
		Subscription.make("members", [props.organizationId], ([organizationId]) =>
			orgMembersStream(organizationId, (members) => HoleMessage.UpdatedMembers({ members })),
		),
	],
	view: (h, model) => {
		const { state, accounts } = model
		const ask = (event: ListControlsEvents | ListTableEvents) => HoleMessage.Asked({ event })
		const viewer = { userId: h.props.userId, nowMs: state?.nowMs ?? 0, isAdmin: false }
		const body =
			state === null
				? null
				: h.props.part === "controls"
					? ListControls(h, {
							key: "controls",
							props: {
								accounts: accounts ?? [],
								members: model.members,
								filters: state.filters,
								search: state.search,
								sort: state.sort,
								columns: state.columns,
								count:
									accounts === null
										? 0
										: listRows(
												accounts,
												withSearch(state.filters, state.search),
												state.sort,
												model.members,
												viewer,
											).length,
								currency: state.currency,
								userId: h.props.userId,
								nowMs: state.nowMs,
								compact: state.isMobile,
							},
							onEmit: {
								ChangedSearch: (event) => ask(ListControlsEvents.ChangedSearch(event)),
								ClearedFilter: (event) => ask(ListControlsEvents.ClearedFilter(event)),
								AppliedFilters: (event) => ask(ListControlsEvents.AppliedFilters(event)),
								ChangedSort: (event) => ask(ListControlsEvents.ChangedSort(event)),
								ChangedColumns: (event) => ask(ListControlsEvents.ChangedColumns(event)),
								ResetColumns: () => ask(ListControlsEvents.ResetColumns()),
							},
						})
					: ListTable(h, {
							key: "table",
							props: {
								accounts:
									accounts === null
										? []
										: listRows(
												accounts,
												withSearch(state.filters, state.search),
												state.sort,
												model.members,
												viewer,
											),
								loading: accounts === null,
								rowLimit: state.rowLimit,
								columns: state.columns,
								sort: state.sort,
								selected: state.selected,
								focusedId: state.focusedId,
								currency: state.currency,
								nowMs: state.nowMs,
								members: model.members,
								sparklines: state.sparklines,
								width: model.width,
							},
							onEmit: {
								ClickedSortHeader: (event) => ask(ListTableEvents.ClickedSortHeader(event)),
								ToggledRow: (event) => ask(ListTableEvents.ToggledRow(event)),
								ToggledAllRows: (event) => ask(ListTableEvents.ToggledAllRows(event)),
								PressedRow: (event) => ask(ListTableEvents.PressedRow(event)),
								PressedShowMore: () => ask(ListTableEvents.PressedShowMore()),
							},
						})
		return h.div
			.class("contents")
			.onMount(
				WatchListHole({ hole: holeOfPart(h.props.part) }).pipe(
					Mount.map((watched) => HoleMessage.Watched({ watched })),
				),
			)
			.children(body)
	},
})
