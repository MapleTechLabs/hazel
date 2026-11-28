// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The Customers area's sidebar beside the nav rail (once `web-foldkit/src/shell/customers-sidebar.ts`):
 * Overview, Needs attention with the open signals on my accounts, the Support inbox with the issues
 * waiting on a reply that are mine or nobody's, the views in my own order (drag or Alt+Arrow to
 * reorder, the list's tabs follow; hide one but never the last), and the settings pages.
 */
import { Command, Subscription, UiSchema } from "@effect/ui"
import { ClientData, HazelRpc } from "@hazel/client-data"
import * as Customers from "@hazel/domain/customers"
import { CustomerViewLayoutId, OrganizationId, UserId } from "@hazel/schema"
import { Hazel } from "@hazel/ui/vocabulary/index"
import { Effect, Layer, Schema } from "effect"
import { AppToast, ShowToast } from "../app/requests"
import { withData } from "../app/live"
import { commonCopy, errorToast, reasonOf } from "../modals/feedback"
import { AccountMenu, AccountMenuProps } from "../shell/Chrome"
import { NavRow } from "../shell/SectionSidebar"
import { makeCustomerQueries, SavedViewRow, ViewLayoutRow } from "./data/queries"
import { makeIssueData } from "./data/issues"
import { lookOf, type ViewLook, viewGlyph } from "./ui/view-look"
import {
	ALL_KEY,
	arrange,
	canHideFromSidebar,
	CURRENT_KEY,
	layoutOf,
	makeViewLayoutActions,
	moveKey,
	reorderShown,
	sidebarKeysOf,
	withSidebar,
} from "./data/view-layout"

export const CustomersSidebarProps = Schema.Struct({
	organizationId: OrganizationId,
	userId: UserId,
	/** Overview, Needs attention, Support inbox, Support report; `customersAttention` and `customersInbox` take the counts. */
	pages: Schema.Array(NavRow),
	settings: Schema.Array(NavRow),
	/** The customer list's href; a view adds `?view=<key>` (none for "Current customers"). */
	listHref: Schema.String,
	/** The list's view shown (`current` for none), or null off the list. */
	currentView: Schema.NullOr(Schema.String),
	account: AccountMenuProps,
	/** A phone: a sheet its top bar opens; null on a wide screen, where the frame docks it. */
	sheet: Schema.NullOr(Schema.Struct({ open: Schema.Boolean })),
})
export type CustomersSidebarProps = typeof CustomersSidebarProps.Type

export const Model = Schema.Struct({
	attentionCount: Schema.NullOr(Schema.Finite),
	inboxCount: Schema.NullOr(Schema.Finite),
	/** Shared and my own views by position; null until they sync (the built-ins show). */
	views: Schema.NullOr(Schema.Array(SavedViewRow)),
	/** My saved layout; null before I arrange anything. */
	layout: Schema.NullOr(Customers.ViewLayoutDraft),
	layoutId: Schema.NullOr(CustomerViewLayoutId),
})
export type Model = typeof Model.Type

export const CustomersSidebarMessage = UiSchema.TaggedEnum({
	UpdatedAttentionCount: { count: Schema.Finite },
	UpdatedInboxCount: { count: Schema.Finite },
	UpdatedViews: { views: Schema.Array(SavedViewRow) },
	UpdatedLayout: { layout: Schema.NullOr(ViewLayoutRow) },
	MovedView: { id: Schema.String, before: Schema.NullOr(Schema.String) },
	PressedHideView: { key: Schema.String },
	/** The save answered: a toast when it failed. */
	CompletedSave: { toast: Schema.NullOr(AppToast) },
	CompletedToast: {},
	DismissedSheet: {},
})
export type CustomersSidebarMessage = typeof CustomersSidebarMessage.Type

export const CustomersSidebarEvents = UiSchema.TaggedEnum({ RequestedClose: {} })

