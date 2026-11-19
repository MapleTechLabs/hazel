import { CustomerSavedViewId, CustomerViewLayoutId } from "@hazel/schema"
import { Effect, Option, Queue, Schema, Stream } from "effect"
import { Command, Subscription } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import type { SavedViewRow } from "../../../../customers/queries"
import { CURRENT_KEY } from "../../../../customers/view-layout"
import { labShared } from "../../../../page/customers/lab-shared"
import type { CreateSavedView, UpdateSavedView } from "../../../../page/customers/list/commands"
import { Message as ListMessage } from "../../../../page/customers/list/message"
import { Model as ListModel, type ViewRow } from "../../../../page/customers/list/model"
import { subscriptions as listSubscriptions, tabDragSubscriptions } from "../../../../page/customers/list/subscription"
import { routeChanged } from "../../../../page/customers/list/update"
import { view as listView } from "../../../../page/customers/list/view"
import { AppRoute } from "../../../../route"
import * as Sidebar from "../../../../shell/customers-sidebar"
import * as Menu from "../../../../ui/menu"
import type { Resources } from "../../../../rpc"
import { defineLabWithFlags, queryParam } from "../../../define"
import { labPage } from "../../../frame"
import { MAYA as ME, ORGANIZATION_ID } from "../../../fixtures/customers"
import { LIST_VIEWS, loadedList, stepList } from "./list"

// `/lab/customers/pages/saved-views`: the Customers sidebar beside the list, over one view layout.
// Drag a view in either (or Alt+arrow) and the other follows; hide one with the eye in the
// sidebar, show it again from the tab's ••• menu; "Edit name and icon…" sets its icon and colour.
// The saves are acted out here: the RPCs are dropped and both sides get the rows the sync would.

const STATES = ["default", "arranged"] as const
const State = Schema.Literals(STATES)

const RENEWALS_ID = "00000040-0000-4000-8000-000000000006"
const LAYOUT_ID = Schema.decodeSync(CustomerViewLayoutId)("00000000-0000-4000-8000-000000000060")

const Model = Schema.Struct({ sidebar: Sidebar.Model, list: ListModel })
type Model = typeof Model.Type

const Message = defineMessageUnion({
	GotSidebarMessage: { message: Sidebar.Message },
	GotListMessage: { message: ListMessage },
	ClickedSidebarView: { key: Schema.NullOr(Schema.String) },
	Ignored: {},
})
type Message = typeof Message.Type

const toSidebarRow = (view: ViewRow): SavedViewRow => ({
	id: view.id,
	name: view.name,
	builtInKey: view.builtInKey,
	ownerUserId: view.ownerUserId,
	position: view.position,
	icon: view.icon,
	color: view.color,
})

type Commands = ReadonlyArray<Command.Command<Message, never, Resources>>
type Result = { readonly model: Model; readonly commands?: Commands }

const sidebarStep = (model: Model, message: Sidebar.Message): Result => {
	const result = Sidebar.update(model.sidebar, message, ME.id)
	return {
		model: { ...model, sidebar: result.model },
		commands: Command.mapMessages(
			(result.commands ?? []).filter((command) => command.name !== "SaveSidebarLayout"),
			(child) => Message.GotSidebarMessage({ message: child }),
		),
	}
}

const withViews = (model: Model, views: ReadonlyArray<ViewRow>): Model => {
	const list = stepList(model.list, ListMessage.UpdatedViews({ views })).model
	const sidebar = Sidebar.update(
		model.sidebar,
		Sidebar.Message.UpdatedSavedViews({ organizationId: ORGANIZATION_ID, views: views.map(toSidebarRow) }),
		ME.id,
	).model
	return { ...model, list, sidebar }
}

type Dropped = ReturnType<typeof stepList>["dropped"]

