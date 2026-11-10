import type * as Customers from "@hazel/domain/customers"
import { OrganizationId, UserId } from "@hazel/schema"
import { Schema, Stream } from "effect"
import { Subscription } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"
import { twMerge } from "tailwind-merge"
import { myOpenSignalCountStream, SavedViewRow, savedViewsStream } from "../customers/queries"
import {
	IconHeart,
	IconLightbulb,
	IconOffice,
	IconPresentationChart,
	IconServers,
	IconUser,
	IconWarning,
} from "../icons"
import { AppRoute, customersListRoute, hrefOf, type RouteTag } from "../route"
import { sidebarHeaderHeightClass } from "../platform/desktop"
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
import { userMenuFooter } from "./menus"

/**
 * The Customers area's sidebar next to the nav rail (`docs/customers/spec.md` "UI surfaces"):
 * Overview, Needs attention with the count of open signals on my accounts, Customers and its saved
 * views, and the settings pages. Shell state: it survives navigation inside the area.
 */

// MODEL

export const Model = Schema.Struct({
	/** Open signals on accounts I own; null until the query answers. */
	attentionCount: Schema.NullOr(Schema.Int),
	/** Shared and my own views in tab order; null until the query answers (the built-ins show). */
	views: Schema.NullOr(Schema.Array(SavedViewRow)),
})
export type Model = typeof Model.Type

export const init = (): Model => ({ attentionCount: null, views: null })

// MESSAGE

export const Message = defineMessageUnion({
	UpdatedAttentionCount: { count: Schema.Int },
	UpdatedSavedViews: { views: Schema.Array(SavedViewRow) },
})
export type Message = typeof Message.Type

export const update = (model: Model, message: Message): { readonly model: Model } =>
	Message.match(message, {
		UpdatedAttentionCount: ({ count }) => ({
			model: modifyFields(model, { attentionCount: () => count }),
		}),
		UpdatedSavedViews: ({ views }) => ({ model: modifyFields(model, { views: () => views }) }),
	})

// SUBSCRIPTIONS

/** Present while a customers route shows: the org and the signed-in user. */
export interface Input {
	readonly organizationId: OrganizationId | null
	readonly userId: UserId | null
}

const dependencies = { organizationId: Schema.NullOr(OrganizationId), userId: Schema.NullOr(UserId) }

/** Both open the org's customers source (`withCustomersSource`), so entering the area opens it. */
export const subscriptions = Subscription.make<Input, Message>()((entry) => ({
	customersAttentionCount: entry(dependencies, {
		modelToDependencies: (input) => input,
		dependenciesToStream: ({ organizationId, userId }) =>
			organizationId === null || userId === null
				? Stream.empty
				: myOpenSignalCountStream(organizationId, userId, (count) =>
						Message.UpdatedAttentionCount({ count }),
					),
	}),
	customersSavedViews: entry(dependencies, {
		modelToDependencies: (input) => input,
		dependenciesToStream: ({ organizationId, userId }) =>
			organizationId === null || userId === null
				? Stream.empty
				: savedViewsStream(organizationId, userId, (views) => Message.UpdatedSavedViews({ views })),
	}),
}))

// VIEW

const SECTION_ACTIVE = "bg-sidebar-accent font-medium text-sidebar-accent-fg"

/** The seeded views, shown until the synced ones arrive (same keys, so the links stay put). */
const BUILT_IN_VIEWS: ReadonlyArray<{ readonly key: Customers.BuiltInViewKey; readonly name: string }> = [
	{ key: "my_customers", name: "My customers" },
	{ key: "paying", name: "Paying" },
	{ key: "trialing", name: "Trialing" },
	{ key: "at_risk", name: "At risk" },
	{ key: "churned", name: "Churned" },
]

const VIEW_DOT = {
	my_customers: "",
	paying: "bg-health-healthy",
	trialing: "bg-blue-light-400",
	at_risk: "bg-health-at-risk",
	churned: "bg-health-unknown",
} as const satisfies Record<Customers.BuiltInViewKey, string>

interface SidebarView {
	/** What `?view=` carries: a built-in's key, else the view's id. */
	readonly param: string
	readonly name: string
	readonly builtInKey: Customers.BuiltInViewKey | null
}

