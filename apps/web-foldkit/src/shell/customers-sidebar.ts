import * as Customers from "@hazel/domain/customers"
import { CustomerViewLayoutId, OrganizationId, UserId } from "@hazel/schema"
import { DragAndDrop } from "@foldkit/ui"
import { Effect, Option, Schema, Stream } from "effect"
import { Command, Subscription, Update } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"
import { CommonReason } from "~/lib/error-messages"
import {
	myOpenSignalCountStream,
	SavedViewRow,
	savedViewsStream,
	ViewLayoutRow,
	viewLayoutStream,
} from "../customers/queries"
import { dragGhost, sortableList, sortableRow } from "../customers/ui/sortable"
import { lookOf, type ViewLook, viewGlyph } from "../customers/ui/view-look"
import {
	ALL_KEY,
	arrange,
	CURRENT_KEY,
	isInSidebar,
	layoutOf,
	moveKey,
	reorderShown,
	saveLayoutAction,
	stepKey,
	withSidebar,
} from "../customers/view-layout"
import { catchCommon, reasonToast } from "../data/actions"
import { IconEyeSlash } from "../icons"
import { PageOutMessage } from "../page/out-message"
import { type AppRoute, customersListRoute, hrefOf, type RouteTag } from "../route"
import { sidebarHeaderHeightClass } from "../platform/desktop"
import { myWaitingIssueCountStream } from "../customers/issues"
import type { HazelRpc } from "../rpc"
import { button } from "../ui/button"
import {
	sidebarContent,
	sidebarHeader,
	sidebarItem,
	sidebarLabel,
	sidebarLink,
	sidebarSection,
	sidebarSectionGroup,
	sidebarStatic,
} from "../ui/sidebar"
import type { SidebarChrome } from "./channels-sidebar"
import type { ShellContext } from "./context"
import { type DestinationId, destination, destinationHref, isAvailable } from "./destinations"
import { userMenuFooter } from "./menus"

/**
 * The Customers area's sidebar next to the nav rail (`docs/customers/spec.md` "UI surfaces"):
 * Overview, Needs attention with the count of open signals on my accounts, the Support inbox with
 * the issues waiting on a reply that are mine or nobody's, Customers and the views
 * (in the person's own order, without the ones they hid: `customers/view-layout.ts`; dragging one
 * reorders the list's tabs too), and the settings pages. Shell state: it survives navigation
 * inside the area.
 */

// MODEL

export const VIEWS_LIST_ID = "customers-sidebar-views"

export const Model = Schema.Struct({
	/** The organization the rows below are for (the root's); another one clears them. */
	organizationId: Schema.NullOr(OrganizationId),
	/** Open signals on accounts I own; null until the query answers. */
	attentionCount: Schema.NullOr(Schema.Int),
	/** Support issues waiting on a reply, mine or unassigned; null until the query answers. */
	inboxCount: Schema.NullOr(Schema.Int),
	/** Shared and my own views by position; null until the query answers (the built-ins show). */
	views: Schema.NullOr(Schema.Array(SavedViewRow)),
	/** My saved layout; null before I arrange anything (or until it syncs). */
	layout: Schema.NullOr(Customers.ViewLayoutDraft),
	/** Its synced row's id: null before the first save. */
	layoutId: Schema.NullOr(CustomerViewLayoutId),
	drag: DragAndDrop.Model,
})
export type Model = typeof Model.Type

export const init = (): Model => ({
	organizationId: null,
	attentionCount: null,
	inboxCount: null,
	views: null,
	layout: null,
	layoutId: null,
	drag: DragAndDrop.init({ id: VIEWS_LIST_ID }),
})

/** The root's organization: switching to another drops the previous one's rows. */
export const setOrganization = (model: Model, organizationId: OrganizationId | null): Model =>
	model.organizationId === organizationId ? model : { ...init(), organizationId }

// MESSAGE

/** The rows name their organization: one still in flight from the previous one is dropped. */
export const Message = defineMessageUnion({
	UpdatedAttentionCount: { organizationId: OrganizationId, count: Schema.Int },
	UpdatedInboxCount: { organizationId: OrganizationId, count: Schema.Int },
	UpdatedSavedViews: { organizationId: OrganizationId, views: Schema.Array(SavedViewRow) },
	UpdatedViewLayout: { organizationId: OrganizationId, layout: Schema.NullOr(ViewLayoutRow) },
	GotDragMessage: { message: DragAndDrop.Message },
	SteppedView: { key: Schema.String, step: Schema.Literals([-1, 1]) },
	PressedHideView: { key: Schema.String },
	CompletedSaveLayout: {},
	FailedSaveLayout: { reason: CommonReason },
})
export type Message = typeof Message.Type

// VIEWS

