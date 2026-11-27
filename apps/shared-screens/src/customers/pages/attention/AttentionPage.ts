// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * `/:org/customers/attention`, Needs attention (the deleted Foldkit `page/customers/attention`): the
 * ranked signal queue by tab (open, snoozed, done), filtered, sorted and grouped, a preview of the
 * selected signal beside it, and the row actions (assign, snooze, mute, mark done, reopen) on the
 * keyboard too. The done and pick-date dialogs open through the app's modal layer.
 */
import { Command, Component, Renderer, Subscription, UiSchema } from "@effect/ui"
import { Clipboard } from "@hazel/client-data/platform"
import { TEMPLATES } from "@hazel/domain/customers"
import type { CustomerSignalId } from "@hazel/schema"
import { CustomerAccountId, OrganizationId, UserId } from "@hazel/schema"
import { Hazel, TextField } from "@hazel/ui/vocabulary/index"
import { Effect, Layer, Match, Option, Schema, Stream } from "effect"
import { Navigate, OpenModal, ShowToast } from "../../../app/requests"
import { withData } from "../../../app/live"
import { Session } from "../../../app/session"
import { errorToast } from "../../../modals/feedback"
import { modalServices } from "../../../modals/services"
import { makeCustomerActions } from "../../data/actions"
import { formatMoney, formatRelative, formatWeekdayTime } from "../../data/format"
import { customerAccountOf, environmentCounts, queueNameOf } from "../../data/groups"
import { AccountRow, makeCustomerQueries, MemberRow, SignalRow } from "../../data/queries"
import { failureCopy, failureOf, SignalAction, SignalActionFailure } from "../../queue/actions"
import { type KeyTable, queueKeys } from "../../queue/keys"
import {
	ASSIGN_ME,
	ASSIGN_NONE,
	assignEntries,
	filterEntries,
	isMuteKey,
	isSnoozeOption,
	MUTE_LABEL,
	type MuteKey,
	muteUntil,
	PICK_DATE_KEY,
	snoozeEntries,
	snoozeUntilMs,
	sortEntries,
	userIdOfAssignKey,
} from "../../queue/menus"
import {
	accountGroups,
	accountRunOf,
	accountsByIdOf,
	canReopen,
	clearFilter,
	clearNarrowing,
	DEFAULT_FILTERS,
	FilterField,
	Filters,
	Grouping,
	isActionable,
	isNarrowed,
	neighbourOf,
	NO_ACCOUNT_RUN,
	OWNER_LABEL,
	OWNER_SCOPE,
	plansOf,
	type QueueState,
	rowIds,
	Sort,
	SORT_ASCENDING,
	SORT_LABEL,
	signalById,
	Tab,
	tabCounts,
	toggleFilter,
	type Viewer,
	visibleSignals,
} from "../../queue/model"
import { type DetailState, GetAccountDetail, previewPanel } from "../../queue/preview"
import {
	accountGroupRow,
	COMPACT_COLUMNS,
	compactRow,
	DONE_COLUMNS,
	doneRow,
	GROUP_COLUMNS,
	type RowContext,
	SIGNAL_COLUMNS,
	SNOOZED_COLUMNS,
	signalRow,
	snoozedRow,
} from "../../queue/rows"
import { KIND_LABEL, SEVERITY_LABEL } from "../../ui/badges"
import { noResultsState } from "../../ui/empty-states"
import {
	addFilterButton,
	filterBar,
	filterChip,
	type Shortcut,
	searchBox,
	shortcutBar,
	sortTrigger,
	viewTabs,
} from "../../ui/filter-bar"
import { companyLogo } from "../../ui/identity"
import { queueAction, queueTable } from "../../ui/queue-row"

// KEYS

export const QueueKey = Schema.Literals([
	"next",
	"previous",
	"assign",
	"assignToMe",
	"snooze",
	"done",
	"reopen",
	"open",
	"preview",
	"close",
	"search",
])
export type QueueKey = typeof QueueKey.Type

export const QUEUE_KEYS: KeyTable<QueueKey> = {
	keys: new Map<string, QueueKey>([
		// k walks down the queue, j up (today's keys).
		["k", "next"],
		["ArrowDown", "next"],
		["j", "previous"],
		["ArrowUp", "previous"],
		// Linear's keys: A assign, I assign to me, H snooze.
		["a", "assign"],
		["i", "assignToMe"],
		["h", "snooze"],
		["d", "done"],
		["r", "reopen"],
		["w", "reopen"],
		["Enter", "open"],
		[" ", "preview"],
		["Escape", "close"],
		["/", "search"],
	]),
	repeatable: new Set(["next", "previous"]),
	pressable: new Set(["open", "preview"]),
}

// MODEL

export const AttentionProps = Schema.Struct({ session: Session, nowMs: Schema.Finite })
export type AttentionProps = typeof AttentionProps.Type