/** The view saves the list sent, acted out as the sync would bring them back. */
const applyEdits = (model: Model, dropped: Dropped): Model =>
	dropped.reduce((current, command) => {
		const views = current.list.views ?? []
		if (command.name === "UpdateSavedView") {
			const { viewId, view } = command.args as ReturnType<typeof UpdateSavedView>["args"]
			return withViews(
				current,
				views.map((row) =>
					row.id === viewId
						? {
								...row,
								name: view.name,
								filters: view.filters,
								sort: view.sort,
								columns: view.columns,
								icon: view.icon === undefined ? row.icon : view.icon,
								color: view.color === undefined ? row.color : view.color,
							}
						: row,
				),
			)
		}
		if (command.name !== "CreateSavedView") return current
		const { view } = command.args as ReturnType<typeof CreateSavedView>["args"]
		const id = Schema.decodeSync(CustomerSavedViewId)(
			`00000040-0000-4000-8000-${String(100 + views.length).padStart(12, "0")}`,
		)
		const created: ViewRow = {
			id,
			name: view.name,
			builtInKey: null,
			ownerUserId: ME.id,
			position: views.length,
			filters: view.filters,
			sort: view.sort,
			columns: view.columns,
			icon: view.icon ?? null,
			color: view.color ?? null,
		}
		return withViews(current, [...views, created])
	}, model)

/** One side's layout changed: the other gets it as the synced row. */
const shareLayout = (before: Model, after: Model): Model => {
	if (after.sidebar.layout !== before.sidebar.layout && after.sidebar.layout !== null) {
		const layout = { id: LAYOUT_ID, ...after.sidebar.layout }
		return { ...after, list: stepList(after.list, ListMessage.UpdatedViewLayout({ layout })).model }
	}
	if (after.list.layout !== before.list.layout && after.list.layout !== null) {
		const layout = { id: LAYOUT_ID, ...after.list.layout }
		return {
			...after,
			sidebar: Sidebar.update(
				after.sidebar,
				Sidebar.Message.UpdatedViewLayout({ organizationId: ORGANIZATION_ID, layout }),
				ME.id,
			).model,
		}
	}
	return after
}

const routeOf = (view: string | null) =>
	AppRoute.CustomersList({ orgSlug: "lab", view: Option.fromNullishOr(view) })

const listStep = (model: Model, message: ListMessage): Result => {
	// Tabs navigate in the app; here they switch the view in place.
	const result =
		message._tag === "ClickedViewTab"
			? stepList(
					routeChanged(model.list, routeOf(message.key)).model,
					ListMessage.UpdatedViews({ views: model.list.views ?? [] }),
				)
			: stepList(model.list, message)
	return {
		model: shareLayout(model, applyEdits({ ...model, list: result.model }, result.dropped)),
		commands: Command.mapMessages(result.commands, (child) => Message.GotListMessage({ message: child })),
	}
}

const update = (model: Model, message: Message): Result =>
	Message.match<Result>(message, {
		GotSidebarMessage: ({ message: child }) => {
			const result = sidebarStep(model, child)
			return { ...result, model: shareLayout(model, result.model) }
		},
		GotListMessage: ({ message: child }) => listStep(model, child),
		ClickedSidebarView: ({ key }) => update(model, Message.GotListMessage({ message: ListMessage.ClickedViewTab({ key }) })),
		Ignored: () => ({ model }),
	})

const init = (state: typeof State.Type): Result => {
	const list = loadedList(null)
	const sidebar = Sidebar.update(
		Sidebar.setOrganization(Sidebar.init(), ORGANIZATION_ID),
		Sidebar.Message.UpdatedSavedViews({
			organizationId: ORGANIZATION_ID,
			views: LIST_VIEWS.map(toSidebarRow),
		}),
		ME.id,
	).model
	const base: Model = { sidebar, list: list.model }
	if (state === "default") return { model: base }
	// Renewals first, Churned out of the sidebar, All customers in it.
	const layout = {
		id: LAYOUT_ID,
		order: [RENEWALS_ID, CURRENT_KEY, "my_customers", "at_risk", "paying", "trialing", "churned", "all"],
		sidebarHidden: ["churned"],
	}
	return {
		model: {
			list: stepList(base.list, ListMessage.UpdatedViewLayout({ layout })).model,
			sidebar: Sidebar.update(
				base.sidebar,
				Sidebar.Message.UpdatedViewLayout({ organizationId: ORGANIZATION_ID, layout }),
				ME.id,
			).model,
		},
	}
}

