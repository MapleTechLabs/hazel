import type * as Customers from "@hazel/domain/customers"
import { Option } from "effect"
import type { Html, HtmlBuilder } from "foldkit/html"
import type { BuiltInContext } from "../../../customers/overview/built-ins"
import type * as OverviewData from "../../../customers/overview/data"
import { type WidgetContext, widgetGrid } from "../../../customers/overview/widgets"
import type { SignalRow } from "../../../customers/queries"
import { snoozeMenuContent } from "../../../customers/ui/menus"
import { queueAction } from "../../../customers/ui/queue-row"
import { IconCheck, IconChevronDown, IconClock, IconDashboard, IconDots } from "../../../icons"
import { AppRoute, hrefOf } from "../../../route"
import { button, buttonClassName } from "../../../ui/button"
import { menuLabel } from "../../../ui/menu-view"
import { Message } from "./message"
import {
	ASSIGN_ME,
	AUTOMATIC_LAYOUT,
	accountOf,
	doneEntries,
	layoutEntries,
	type Model,
	OPEN_QUEUE,
	openSignals,
	overviewLayoutOf,
	primaryOf,
	snoozeEntries,
	signalMoreEntries,
	sortedNotes,
	UNASSIGN,
} from "./model"
import { type Context, headerLink, icon, menu } from "./parts"

/**
 * The overview tab: the customer's Overview layout (`docs/customers/overview-layouts.md`), drawn by
 * the shared widget renderers, under a row naming the layout (a menu pins the customer to another)
 * and, for admins, "Customize".
 */

// SIGNAL ACTIONS

const OUTCOME_LABEL = {
	contacted: "Contacted",
	fixed: "Fixed",
	not_an_issue: "Not an issue",
	other: "Other",
} as const
const MORE_LABEL = {
	[ASSIGN_ME]: "Assign to me",
	[UNASSIGN]: "Unassign",
	[OPEN_QUEUE]: "Open in Needs attention",
} as const

const labelOf = (labels: Readonly<Record<string, string>>, key: string) => labels[key] ?? key

const signalButtons = (
	h: HtmlBuilder<Message>,
	model: Model,
	signal: SignalRow,
	nowMs: number,
): ReadonlyArray<Html> => {
	const isActive = model.activeSignalId === signal.id
	const labeled = (menuId: string, labels: Readonly<Record<string, string>>) => (key: string) => [
		menuLabel(h, menuId, key, labelOf(labels, key)),
	]
	/** The active signal's buttons are the menus' triggers; the others open them for their signal. */
	const action = (
		which: "snooze" | "done" | "more",
		label: string,
		glyph: Html,
		menuModel: Model["snoozeMenu"],
		entries: ReadonlyArray<Parameters<typeof menu>[2]["entries"][number]>,
		content: (key: string) => ReadonlyArray<Html | string>,
		toMessage: Parameters<typeof menu>[2]["toMessage"],
	): Html =>
		isActive
			? menu(h, menuModel, {
					entries,
					trigger: (attributes, overlay) =>
						queueAction(h, {
							label,
							icon: glyph,
							iconOnly: which === "more",
							attributes,
							overlay,
						}),
					content,
					toMessage,
				})
			: queueAction(h, {
					label,
					icon: glyph,
					iconOnly: which === "more",
					onPress: Message.PressedSignalMenu({ signalId: signal.id, menu: which }),
				})
	return [
		action(
			"snooze",
			signal.status === "snoozed" ? "Change snooze" : "Snooze",
			IconClock(h, icon),
			model.snoozeMenu,
			snoozeEntries,
			snoozeMenuContent(h, model.snoozeMenu.id, new Date(nowMs)),
			(message) => Message.GotSnoozeMenuMessage({ message }),
		),
		action(
			"done",
			"Done",
			IconCheck(h, icon),
			model.doneMenu,
			doneEntries,
			labeled(model.doneMenu.id, OUTCOME_LABEL),
			(message) => Message.GotDoneMenuMessage({ message }),
		),
		action(
			"more",
			"More actions",
			IconDots(h, icon),
			model.signalMoreMenu,
			signalMoreEntries,
			labeled(model.signalMoreMenu.id, MORE_LABEL),
			(message) => Message.GotSignalMoreMenuMessage({ message }),
		),
	]
}

// HEADER

const layoutHeader = (h: HtmlBuilder<Message>, model: Model, context: Context): Html => {
	const { layout } = overviewLayoutOf(model)
	const pinnedId = accountOf(model)?.pinnedLayoutId ?? null
	const layouts = model.layouts ?? []
	const nameOf = (key: string) =>
		key === AUTOMATIC_LAYOUT
			? "Automatic (by rules)"
			: (layouts.find((each) => each.id === key)?.name ?? "Layout")
	return h.div(
		[h.Class("flex flex-wrap items-center justify-between gap-2")],
		[
			menu(
				h,
				{ ...model.layoutMenu, selectedKeys: [pinnedId ?? AUTOMATIC_LAYOUT] },
				{
					entries: layoutEntries(layouts),
					trigger: (attributes, overlay) =>
						button(
							h,
							{ intent: "plain", size: "sm", attributes, isDisabled: model.layouts === null },
							[
								h.span([h.Class("text-muted-fg")], ["Layout"]),
								layout?.name ?? "Default",
								...(pinnedId === null
									? []
									: [h.span([h.Class("text-muted-fg text-xs")], ["· pinned"])]),
								IconChevronDown(h, { className: "size-3" }),
								overlay,
							],
						),
					content: (key) => [menuLabel(h, model.layoutMenu.id, key, nameOf(key))],
					toMessage: (message) => Message.GotLayoutMenuMessage({ message }),
				},
			),
			...(context.isAdmin
				? [
						h.a(
							[
								h.Href(
									hrefOf(
										layout === null
											? AppRoute.CustomersSettingsLayouts({ orgSlug: context.orgSlug })
											: AppRoute.CustomersSettingsLayout({
													orgSlug: context.orgSlug,
													layoutId: layout.id,
													preview: Option.some(model.accountId),
												}),
									),
								),
								h.Class(buttonClassName({ intent: "outline", size: "sm" })),
							],
							[IconDashboard(h, icon), "Customize"],
						),
					]
				: []),
		],
	)
}

// TAB

const toOverviewData = (message: OverviewData.Message) => Message.GotOverviewDataMessage({ message })

export const overviewTab = (
	h: HtmlBuilder<Message>,
	model: Model,
	context: Context,
	bands: Customers.HealthBands,
): ReadonlyArray<Html> => {
	const builtIn: BuiltInContext = {
		orgSlug: context.orgSlug,
		nowMs: context.nowMs,
		account: context.account,
		detail: context.detail,
		bands,
		signals: openSignals(model),
		primary: primaryOf(model),
		pinnedNotes: sortedNotes(model).filter((note) => note.pinned),
		membersById: context.membersById,
		tabLink: (tab, label) => headerLink(h, label, Message.ClickedTab({ tab })),
		signalActions: (signal) => signalButtons(h, model, signal, context.nowMs),
	}
	const widgets: WidgetContext<Message> = {
		data: model.overview,
		metrics: model.metrics,
		currency: context.account.currency,
		toMessage: toOverviewData,
		builtIn,
	}
	return [layoutHeader(h, model, context), widgetGrid(h, overviewLayoutOf(model).widgets, widgets)]
}