/** The seeded views, shown until the synced ones arrive (same keys, so the links stay put). */
const BUILT_IN_VIEWS: ReadonlyArray<{ readonly key: Customers.BuiltInViewKey; readonly name: string }> = [
	{ key: "my_customers", name: "My customers" },
	{ key: "paying", name: "Paying" },
	{ key: "trialing", name: "Trialing" },
	{ key: "at_risk", name: "At risk" },
	{ key: "churned", name: "Churned" },
]

export interface SidebarView {
	/** The layout key, also `?view=` (but "Current customers" has none). */
	readonly key: string
	readonly name: string
	readonly look: ViewLook
}

/** Every view in my order: Current, the synced views (or the built-ins until they sync), All. */
const allViewsOf = (model: Model): ReadonlyArray<SidebarView> =>
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

/** The views the sidebar shows, in my order. */
export const sidebarViewsOf = (model: Model): ReadonlyArray<SidebarView> => {
	const layout = layoutOf(model.layout)
	return allViewsOf(model).filter((view) => isInSidebar(layout, view.key))
}

// UPDATE

export type Return = Update.ReturnWithOutMessage<Model, Message, PageOutMessage, HazelRpc>

export const SaveSidebarLayout = Command.define("SaveSidebarLayout", {
	args: {
		organizationId: OrganizationId,
		userId: UserId,
		layoutId: Schema.NullOr(CustomerViewLayoutId),
		order: Schema.Array(Schema.String),
		sidebarHidden: Schema.Array(Schema.String),
	},
	messages: [Message.CompletedSaveLayout, Message.FailedSaveLayout],
	execute: ({ order, sidebarHidden, ...rest }) =>
		saveLayoutAction({ ...rest, layout: { order, sidebarHidden } }).pipe(
			Effect.as(Message.CompletedSaveLayout()),
			catchCommon((reason) => Message.FailedSaveLayout({ reason })),
		),
})

/** The layout saved, and shown at once (the synced row follows). */
const withLayout = (
	model: Model,
	userId: UserId | null,
	layout: Customers.ViewLayoutDraft,
	commands: NonNullable<Return["commands"]> = [],
): Return => {
	if (model.organizationId === null || userId === null) return { model, commands }
	return {
		model: modifyFields(model, { layout: () => layout }),
		commands: [
			...commands,
			SaveSidebarLayout({
				organizationId: model.organizationId,
				userId,
				layoutId: model.layoutId,
				...layout,
			}),
		],
	}
}

const reorder = (
	model: Model,
	userId: UserId | null,
	change: (keys: ReadonlyArray<string>) => ReadonlyArray<string>,
	commands: NonNullable<Return["commands"]> = [],
): Return => {
	const all = allViewsOf(model).map((view) => view.key)
	const shown = sidebarViewsOf(model).map((view) => view.key)
	const layout = layoutOf(model.layout)
	return withLayout(model, userId, { ...layout, order: reorderShown(all, shown, change(shown)) }, commands)
}

const updateDrag = (model: Model, message: DragAndDrop.Message, userId: UserId | null): Return => {
	const result = DragAndDrop.update(model.drag, message)
	const next = modifyFields(model, { drag: () => result.model })
	const commands = Command.mapMessages(result.commands ?? [], (child) =>
		Message.GotDragMessage({ message: child }),
	)
	const out = result.outMessage
	return out?._tag === "Reordered" && out.fromIndex !== out.toIndex
		? reorder(next, userId, (keys) => moveKey(keys, out.itemId, out.toIndex), commands)
		: { model: next, commands }
}

export const update = (model: Model, message: Message, userId: UserId | null): Return =>
	Message.match<Return>(message, {
		UpdatedAttentionCount: ({ organizationId, count }) => ({
			model:
				organizationId === model.organizationId
					? modifyFields(model, { attentionCount: () => count })
					: model,
		}),
		UpdatedInboxCount: ({ organizationId, count }) => ({
			model:
				organizationId === model.organizationId
					? modifyFields(model, { inboxCount: () => count })
					: model,
		}),
		UpdatedSavedViews: ({ organizationId, views }) => ({
			model:
				organizationId === model.organizationId ? modifyFields(model, { views: () => views }) : model,
		}),
		UpdatedViewLayout: ({ organizationId, layout }) => ({
			model:
				organizationId === model.organizationId
					? modifyFields(model, {
							layout: () => (layout === null ? null : layoutOf(layout)),
							layoutId: () => layout?.id ?? null,
						})
					: model,
		}),
		GotDragMessage: ({ message: dragMessage }) => updateDrag(model, dragMessage, userId),
		SteppedView: ({ key, step }) =>
			reorder(
				model,
				userId,
				(keys) => stepKey(keys, key, step),
				Command.mapMessages([DragAndDrop.FocusItem({ itemId: key })], (child) =>
					Message.GotDragMessage({ message: child }),
				),
			),
		PressedHideView: ({ key }) =>
			withLayout(model, userId, withSidebar(layoutOf(model.layout), key, false)),
		CompletedSaveLayout: () => ({ model }),
		FailedSaveLayout: ({ reason }) => ({
			model,
			outMessage: PageOutMessage.RequestedToast({ toast: reasonToast(reason) }),
		}),
	})