export const AttentionModel = Schema.Struct({
	tab: Tab,
	grouping: Grouping,
	sort: Sort,
	/** A second press on the sorted column's header flips its direction. */
	isSortReversed: Schema.Boolean,
	filters: Filters,
	search: TextField.State,
	/** Live rows; null until each query answers. */
	signals: Schema.NullOr(Schema.Array(SignalRow)),
	accounts: Schema.NullOr(Schema.Array(AccountRow)),
	members: Schema.Array(MemberRow),
	lastComputedAtMs: Schema.NullOr(Schema.Finite),
	/** The selected signal (in account grouping, the account's top signal). */
	selectedId: Schema.NullOr(Schema.String),
	isPreviewOpen: Schema.Boolean,
	/** Counts "Try again" on the preview's detail. */
	detailAttempt: Schema.Finite,
})
export type AttentionModel = typeof AttentionModel.Type

export const AttentionMessage = UiSchema.TaggedEnum({
	UpdatedSignals: { signals: Schema.Array(SignalRow) },
	UpdatedAccounts: { accounts: Schema.Array(AccountRow) },
	UpdatedMembers: { members: Schema.Array(MemberRow) },
	UpdatedLastComputedAt: { lastComputedAtMs: Schema.NullOr(Schema.Finite) },

	PickedTab: { id: Schema.String },
	PickedGrouping: { selected: Schema.Array(Schema.String) },
	PressedColumnSort: { column: Schema.String },
	SelectedSort: { id: Schema.String },
	ChangedSearch: { payload: TextField.ChangePayload },
	SelectedFilter: { id: Schema.String },
	ClearedFilter: { field: FilterField },
	PressedShowAllOwners: {},
	PressedClearNarrowing: {},

	PressedRow: { signalId: Schema.String },
	DismissedPreview: {},
	PressedQueueKey: { key: QueueKey },
	SelectedAssign: { id: Schema.String },
	SelectedSnooze: { id: Schema.String },
	PressedMarkDone: {},
	PressedReopen: {},
	PressedSignalRules: {},
	PressedRetryDetail: {},
	PressedCopyEmail: { email: Schema.String },

	SucceededSignalAction: {},
	FailedSignalAction: { action: SignalAction, reason: SignalActionFailure },
	CopiedEmail: { email: Schema.String },
	FailedCopyEmail: {},
})
export type AttentionMessage = typeof AttentionMessage.Type
const M = AttentionMessage

// COMMANDS

const settled = (action: SignalAction) =>
	Effect.match({
		onSuccess: () => M.SucceededSignalAction(),
		onFailure: (error: unknown) => M.FailedSignalAction({ action, reason: failureOf(error) }),
	})

/** Assigns the signal (null: unassign); optimistic, so the row changes at once. */
export class AssignSignal extends Command.Service<AssignSignal>()("hazel/attention/AssignSignal", {
	args: { organizationId: OrganizationId, signalId: Schema.String, assigneeUserId: Schema.NullOr(UserId) },
	success: AttentionMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.map(modalServices, ({ data, run }) => {
			const { assignSignalAction } = makeCustomerActions(data)
			return ({ signalId, ...args }) =>
				run(assignSignalAction({ ...args, signalId: signalId as CustomerSignalId })).pipe(
					settled("assign"),
				)
		}),
	)
}

/** Snoozes the signal until `untilMs`. */
export class SnoozeSignal extends Command.Service<SnoozeSignal>()("hazel/attention/SnoozeSignal", {
	args: { organizationId: OrganizationId, userId: UserId, signalId: Schema.String, untilMs: Schema.Finite },
	success: AttentionMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.map(modalServices, ({ data, run }) => {
			const { snoozeSignalAction } = makeCustomerActions(data)
			return ({ signalId, untilMs, ...args }) =>
				run(
					snoozeSignalAction({
						...args,
						signalId: signalId as CustomerSignalId,
						until: new Date(untilMs),
					}),
				).pipe(settled("snooze"))
		}),
	)
}

/** Snoozed, done or dismissed back to open. */
export class ReopenSignal extends Command.Service<ReopenSignal>()("hazel/attention/ReopenSignal", {
	args: { organizationId: OrganizationId, signalId: Schema.String },
	success: AttentionMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.map(modalServices, ({ data, run }) => {
			const { reopenSignalAction } = makeCustomerActions(data)
			return ({ signalId, organizationId }) =>
				run(reopenSignalAction({ organizationId, signalId: signalId as CustomerSignalId })).pipe(
					settled("reopen"),
				)
		}),
	)
}

/** Mutes the customer in Needs attention until `untilMs` (null: until unmuted). */
export class MuteCustomer extends Command.Service<MuteCustomer>()("hazel/attention/MuteCustomer", {
	args: {
		organizationId: OrganizationId,
		userId: UserId,
		accountId: CustomerAccountId,
		untilMs: Schema.NullOr(Schema.Finite),
	},
	success: AttentionMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.map(modalServices, ({ data, run }) => {
			const { setAttentionMuteAction } = makeCustomerActions(data)
			return ({ untilMs, ...args }) =>
				run(
					setAttentionMuteAction({
						...args,
						mute: { until: untilMs === null ? null : new Date(untilMs) },
					}),
				).pipe(settled("mute"))
		}),
	)
}

export class CopyEmail extends Command.Service<CopyEmail>()("hazel/attention/CopyEmail", {
	args: { email: Schema.String },
	success: AttentionMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const clipboard = yield* Clipboard
			return ({ email }) =>
				clipboard.write(email).pipe(
					Effect.match({
						onSuccess: () => M.CopiedEmail({ email }),
						onFailure: () => M.FailedCopyEmail(),
					}),
				)
		}),
	)
}