/** Saves my whole layout; the synced row (the list's tabs too) shows it at once. */
export class SaveViewLayout extends Command.Service<SaveViewLayout>()("hazel/customers/SaveViewLayout", {
	args: {
		organizationId: OrganizationId,
		userId: UserId,
		layoutId: Schema.NullOr(CustomerViewLayoutId),
		layout: Customers.ViewLayoutDraft,
	},
	success: CustomersSidebarMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const data = yield* ClientData
			const rpc = yield* HazelRpc
			const { saveLayoutAction } = makeViewLayoutActions(data)
			return (args) =>
				saveLayoutAction(args).pipe(
					Effect.provideService(HazelRpc, rpc),
					Effect.as(CustomersSidebarMessage.CompletedSave({ toast: null })),
					// BOUNDARY: the optimistic layout rolls back; the reason is the toast.
					Effect.tapError((error) => Effect.logWarning("view layout save failed", error)),
					Effect.catch((error) =>
						Effect.succeed(
							CustomersSidebarMessage.CompletedSave({
								toast: errorToast(commonCopy(reasonOf(error))),
							}),
						),
					),
				)
		}),
	)
}

/** The seeded views, shown until the synced ones arrive (same keys, so the links stay put). */
const BUILT_IN_VIEWS: ReadonlyArray<{ readonly key: Customers.BuiltInViewKey; readonly name: string }> = [
	{ key: "my_customers", name: "My customers" },
	{ key: "paying", name: "Paying" },
	{ key: "trialing", name: "Trialing" },
	{ key: "churned", name: "Churned" },
]

export interface SidebarView {
	readonly key: string
	readonly name: string
	readonly look: ViewLook
}

/** Every view in my order: Current, the synced views (or the built-ins until they sync), All. */
export const allViewsOf = (model: Model): ReadonlyArray<SidebarView> =>
	arrange(
		[
			{ key: CURRENT_KEY, name: "Current customers", look: lookOf(CURRENT_KEY, null) },
			...(model.views === null
				? BUILT_IN_VIEWS.map(({ key, name }) => ({ key, name, look: lookOf(key, null) }))
				: model.views.map((view) => {
						const key = view.builtInKey ?? view.id
						return { key, name: view.name, look: lookOf(key, view) }
					})),
			{ key: ALL_KEY, name: "All customers", look: lookOf(ALL_KEY, null) },
		],
		(view) => view.key,
		layoutOf(model.layout).order,
	)

/** The views the sidebar shows, in my order: at least one. */
export const sidebarViewsOf = (model: Model): ReadonlyArray<SidebarView> => {
	const all = allViewsOf(model)
	const shown = new Set(
		sidebarKeysOf(
			layoutOf(model.layout),
			all.map((view) => view.key),
		),
	)
	return all.filter((view) => shown.has(view.key))
}

/** `keys` with `id` moved before `before` (null: the end), as a drop or Alt+Arrow reports it. */
export const movedBefore = (
	keys: ReadonlyArray<string>,
	id: string,
	before: string | null,
): ReadonlyArray<string> => {
	const rest = keys.filter((key) => key !== id)
	const index = before === null ? rest.length : rest.indexOf(before)
	return moveKey(keys, id, index === -1 ? rest.length : index)
}

const save = (props: CustomersSidebarProps, model: Model, layout: Customers.ViewLayoutDraft) =>
	SaveViewLayout.make({
		organizationId: props.organizationId,
		userId: props.userId,
		layoutId: model.layoutId,
		layout,
	})