// SUBSCRIPTIONS

/** Present while a customers route shows: the org, the signed-in user and the drag. */
export interface Input {
	readonly organizationId: OrganizationId | null
	readonly userId: UserId | null
	readonly drag: DragAndDrop.Model
}

const dependencies = { organizationId: Schema.NullOr(OrganizationId), userId: Schema.NullOr(UserId) }
const toDependencies = ({ organizationId, userId }: Input) => ({ organizationId, userId })

/** Each opens the org's customers source (`withCustomersSource`), so entering the area opens it. */
const rows = Subscription.make<Input, Message>()((entry) => ({
	customersAttentionCount: entry(dependencies, {
		modelToDependencies: toDependencies,
		dependenciesToStream: ({ organizationId, userId }) =>
			organizationId === null || userId === null
				? Stream.empty
				: myOpenSignalCountStream(organizationId, userId, (count) =>
						Message.UpdatedAttentionCount({ organizationId, count }),
					),
	}),
	customersInboxCount: entry(dependencies, {
		modelToDependencies: toDependencies,
		dependenciesToStream: ({ organizationId, userId }) =>
			organizationId === null || userId === null
				? Stream.empty
				: myWaitingIssueCountStream(organizationId, userId, (count) =>
						Message.UpdatedInboxCount({ organizationId, count }),
					),
	}),
	customersSavedViews: entry(dependencies, {
		modelToDependencies: toDependencies,
		dependenciesToStream: ({ organizationId, userId }) =>
			organizationId === null || userId === null
				? Stream.empty
				: savedViewsStream(organizationId, userId, (views) =>
						Message.UpdatedSavedViews({ organizationId, views }),
					),
	}),
	customersViewLayout: entry(dependencies, {
		modelToDependencies: toDependencies,
		dependenciesToStream: ({ organizationId, userId }) =>
			organizationId === null || userId === null
				? Stream.empty
				: viewLayoutStream(organizationId, userId, (layout) =>
						Message.UpdatedViewLayout({ organizationId, layout }),
					),
	}),
}))

const drag = Subscription.lift(DragAndDrop.subscriptions)<Input, Message>({
	read: (input) => Option.some(input.drag),
	toParentMessage: (message) => Message.GotDragMessage({ message }),
})

/** The drag's document listeners, under keys no other shell entry uses. */
export const dragSubscriptions = {
	customersViewDragPointer: drag.documentPointer,
	customersViewDragEscape: drag.documentEscape,
	customersViewDragScroll: drag.autoScroll,
}

export const subscriptions = Subscription.aggregate(rows, dragSubscriptions)

// VIEW

const SECTION_ACTIVE = "bg-sidebar-accent font-medium text-sidebar-accent-fg"

const badge = <M>(h: HtmlBuilder<M>, count: number): Html =>
	h.span(
		[
			h.Attribute("data-slot", "sidebar-badge"),
			h.AriaLabel(`${count} open`),
			h.Class(
				"ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 font-medium text-2xs text-primary-fg tabular-nums",
			),
		],
		[count > 99 ? "99+" : String(count)],
	)

/** The list route's view key (`current` for none) when the list shows, else undefined. */
const listViewOf = (route: AppRoute): string | undefined =>
	route._tag === "CustomersList" ? Option.getOrElse(route.view, () => CURRENT_KEY) : undefined