/** The search field, so `/` can focus it. */
export const SearchRef = Renderer.ref("AttentionPage.search")

export class FocusSearch extends Command.Service<FocusSearch>()("hazel/attention/FocusSearch", {
	args: {},
	success: Component.Noop,
}) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const host = yield* Hazel.Host
			return () =>
				Effect.gen(function* () {
					const refs = yield* Renderer.Refs
					const node = yield* refs.lookup(SearchRef)
					// SAFETY: a ref resolves to the node its host created (`Hazel.HostNode`).
					if (Option.isSome(node)) yield* host.focus(node.value as Hazel.HostNode)
					return Component.noop
				})
		}),
	)
}

// SELECTORS

const viewerOf = (props: AttentionProps): Viewer => ({
	userId: props.session.user?.id ?? null,
	nowMs: props.nowMs,
})

const stateOf = (model: AttentionModel): QueueState => ({ ...model, search: model.search.text })

const asId = (id: string | null) => id as CustomerSignalId | null

const selectedSignalOf = (model: AttentionModel) => signalById(model, asId(model.selectedId))

const isSelectionVisible = (model: AttentionModel, viewer: Viewer) =>
	model.selectedId !== null && rowIds(stateOf(model), viewer).includes(model.selectedId as CustomerSignalId)

const actorOf = (session: Session) =>
	session.organization === null || session.user === null
		? null
		: { organizationId: session.organization.id, userId: session.user.id }

const customerHrefOf = (session: Session, accountId: string) =>
	session.orgSlug === null ? null : `/${session.orgSlug}/customers/${accountId}`

/** After the rows change, a selection that left the tab moves to its neighbour so the keyboard keeps going. */
const followSelection = (before: AttentionModel, after: AttentionModel, viewer: Viewer): AttentionModel => {
	if (after.selectedId === null || before.signals === null || before.accounts === null) return after
	const id = after.selectedId as CustomerSignalId
	const previous = rowIds(stateOf(before), viewer)
	if (!previous.includes(id)) return after
	return { ...after, selectedId: neighbourOf(previous, rowIds(stateOf(after), viewer), id) }
}

const isTab = Schema.is(Tab)
const isGrouping = Schema.is(Grouping)
const isSort = Schema.is(Sort)

// COMPONENT

const AttentionDef = Hazel.component({
	name: "AttentionPage",
	props: AttentionProps,
	model: AttentionModel,
	message: AttentionMessage,
	queries: {
		detail: {
			query: GetAccountDetail,
			args: ({ props, model }) => {
				const signal = model.isPreviewOpen ? selectedSignalOf(model) : undefined
				const organizationId = props.session.organization?.id
				return signal === undefined || organizationId === undefined
					? undefined
					: { organizationId, accountId: signal.accountId, attempt: model.detailAttempt }
			},
		},
	},
})

// The update helpers read no query results.
// oxlint-disable-next-line typescript/no-explicit-any
type AttentionQueries = any
type H = Parameters<Parameters<typeof AttentionDef.make>[0]["view"]>[0]
type Update = Component.Update<AttentionModel, AttentionMessage, never, AttentionProps, AttentionQueries>
type Step = AttentionModel | Component.Step<AttentionModel, AttentionMessage, never, any, AttentionQueries>

const init = (): AttentionModel => ({
	tab: "open",
	grouping: "signals",
	sort: "priority",
	isSortReversed: false,
	filters: DEFAULT_FILTERS,
	search: TextField.empty,
	signals: null,
	accounts: null,
	members: [],
	lastComputedAtMs: null,
	selectedId: null,
	isPreviewOpen: false,
	detailAttempt: 0,
})

/** The selection, or the first row when there is none (an action key on an unselected queue). */
const ensureSelection = (model: AttentionModel, viewer: Viewer): AttentionModel => {
	if (isSelectionVisible(model, viewer)) return model
	const first = rowIds(stateOf(model), viewer)[0]
	return first === undefined ? model : { ...model, selectedId: first }
}

/** j / k: the next or previous row; from no selection, the first row. */
const move = (model: AttentionModel, viewer: Viewer, step: 1 | -1): AttentionModel => {
	const ids = rowIds(stateOf(model), viewer)
	if (ids.length === 0) return model
	const index = model.selectedId === null ? -1 : ids.indexOf(model.selectedId as CustomerSignalId)
	const next = index < 0 ? 0 : Math.min(ids.length - 1, Math.max(0, index + step))
	return { ...model, selectedId: ids[next] ?? null }
}

const toast = (title: string, description: string | null) =>
	ShowToast.make({ toast: { intent: "success", title, description } })

const assign = ($: Update, model: AttentionModel, key: string): Step => {
	const signal = selectedSignalOf(model)
	const actor = actorOf($.props.session)
	if (signal === undefined || actor === null) return $.set(model)
	const assigneeUserId =
		key === ASSIGN_ME
			? actor.userId
			: key === ASSIGN_NONE
				? null
				: model.members.find((member) => member.id === userIdOfAssignKey(key))?.id
	if (assigneeUserId === undefined) return $.set(model)
	return $.set(model).run(
		AssignSignal.make({ organizationId: actor.organizationId, signalId: signal.id, assigneeUserId }),
	)
}