// SUBSCRIPTIONS

/** The sidebar's links would leave the lab: a click picks the view in place instead. */
const sidebarClicks = Subscription.make<Model, Message>()((entry) => ({
	sidebarClicks: entry(
		{},
		{
			modelToDependencies: () => ({}),
			dependenciesToStream: () =>
				Stream.callback<Message>((queue) =>
					Effect.acquireRelease(
						Effect.sync(() => {
							const onClick = (event: MouseEvent) => {
								const target = event.target instanceof Element ? event.target : null
								const link = target?.closest("[data-lab-sidebar] a[href]")
								if (!(link instanceof HTMLAnchorElement)) return
								event.preventDefault()
								if (!link.pathname.endsWith("/customers/list")) return
								const key = new URL(link.href).searchParams.get("view")
								Queue.offerUnsafe(queue, Message.ClickedSidebarView({ key }))
							}
							document.addEventListener("click", onClick, true)
							return onClick
						}),
						(onClick) => Effect.sync(() => document.removeEventListener("click", onClick, true)),
					).pipe(Effect.flatMap(() => Effect.never)),
				),
		},
	),
}))

const sidebarDrag = Subscription.lift(Sidebar.dragSubscriptions)<Model, Message>({
	read: (model) =>
		Option.some({ organizationId: ORGANIZATION_ID, userId: ME.id, drag: model.sidebar.drag }),
	toParentMessage: (message) => Message.GotSidebarMessage({ message }),
})

const listLive = Subscription.lift({ keys: listSubscriptions.keys, ...tabDragSubscriptions })<Model, Message>({
	read: (model) => Option.some({ model: model.list, shared: labShared }),
	toParentMessage: (message) => Message.GotListMessage({ message }),
})

// VIEW

const CHROME = {
	userMenu: Menu.init({ id: "lab-user-menu" }),
	orgSwitcher: Menu.init({ id: "lab-org-switcher" }),
	userMenuEntries: [],
	orgSwitcherEntries: [],
	organizations: [],
	userStatus: null,
	statusExpiration: null,
	toUserMenuMessage: () => Message.Ignored(),
	toOrgSwitcherMessage: () => Message.Ignored(),
}

const currentState = () => new URLSearchParams(window.location.search).get("state") ?? "default"

const view = (model: Model, h: HtmlBuilder<Message>): Html =>
	labPage(
		h,
		{ title: "Customers saved views", switches: [{ name: "state", values: STATES, current: currentState() }] },
		[
			h.div(
				[h.Class("flex h-[calc(100dvh-57px)] border-border border-t")],
				[
					h.div(
						[h.Attribute("data-lab-sidebar", ""), h.Class("flex w-64 shrink-0 border-border border-r bg-sidebar")],
						[
							Sidebar.view(
								h,
								model.sidebar,
								{
									orgSlug: "lab",
									route: routeOf(model.list.view),
									organization: { name: "Northwind", logoUrl: null },
									currentUser: { displayName: ME.name, email: ME.email, avatarUrl: null },
									appVersion: "lab",
									paletteKey: null,
									createChannelKey: null,
								},
								CHROME,
								(message) => Message.GotSidebarMessage({ message }),
							),
						],
					),
					h.div(
						[h.Class("min-w-0 flex-1")],
						[
							h.submodel({
								slotId: "customers-list",
								model: model.list,
								view: listView,
								viewInputs: { shared: labShared },
								toParentMessage: (message: ListMessage) => Message.GotListMessage({ message }),
							}),
						],
					),
				],
			),
		],
	)

export const lab = defineLabWithFlags("Customers saved views", {
	Model,
	Flags: Schema.Struct({ state: State }),
	flags: Effect.all({ state: queryParam("state", STATES, "default") }),
	init: ({ state }) => init(state),
	update,
	view,
	subscriptions: Subscription.aggregate(sidebarClicks, sidebarDrag, listLive),
})