export const CustomersSidebar = Hazel.component({
	name: "CustomersSidebar",
	props: CustomersSidebarProps,
	model: Model,
	message: CustomersSidebarMessage,
	events: CustomersSidebarEvents,
}).make({
	init: () => ({ attentionCount: null, inboxCount: null, views: null, layout: null, layoutId: null }),
	update: {
		UpdatedAttentionCount: ($, { count }) => $.evolve({ attentionCount: () => count }),
		UpdatedInboxCount: ($, { count }) => $.evolve({ inboxCount: () => count }),
		UpdatedViews: ($, { views }) => $.evolve({ views: () => views }),
		UpdatedLayout: ($, { layout }) =>
			$.evolve({
				layout: () => (layout === null ? null : layoutOf(layout)),
				layoutId: () => layout?.id ?? null,
			}),
		MovedView: ($, { id, before }) => {
			const all = allViewsOf($.model).map((view) => view.key)
			const shown = sidebarViewsOf($.model).map((view) => view.key)
			const current = layoutOf($.model.layout)
			const order = reorderShown(all, shown, movedBefore(shown, id, before))
			if (order.join() === current.order.join()) return $.model
			const layout = { ...current, order }
			return $.evolve({ layout: () => layout }).run(save($.props, $.model, layout))
		},
		PressedHideView: ($, { key }) => {
			const current = layoutOf($.model.layout)
			const keys = allViewsOf($.model).map((view) => view.key)
			if (!canHideFromSidebar(current, keys, key)) return $.model
			const layout = withSidebar(current, key, false)
			return $.evolve({ layout: () => layout }).run(save($.props, $.model, layout))
		},
		CompletedSave: ($, { toast }) =>
			toast === null
				? $.model
				: $.run(
						ShowToast.make({ toast }).pipe(
							Command.map(() => CustomersSidebarMessage.CompletedToast()),
						),
					),
		CompletedToast: ($) => $.model,
		DismissedSheet: ($) => $.emit(CustomersSidebarEvents.RequestedClose()),
	},
	subscriptions: ({ props }) => {
		const org = props.organizationId
		const user = props.userId
		// Each opens the org's customers source, so entering the area opens it.
		return [
			Subscription.make("attention", [org, user], ([o, u]) =>
				withData((data) =>
					makeCustomerQueries(data).myOpenSignalCountStream(o, u, (count) =>
						CustomersSidebarMessage.UpdatedAttentionCount({ count }),
					),
				),
			),
			Subscription.make("inbox", [org, user], ([o, u]) =>
				withData((data) =>
					makeIssueData(data).myWaitingIssueCountStream(o, u, (count) =>
						CustomersSidebarMessage.UpdatedInboxCount({ count }),
					),
				),
			),
			Subscription.make("views", [org, user], ([o, u]) =>
				withData((data) =>
					makeCustomerQueries(data).savedViewsStream(o, u, (views) =>
						CustomersSidebarMessage.UpdatedViews({ views }),
					),
				),
			),
			Subscription.make("layout", [org, user], ([o, u]) =>
				withData((data) =>
					makeCustomerQueries(data).viewLayoutStream(o, u, (layout) =>
						CustomersSidebarMessage.UpdatedLayout({ layout }),
					),
				),
			),
		]
	},
	view: (h, model) => {
		const { props } = h
		const countOf = (id: string) =>
			id === "customersAttention"
				? (model.attentionCount ?? 0)
				: id === "customersInbox"
					? (model.inboxCount ?? 0)
					: 0
		const row = (item: NavRow) =>
			h.item
				.key(item.id)
				.title(item.label)
				.style("nav")
				.leading(h.icon.name(item.icon))
				.badge(countOf(item.id))
				.selected(item.selected)
				.href(item.href)
		const views = sidebarViewsOf(model)
		const viewHref = (key: string) =>
			key === CURRENT_KEY ? props.listHref : `${props.listHref}?view=${encodeURIComponent(key)}`
		const viewRow = (view: SidebarView) =>
			h.item
				.key(view.key)
				.title(view.name)
				.style("nav")
				.leading(viewGlyph(h, view.look))
				.selected(props.currentView === view.key)
				.href(viewHref(view.key))
				.actions(
					views.length === 1
						? null
						: h.button
								.icon("eye-off")
								.iconOnly()
								.variant("ghost")
								.size("xsmall")
								.label(`Hide ${view.name} from the sidebar`)
								.on("press", CustomersSidebarMessage.PressedHideView({ key: view.key })),
				)
		const docked = props.sheet === null
		const body = h.stack.density("tight").children(
			docked ? null : h.text.key("label").role("overline").tone("muted").children("Customers"),
			docked ? null : h.divider,
			h.section.key("pages").children(...props.pages.map(row)),
			h.section
				.key("views")
				.title("Customers")
				.reorderable()
				.on("move", ({ id, before }) => CustomersSidebarMessage.MovedView({ id, before }))
				.children(...views.map(viewRow)),
			h.section
				.key("settings")
				.title("Settings")
				.children(...props.settings.map(row)),
			docked ? null : h.spacer,
			docked ? null : AccountMenu(h, { key: "account", props: props.account }),
		)
		return docked
			? body
			: h.sheet
					.open(props.sheet?.open ?? false)
					.on("dismiss", () => CustomersSidebarMessage.DismissedSheet())
					.children(body)
	},
})

/** What a host provides: its data instance and RPC client (the save); toasts go through the app's requests. */
export const customersSidebarLayer = (data: ClientData["Service"], rpc: HazelRpc["Service"]) =>
	SaveViewLayout.layer.pipe(
		Layer.provideMerge(Layer.mergeAll(Layer.succeed(ClientData, data), Layer.succeed(HazelRpc, rpc))),
	)