const mute = ($: Update, key: MuteKey): Step => {
	const signal = selectedSignalOf($.model)
	const actor = actorOf($.props.session)
	if (signal === undefined || actor === null) return $.model
	const accountsById = accountsByIdOf($.model)
	const held = accountsById.get(signal.accountId)
	const customer = held === undefined ? undefined : customerAccountOf(held, accountsById)
	const untilMs = muteUntil(key, new Date($.props.nowMs))?.getTime() ?? null
	return $.run(MuteCustomer.make({ ...actor, accountId: customer?.id ?? signal.accountId, untilMs })).run(
		toast(
			`Muted ${customer?.name ?? "Customer"} ${MUTE_LABEL[key].toLowerCase()}`,
			"Unmute it from the customer's page.",
		),
	)
}

const snooze = ($: Update, key: string): Step => {
	const signal = selectedSignalOf($.model)
	const actor = actorOf($.props.session)
	if (signal === undefined || actor === null) return $.model
	if (key === PICK_DATE_KEY)
		return $.run(
			OpenModal.make({
				modal: { _tag: "SnoozeSignalUntil", signalId: signal.id, title: signal.title },
			}),
		)
	if (isMuteKey(key)) return mute($, key)
	if (!isSnoozeOption(key)) return $.model
	return $.run(
		SnoozeSignal.make({
			...actor,
			signalId: signal.id,
			untilMs: snoozeUntilMs(key, $.props.nowMs, signal),
		}),
	)
}

const openDone = ($: Update, model: AttentionModel): Step => {
	const signal = selectedSignalOf(model)
	const account = signal === undefined ? undefined : accountsByIdOf(model).get(signal.accountId)
	if (signal === undefined || account === undefined || !isActionable(signal)) return $.set(model)
	return $.set(model).run(
		OpenModal.make({
			modal: {
				_tag: "MarkSignalDone",
				signalId: signal.id,
				accountName: queueNameOf(account),
				accountLogoUrl: account.logoUrl,
				title: signal.title,
				reason: signal.reason,
				severity: signal.severity,
			},
		}),
	)
}

const reopen = ($: Update, model: AttentionModel): Step => {
	const signal = selectedSignalOf(model)
	const organizationId = $.props.session.organization?.id
	if (signal === undefined || organizationId === undefined || !canReopen(signal)) return $.set(model)
	return $.set(model).run(ReopenSignal.make({ organizationId, signalId: signal.id }))
}

const openCustomer = ($: Update): Step => {
	const signal = selectedSignalOf($.model)
	const href = signal === undefined ? null : customerHrefOf($.props.session, signal.accountId)
	return href === null ? $.model : $.run(Navigate.make({ href, replace: false }))
}

/**
 * An action key on the selected row. A selection the search or filters now hide only moves to the
 * first row: the key never acts on a row the user has not seen selected.
 */
const withSelected = ($: Update, run: ($: Update, model: AttentionModel) => Step): Step => {
	const viewer = viewerOf($.props)
	const isHidden = $.model.selectedId !== null && !isSelectionVisible($.model, viewer)
	const next = ensureSelection($.model, viewer)
	return isHidden || next.selectedId === null ? $.set(next) : run($, next)
}