const sidebarViewsOf = (model: Model): ReadonlyArray<SidebarView> =>
	model.views === null
		? BUILT_IN_VIEWS.map(({ key, name }) => ({ param: key, name, builtInKey: key }))
		: model.views.map((view) => ({
				param: view.builtInKey ?? view.id,
				name: view.name,
				builtInKey: view.builtInKey,
			}))

const badge = <M>(h: HtmlBuilder<M>, count: number): Html =>
	h.span(
		[
			h.Attribute("data-slot", "sidebar-badge"),
			h.AriaLabel(`${count} open`),
			h.Class(
				"ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 font-medium text-[11px] text-primary-fg tabular-nums",
			),
		],
		[count > 99 ? "99+" : String(count)],
	)

const viewIcon = <M>(h: HtmlBuilder<M>, view: SidebarView): Html =>
	view.builtInKey === "my_customers"
		? IconUser(h, { attributes: { "data-slot": "icon" } })
		: h.span(
				[h.Attribute("data-slot", "icon"), h.Class("flex items-center justify-center")],
				[
					h.span([
						h.Class(
							twMerge(
								"size-2 rounded-full bg-muted-fg/60",
								view.builtInKey === null ? "" : VIEW_DOT[view.builtInKey],
							),
						),
					]),
				],
			)

/** The list route's `?view=` when the list shows, else undefined. */
const listViewOf = (route: AppRoute): string | null | undefined =>
	route._tag === "CustomersList" ? (route.view._tag === "Some" ? route.view.value : null) : undefined

export const view = <ParentMessage>(
	h: HtmlBuilder<ParentMessage>,
	model: Model,
	context: ShellContext,
	chrome: SidebarChrome<ParentMessage>,
): Html => {
	const { orgSlug, route } = context
	const item = (
		label: string,
		href: string,
		isCurrent: boolean,
		icon: Html,
		trailing: ReadonlyArray<Html> = [],
	) =>
		sidebarItem(h, { isCurrent }, [
			sidebarLink(h, { href, isActive: isCurrent, activeClassName: SECTION_ACTIVE }, [
				icon,
				sidebarLabel(h, [label]),
				...trailing,
			]),
		])
	const on = (...tags: ReadonlyArray<RouteTag>) => tags.includes(route._tag)
	const icon = (glyph: typeof IconOffice) => glyph(h, { attributes: { "data-slot": "icon" } })
	const listView = listViewOf(route)
	const count = model.attentionCount ?? 0

	return sidebarStatic(h, "flex flex-1", [
		sidebarHeader(h, { state: "expanded", className: `border-b py-4 ${sidebarHeaderHeightClass()}` }, [
			h.span([h.Class("text-muted-fg text-xs font-medium uppercase tracking-wider")], ["Customers"]),
		]),
		sidebarContent(h, { state: "expanded" }, [
			sidebarSectionGroup(h, [
				sidebarSection(h, {}, [
					item(
						"Overview",
						hrefOf(AppRoute.CustomersOverview({ orgSlug })),
						on("CustomersOverview"),
						icon(IconPresentationChart),
					),
					item(
						"Needs attention",
						hrefOf(AppRoute.CustomersAttention({ orgSlug })),
						on("CustomersAttention"),
						icon(IconWarning),
						count > 0 ? [badge(h, count)] : [],
					),
					item(
						"Customers",
						hrefOf(customersListRoute(orgSlug)),
						listView === null || on("CustomerDetail"),
						icon(IconOffice),
					),
				]),
				sidebarSection(
					h,
					{ label: "Saved views" },
					sidebarViewsOf(model).map((view) =>
						item(
							view.name,
							hrefOf(customersListRoute(orgSlug, view.param)),
							listView === view.param,
							viewIcon(h, view),
						),
					),
				),
				sidebarSection(h, { label: "Settings" }, [
					item(
						"Signals",
						hrefOf(AppRoute.CustomersSettingsSignals({ orgSlug })),
						on(
							"CustomersSettingsSignals",
							"CustomersSettingsSignalNew",
							"CustomersSettingsSignalRule",
						),
						icon(IconLightbulb),
					),
					item(
						"Health score",
						hrefOf(AppRoute.CustomersSettingsHealth({ orgSlug })),
						on("CustomersSettingsHealth"),
						icon(IconHeart),
					),
					item(
						"Data sources",
						hrefOf(AppRoute.CustomersSettingsSources({ orgSlug })),
						on("CustomersSettingsSources", "CustomersSourceDetail", "CustomersUnmatched"),
						icon(IconServers),
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