/** The sidebar's views: drag to reorder (the list's tabs follow), the eye hides one. */
const viewsSection = <ParentMessage>(
	h: HtmlBuilder<ParentMessage>,
	model: Model,
	views: ReadonlyArray<SidebarView>,
	orgSlug: string,
	listView: string | undefined,
	toParentMessage: (message: Message) => ParentMessage,
): Html => {
	const dragged = views.find(
		(view) => view.key === Option.getOrNull(DragAndDrop.maybeDraggedItemId(model.drag)),
	)
	return sidebarSection(h, { label: "Views", listAttributes: [sortableList(h, VIEWS_LIST_ID)] }, [
		...views.map((view, index) => {
			const isCurrent = listView === view.key
			const row = sortableRow(h, {
				drag: model.drag,
				containerId: VIEWS_LIST_ID,
				itemId: view.key,
				index,
				count: views.length,
				orientation: "Vertical",
				toDragMessage: (message) => toParentMessage(Message.GotDragMessage({ message })),
				onStep: (step) => toParentMessage(Message.SteppedView({ key: view.key, step })),
			})
			return sidebarItem(h, { isCurrent, attributes: [h.Key(view.key)] }, [
				sidebarLink(
					h,
					{
						href: hrefOf(customersListRoute(orgSlug, view.key === CURRENT_KEY ? null : view.key)),
						isActive: isCurrent,
						activeClassName: SECTION_ACTIVE,
						className: row.className,
						attributes: row.attributes,
					},
					[viewGlyph(h, view.look), sidebarLabel(h, [view.name])],
				),
				button(
					h,
					{
						intent: "plain",
						size: "xs",
						onPress: toParentMessage(Message.PressedHideView({ key: view.key })),
						attributes: [
							h.Attribute("data-slot", "menu-trigger"),
							h.AriaLabel(`Hide ${view.name} from the sidebar`),
							h.Title("Hide from sidebar"),
						],
					},
					[IconEyeSlash(h, { className: "size-4" })],
				),
			])
		}),
		dragged === undefined
			? h.empty
			: dragGhost(h, model.drag, [viewGlyph(h, dragged.look), h.span([], [dragged.name])]),
	])
}

export const view = <ParentMessage>(
	h: HtmlBuilder<ParentMessage>,
	model: Model,
	context: ShellContext,
	chrome: SidebarChrome<ParentMessage>,
	toParentMessage: (message: Message) => ParentMessage,
): Html => {
	const { orgSlug, route } = context
	const item = (id: DestinationId, isCurrent: boolean, trailing: ReadonlyArray<Html> = []) => {
		if (!isAvailable(id)) return h.empty
		const { icon, label: name, sidebarLabel: label = name } = destination(id)
		return sidebarItem(h, { isCurrent }, [
			sidebarLink(
				h,
				{ href: destinationHref(id, orgSlug), isActive: isCurrent, activeClassName: SECTION_ACTIVE },
				[
					icon(h, { attributes: { "data-slot": "icon" } }),
					// The row's grid has no column after the label: a badge shares the label's cell, or it wraps.
					trailing.length === 0
						? sidebarLabel(h, [label])
						: h.span(
								[h.Class("col-start-2 flex min-w-0 items-center gap-2")],
								[sidebarLabel(h, [label]), ...trailing],
							),
				],
			),
		])
	}
	const on = (...tags: ReadonlyArray<RouteTag>) => tags.includes(route._tag)
	const listView = listViewOf(route)
	const views = sidebarViewsOf(model)
	const count = model.attentionCount ?? 0
	const inboxCount = model.inboxCount ?? 0

	return sidebarStatic(h, "flex flex-1", [
		sidebarHeader(h, { state: "expanded", className: `border-b py-4 ${sidebarHeaderHeightClass()}` }, [
			h.span([h.Class("text-muted-fg text-xs font-medium uppercase tracking-wider")], ["Customers"]),
		]),
		sidebarContent(h, { state: "expanded" }, [
			sidebarSectionGroup(h, [
				sidebarSection(h, {}, [
					item("customersOverview", on("CustomersOverview")),
					item("customersAttention", on("CustomersAttention"), count > 0 ? [badge(h, count)] : []),
					item(
						"customersInbox",
						on("CustomersInbox"),
						inboxCount > 0 ? [badge(h, inboxCount)] : [],
					),
					item("customersSupportReport", on("CustomersSupportReport")),
					item(
						"customersList",
						// The list's view lights its own row; a hidden one lights this.
						on("CustomerDetail") ||
							(listView !== undefined && !views.some((view) => view.key === listView)),
					),
				]),
				viewsSection(h, model, views, orgSlug, listView, toParentMessage),
				sidebarSection(h, { label: "Settings" }, [
					item(
						"customersSignals",
						on(
							"CustomersSettingsSignals",
							"CustomersSettingsSignalNew",
							"CustomersSettingsSignalRule",
						),
					),
					item("customersHealth", on("CustomersSettingsHealth")),
					item("customersSla", on("CustomersSettingsSla")),
					item("customersPlans", on("CustomersSettingsPlans")),
					item("customersFeatureFlags", on("CustomersSettingsFeatureFlags")),
					item(
						"customersSources",
						on("CustomersSettingsSources", "CustomersSourceDetail", "CustomersUnmatched"),
					),
				]),
			]),
		]),
		userMenuFooter(
			h,
			chrome.userMenu,
			chrome.userMenuEntries,
			context,
			chrome.toUserMenuMessage,
			chrome.userStatus,
			chrome.statusExpiration,
		),
	])
}