export const AttentionPageNoDeps = AttentionDef.make({
	init,
	update: {
		UpdatedSignals: ($, { signals }) =>
			followSelection($.model, { ...$.model, signals }, viewerOf($.props)),
		UpdatedAccounts: ($, { accounts }) =>
			followSelection($.model, { ...$.model, accounts }, viewerOf($.props)),
		UpdatedMembers: ($, { members }) => $.evolve({ members }),
		UpdatedLastComputedAt: ($, { lastComputedAtMs }) => $.evolve({ lastComputedAtMs }),

		PickedTab: ($, { id }) =>
			isTab(id) ? $.evolve({ tab: id, selectedId: null, isPreviewOpen: false }) : $.model,
		PickedGrouping: ($, { selected }) => {
			const [grouping] = selected
			return isGrouping(grouping) ? $.evolve({ grouping }) : $.model
		},
		PressedColumnSort: ($, { column }) => {
			const sort = column === "rank" ? "priority" : column
			return isSort(sort)
				? $.evolve({ sort, isSortReversed: (reversed) => sort === $.model.sort && !reversed })
				: $.model
		},
		SelectedSort: ($, { id }) => (isSort(id) ? $.evolve({ sort: id, isSortReversed: false }) : $.model),
		ChangedSearch: ($, { payload }) =>
			$.evolve({ search: (search) => TextField.changed(search, payload) }),
		SelectedFilter: ($, { id }) => $.evolve({ filters: (filters) => toggleFilter(filters, id) }),
		ClearedFilter: ($, { field }) => $.evolve({ filters: (filters) => clearFilter(filters, field) }),
		PressedShowAllOwners: ($) => $.evolve({ filters: (filters) => clearFilter(filters, "owner") }),
		PressedClearNarrowing: ($) =>
			$.evolve({ search: (search) => TextField.set(search, ""), filters: clearNarrowing }),

		PressedRow: ($, { signalId }) => $.evolve({ selectedId: signalId, isPreviewOpen: true }),
		DismissedPreview: ($) => $.evolve({ isPreviewOpen: false }),
		PressedQueueKey: ($, { key }) => onKey($, key),
		SelectedAssign: ($, { id }) => assign($, $.model, id),
		SelectedSnooze: ($, { id }) => snooze($, id),
		PressedMarkDone: ($) => openDone($, $.model),
		PressedReopen: ($) => reopen($, $.model),
		PressedSignalRules: ($) =>
			$.props.session.orgSlug === null
				? $.model
				: $.run(
						Navigate.make({
							href: `/${$.props.session.orgSlug}/customers/settings/signals`,
							replace: false,
						}),
					),
		PressedRetryDetail: ($) => $.evolve({ detailAttempt: (attempt) => attempt + 1 }),
		PressedCopyEmail: ($, { email }) => $.run(CopyEmail.make({ email })),

		SucceededSignalAction: ($) => $.model,
		FailedSignalAction: ($, { action, reason }) =>
			$.run(ShowToast.make({ toast: errorToast(failureCopy(action, reason)) })),
		CopiedEmail: ($, { email }) => $.run(toast("Email copied", email)),
		FailedCopyEmail: ($) =>
			$.run(ShowToast.make({ toast: errorToast({ title: "Couldn't copy the email" }) })),
	},
	subscriptions: ({ props, model }) => {
		const organizationId = props.session.organization?.id ?? null
		const live = <A>(
			name: string,
			make: (queries: ReturnType<typeof makeCustomerQueries>, org: OrganizationId) => Stream.Stream<A>,
		) =>
			Subscription.make(name, [organizationId], ([org]) =>
				org === null ? Stream.empty : withData((data) => make(makeCustomerQueries(data), org)),
			)
		return [
			live("signals", (queries, org) =>
				queries.signalsStream(org, (signals) => M.UpdatedSignals({ signals })),
			),
			live("accounts", (queries, org) =>
				queries.accountsStream(org, (accounts) => M.UpdatedAccounts({ accounts })),
			),
			live("members", (queries, org) =>
				queries.orgMembersStream(org, (members) => M.UpdatedMembers({ members })),
			),
			live("lastComputedAt", (queries, org) =>
				queries.settingsSummaryStream(org, (settings) =>
					M.UpdatedLastComputedAt({ lastComputedAtMs: settings?.lastComputedAtMs ?? null }),
				),
			),
			// The platform skips keys while typing, or while a dialog or an open menu holds the keyboard.
			queueKeys(model.signals !== null, QUEUE_KEYS, (key) => M.PressedQueueKey({ key })),
		]
	},
	view: (h, model) => view(h, model),
})

function onKey($: Update, key: QueueKey): Step {
	const viewer = viewerOf($.props)
	const { model } = $
	return Match.value(key).pipe(
		// HAZEL-GAP(pk2-current-row-scroll): today the j/k row scrolls into view.
		Match.when("next", () => $.set(move(model, viewer, 1))),
		Match.when("previous", () => $.set(move(model, viewer, -1))),
		Match.when("preview", () =>
			model.isPreviewOpen
				? $.evolve({ isPreviewOpen: false })
				: $.set({ ...ensureSelection(model, viewer), isPreviewOpen: true }),
		),
		Match.when("close", () =>
			model.isPreviewOpen ? $.evolve({ isPreviewOpen: false }) : $.evolve({ selectedId: null }),
		),
		Match.when("open", () => openCustomer($)),
		Match.when("search", () => $.run(FocusSearch.make({}))),
		// HAZEL-GAP(pk2-menu-open): today A and H open the Assign and Snooze menus; a `menu` has no command to open it, so the keys only select a row.
		Match.when("assign", () => (model.tab !== "open" ? model : $.set(ensureSelection(model, viewer)))),
		Match.when("snooze", () => (model.tab === "done" ? model : $.set(ensureSelection(model, viewer)))),
		Match.when("assignToMe", () =>
			model.tab !== "open" ? model : withSelected($, (step, next) => assign(step, next, ASSIGN_ME)),
		),
		Match.when("done", () => withSelected($, openDone)),
		Match.when("reopen", () => withSelected($, reopen)),
		Match.exhaustive,
	)
}

// VIEW

const SHORTCUTS = {
	open: [
		{ keys: ["J", "K"], label: "Move" },
		{ keys: ["A"], label: "Assign" },
		{ keys: ["I"], label: "Assign to me" },
		{ keys: ["H"], label: "Snooze" },
		{ keys: ["D"], label: "Mark done" },
		{ keys: ["Enter"], label: "Open customer" },
		{ keys: ["Space"], label: "Preview" },
	],
	snoozed: [
		{ keys: ["J", "K"], label: "Move" },
		{ keys: ["W"], label: "Wake now" },
		{ keys: ["H"], label: "Change snooze" },
		{ keys: ["D"], label: "Mark done" },
		{ keys: ["Enter"], label: "Open customer" },
	],
	done: [
		{ keys: ["J", "K"], label: "Move" },
		{ keys: ["R"], label: "Reopen" },
		{ keys: ["Enter"], label: "Open customer" },
	],
} as const satisfies Record<Tab, ReadonlyArray<Shortcut>>

/** The selected signal's actions: Assign, Snooze and Done, or Wake now / Reopen. */
const signalActions = (h: H, model: AttentionModel, viewer: Viewer) => {
	const signal = selectedSignalOf(model)
	if (signal === undefined) return []
	const snoozeMenu = h.menu
		.label("Snooze")
		.entries(snoozeEntries(signal, viewer.nowMs))
		.trigger(
			queueAction(h, {
				label: signal.status === "snoozed" ? "Change snooze" : "Snooze",
				icon: "clock",
				shortcut: "H",
			}),
		)
		.on("select", ({ id }) => M.SelectedSnooze({ id }))
	const done = queueAction(h, { label: "Done", icon: "check", shortcut: "D", onPress: M.PressedMarkDone() })
	return Match.value(model.tab).pipe(
		Match.when("done", () =>
			canReopen(signal)
				? [
						queueAction(h, {
							label: "Reopen",
							icon: "refresh",
							shortcut: "R",
							onPress: M.PressedReopen(),
						}),
					]
				: [],
		),
		Match.when("snoozed", () => [
			queueAction(h, { label: "Wake now", icon: "refresh", shortcut: "W", onPress: M.PressedReopen() }),
			snoozeMenu,
			done,
		]),
		Match.when("open", () => [
			h.menu
				.label("Assign")
				.entries(assignEntries(model.members, viewer.userId))
				.trigger(queueAction(h, { label: "Assign", icon: "user", shortcut: "A" }))
				.on("select", ({ id }) => M.SelectedAssign({ id })),
			snoozeMenu,
			done,
		]),
		Match.exhaustive,
	)
}

const subtitleOf = (model: AttentionModel, viewer: Viewer): string => {
	if (model.signals === null || model.accounts === null) return "Loading..."
	const state = stateOf(model)
	const signals = visibleSignals(state, viewer)
	const whose = OWNER_SCOPE[model.filters.owner]
	const plural = (count: number) => (count === 1 ? "" : "s")
	if (signals.length === 0 && isNarrowed(state)) return "No signals match your search and filters"
	return Match.value(model.tab).pipe(
		Match.when("open", () => {
			if (signals.length === 0) return `Nothing${whose} needs you right now`
			const accountsById = accountsByIdOf(model)
			const highRiskMrr = [
				...new Set(
					signals
						.filter((signal) => signal.kind === "risk" && signal.severity === "high")
						.map((signal) => signal.accountId),
				),
			].reduce((sum, accountId) => sum + (accountsById.get(accountId)?.mrrMinor ?? 0), 0)
			const currency = model.accounts?.[0]?.currency ?? "USD"
			const risks = signals.filter((signal) => signal.kind === "risk").length
			return [
				`${signals.length} open signal${plural(signals.length)}${whose}`,
				`${risks} risk, ${signals.length - risks} opportunity`,
				...(highRiskMrr > 0
					? [`${formatMoney(highRiskMrr, currency)} MRR with a high-severity risk`]
					: []),
			].join(" · ")
		}),
		Match.when("snoozed", () => `${signals.length} snoozed signal${plural(signals.length)}${whose}`),
		Match.when(
			"done",
			() =>
				`${signals.length} signal${plural(signals.length)} muted, or resolved in the last 7 days · ${signals.filter((signal) => signal.status === "auto_resolved").length} cleared on their own`,
		),
		Match.exhaustive,
	)
}

const filterChips = (h: H, filters: Filters) => {
	const chip = (field: FilterField, label: string, value: string) =>
		filterChip(h, { field: label, operator: "is", value, onRemove: M.ClearedFilter({ field }) })
	return [
		filters.owner === "anyone" ? null : chip("owner", "Owner", OWNER_LABEL[filters.owner]),
		filters.kind === null ? null : chip("kind", "Kind", KIND_LABEL[filters.kind]),
		filters.template === null ? null : chip("template", "Signal", TEMPLATES[filters.template].name),
		filters.severity === null ? null : chip("severity", "Severity", SEVERITY_LABEL[filters.severity]),
		filters.plan === null ? null : chip("plan", "Plan", filters.plan),
	].filter((chip) => chip !== null)
}

const controls = (h: H, model: AttentionModel) =>
	filterBar(h, {
		start: [
			searchBox(h, {
				value: model.search,
				placeholder: "Search accounts...",
				onChange: (payload) => M.ChangedSearch({ payload }),
			}).ref(SearchRef),
			...filterChips(h, model.filters),
			h.menu
				.label("Filter")
				.entries(filterEntries(model.filters, plansOf(stateOf(model))))
				.trigger(addFilterButton(h))
				.on("select", ({ id }) => M.SelectedFilter({ id })),
		],
		end:
			model.tab === "open"
				? [
						h.menu
							.label("Sort")
							.entries(sortEntries(model.sort))
							.trigger(sortTrigger(h, { label: SORT_LABEL[model.sort] }))
							.on("select", ({ id }) => M.SelectedSort({ id })),
						h.choiceGroup
							.label("Group the queue by")
							.labelHidden()
							.style("segmented")
							.options([
								{ value: "signals", label: "Signals" },
								{ value: "accounts", label: "Accounts" },
							])
							.selected([model.grouping])
							.on("change", ({ selected }) => M.PickedGrouping({ selected })),
					]
				: undefined,
	})

const allClear = (h: H, model: AttentionModel, viewer: Viewer) => {
	const state = stateOf(model)
	const counts = tabCounts(state, viewer)
	const others = tabCounts({ ...state, filters: { ...state.filters, owner: "anyone" } }, viewer).open
	const upcoming = visibleSignals({ ...state, tab: "snoozed" }, viewer).slice(0, 3)
	const accountsById = accountsByIdOf(model)
	const waking =
		counts.snoozed > 0
			? `, and ${counts.snoozed} snoozed signal${counts.snoozed === 1 ? "" : "s"} will wake up`
			: ""
	return h.frame.key("all-clear").children(
		// HAZEL-GAP(pk2-empty-state-tile): today's all-clear leads with a success-toned check tile.
		h.emptyState
			.icon("check")
			.title("All clear")
			.description(
				`No open signals${OWNER_SCOPE[model.filters.owner]}. Hazel checks again every hour${waking}.`,
			)
			.action(
				h.stack
					.axis("horizontal")
					.density("compact")
					.children(
						counts.snoozed > 0
							? queueAction(h, {
									label: `View ${counts.snoozed} snoozed`,
									icon: "clock",
									onPress: M.PickedTab({ id: "snoozed" }),
								})
							: null,
						model.filters.owner !== "anyone" && others > 0
							? queueAction(h, {
									label: `Show all owners · ${others} open`,
									icon: "user",
									onPress: M.PressedShowAllOwners(),
								})
							: null,
					),
			),
		upcoming.length === 0
			? null
			: h.stack.density("compact").children(
					h.text.role("caption").tone("muted").children("Waking up next"),
					h.frame.surface("flush").children(
						...upcoming.flatMap((signal) => {
							const account = accountsById.get(signal.accountId)
							return account === undefined
								? []
								: [
										h.item
											.key(signal.id)
											.title(queueNameOf(account))
											.subtitle(signal.title)
											.leading(
												companyLogo(h, {
													name: account.name,
													logoUrl: account.logoUrl,
													size: "xs",
												}),
											)
											.trailing(
												h.text
													.role("caption")
													.tone("muted")
													.children(
														signal.snoozedUntilMs === null
															? ""
															: formatWeekdayTime(
																	new Date(signal.snoozedUntilMs),
																),
													),
											),
									]
						}),
					),
				),
	)
}

const list = (
	h: H,
	model: AttentionModel,
	viewer: Viewer,
	actions: ReadonlyArray<Hazel.NoTextInput<AttentionMessage>>,
) => {
	if (model.signals === null || model.accounts === null)
		return queueTable(h, { label: "Signals loading", loading: true }, [])
	const state = stateOf(model)
	const signals = visibleSignals(state, viewer)
	if (signals.length === 0 && isNarrowed(state))
		return noResultsState(h, {
			title: "No matches",
			description: "No signals in this tab match your search and filters.",
			onClear: M.PressedClearNarrowing(),
			clearLabel: "Clear search and filters",
		})
	if (signals.length === 0)
		return model.tab === "open"
			? allClear(h, model, viewer)
			: h.frame.children(
					h.emptyState.title(
						model.tab === "snoozed"
							? "Nothing is snoozed."
							: "Nothing muted, or resolved in the last 7 days.",
					),
				)
	const isPreviewShown = model.isPreviewOpen && selectedSignalOf(model) !== undefined
	const context: RowContext<AttentionMessage> = {
		nowMs: viewer.nowMs,
		accountsById: accountsByIdOf(model),
		environmentCounts: environmentCounts(model.accounts),
		membersById: new Map(model.members.map((member) => [member.id, member])),
		selectedId: model.selectedId,
		actions: isPreviewShown ? [] : actions,
		onPress: (signalId) => M.PressedRow({ signalId }),
	}
	const sort =
		model.tab === "open"
			? {
					column: model.sort === "priority" ? "rank" : model.sort,
					direction:
						SORT_ASCENDING[model.sort] !== model.isSortReversed
							? ("ascending" as const)
							: ("descending" as const),
				}
			: undefined
	const table = (
		label: string,
		columns: typeof SIGNAL_COLUMNS,
		rows: ReadonlyArray<Hazel.NoTextInput<AttentionMessage> | null>,
	) =>
		queueTable(
			h,
			{
				label,
				columns,
				sort,
				onSort: model.tab === "open" ? (column) => M.PressedColumnSort({ column }) : undefined,
			},
			rows.filter((row) => row !== null),
		)
	return Match.value(model.tab).pipe(
		Match.when("snoozed", () =>
			h.stack.density("compact").children(
				table(
					"Snoozed signals",
					SNOOZED_COLUMNS,
					signals.map((signal, index) =>
						snoozedRow(h, signal, context, accountRunOf(signals, index)),
					),
				),
				// HAZEL-GAP(pk2-table-footnote): today this note is the table's last row, under a hairline.
				h.stack
					.axis("horizontal")
					.density("tight")
					.align("center")
					.children(
						h.icon.name("refresh"),
						h.text
							.role("caption")
							.tone("muted")
							.children(
								"Snoozed signals return to Open at their wake time, or sooner if the evidence gets a full step worse.",
							),
					),
			),
		),
		Match.when("done", () =>
			table(
				"Resolved signals",
				DONE_COLUMNS,
				signals.map((signal, index) => doneRow(h, signal, context, accountRunOf(signals, index))),
			),
		),
		Match.when("open", () => {
			if (isPreviewShown)
				// HAZEL-GAP(pk2-table-headless): today the compact list beside the preview has no header row.
				return table(
					"Open signals",
					COMPACT_COLUMNS,
					model.grouping === "accounts"
						? accountGroups(signals).map((group, index) =>
								compactRow(h, group.lead, index + 1, context, NO_ACCOUNT_RUN),
							)
						: signals.map((signal, index) =>
								compactRow(h, signal, index + 1, context, accountRunOf(signals, index)),
							),
				)
			return model.grouping === "accounts"
				? table(
						"Accounts needing attention",
						GROUP_COLUMNS,
						accountGroups(signals).map((group, index) =>
							accountGroupRow(h, group, index + 1, context),
						),
					)
				: table(
						"Open signals",
						SIGNAL_COLUMNS,
						signals.map((signal, index) =>
							signalRow(h, signal, index + 1, context, accountRunOf(signals, index)),
						),
					)
		}),
		Match.exhaustive,
	)
}

const detailStateOf = (h: H): DetailState =>
	Match.value(h.queries.detail).pipe(
		Match.tag("Initial", (): DetailState => ({ _tag: "Loading" })),
		Match.tag("Failure", (): DetailState => ({ _tag: "Failed" })),
		Match.tag("Success", ({ value }): DetailState => ({ _tag: "Loaded", detail: value })),
		Match.exhaustive,
	)

const view = (h: H, model: AttentionModel) => {
	const viewer = viewerOf(h.props)
	const { session } = h.props
	const counts = tabCounts(stateOf(model), viewer)
	const selected = selectedSignalOf(model)
	const account = selected === undefined ? undefined : accountsByIdOf(model).get(selected.accountId)
	const actions = signalActions(h, model, viewer)
	const ids = rowIds(stateOf(model), viewer)
	const preview =
		model.isPreviewOpen && selected !== undefined && account !== undefined
			? previewPanel(h, {
					signal: selected,
					account,
					accounts: model.accounts ?? [],
					signals: model.signals ?? [],
					members: model.members,
					environmentCounts: environmentCounts(model.accounts ?? []),
					position: ids.indexOf(selected.id),
					total: ids.length,
					nowMs: viewer.nowMs,
					customerHref: customerHrefOf(session, account.id),
					actions,
					detail: detailStateOf(h),
					onClose: M.DismissedPreview(),
					onPressSignal: (signalId) => M.PressedRow({ signalId }),
					onRetry: M.PressedRetryDetail(),
					onCopyEmail: (email) => M.PressedCopyEmail({ email }),
				})
			: null
	// HAZEL-GAP(p4-screen-page-column): today's header is a padded, width-capped column under a display title.
	const page = h.screen
		.key("customers-attention")
		.surface("page")
		.title("Needs attention")
		.subtitle(subtitleOf(model, viewer))
		.toolbar(
			model.lastComputedAtMs === null
				? null
				: h.text
						.role("caption")
						.tone("muted")
						.dot()
						.children(
							`Evaluated ${formatRelative(new Date(model.lastComputedAtMs), new Date(viewer.nowMs))}`,
						),
			session.orgSlug === null
				? null
				: h.button
						.label("Signal rules")
						.icon("lightbulb")
						.variant("outline")
						.size("small")
						.on("press", M.PressedSignalRules()),
		)
		.children(
			h.scroll.inset("page").children(
				h.stack.children(
					viewTabs(h, {
						tabs: [
							{ key: "open", label: "Open", count: counts.open },
							{ key: "snoozed", label: "Snoozed", count: counts.snoozed },
							{ key: "done", label: "Done", count: counts.done },
						],
						selected: model.tab,
						onSelect: (tab) => M.PickedTab({ id: tab }),
					}),
					controls(h, model),
					list(h, model, viewer, actions),
					shortcutBar(h, SHORTCUTS[model.tab]),
				),
			),
		)
	const split = h.splitView.detailWidth(440).on("dismissDetail", M.DismissedPreview())
	return (preview === null ? split : split.detail(preview)).children(page)
}

/** The page with its Commands and the preview's query; the host provides `ClientData`, `HazelRpc`, `Clipboard`, `QueueKeyboard`. */
export const AttentionPage = AttentionPageNoDeps.pipe(
	Component.provide(
		Layer.mergeAll(
			GetAccountDetail.layer,
			AssignSignal.layer,
			SnoozeSignal.layer,
			ReopenSignal.layer,
			MuteCustomer.layer,
			CopyEmail.layer,
			FocusSearch.layer,
		),
	),
)
