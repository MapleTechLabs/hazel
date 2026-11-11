import type { IgnoreRuleField } from "@hazel/domain/customers"
import { Option } from "effect"
import { Submodel } from "foldkit"
import * as AsyncData from "foldkit/asyncData"
import type { ChildAttribute, Html, HtmlBuilder } from "foldkit/html"
import { commonMessage, type CommonReason } from "~/lib/error-messages"
import { formatCount } from "../../../../customers/format"
import { providerOf } from "../../../../customers/providers"
import { searchBox, sortTrigger, viewTabs } from "../../../../customers/ui/filter-bar"
import { noResultsState } from "../../../../customers/ui/empty-states"
import { IconArrowPath, IconCheck, IconLock, IconTrash } from "../../../../icons"
import { AppRoute, hrefOf } from "../../../../route"
import { button } from "../../../../ui/button"
import { emptyState } from "../../../../ui/empty-state"
import type * as Menu from "../../../../ui/menu"
import { menuLabel, view as menuView } from "../../../../ui/menu-view"
import type { PageViewInputs, Shared } from "../../../contract"
import { isCustomersAdmin, readOnlyNotice, settingsHeader, settingsPage } from "../shared"
import { Message } from "./message"
import {
	groupsOf,
	highConfidenceRecords,
	type IgnoreRuleRow,
	itemsOf,
	type Model,
	openRecords,
	type RecordList,
	type Records,
	type RecordStatus,
	SEARCH_ID,
	type Sort,
	sortEntries,
	sourceTabs,
	type Tab,
	visibleRecords,
} from "./model"
import { loadingTable, nounOf, recordsTable } from "./table"

/** The unmatched records resolver (Wonder: Data Sources › `ids`). */

const toSortMenuMessage = (message: Menu.Message) => Message.GotSortMenuMessage({ message })
const toTab = (tab: Tab) => Message.ClickedTab({ tab })
const toSearch = (value: string) => Message.ChangedSearch({ value })

const SORT_LABEL = { confidence: "Confidence", value: "Value", newest: "Newest" } as const satisfies Record<
	Sort,
	string
>
const FIELD_LABEL = {
	email: "Email",
	domain: "Domain",
	name: "Name",
	external_id: "Source id",
} as const satisfies Record<IgnoreRuleField, string>

const icon = { attributes: { "data-slot": "icon" } }
const card = "rounded-xl border border-border bg-bg"
const plural = (count: number, noun: string) => `${formatCount(count)} ${noun}${count === 1 ? "" : "s"}`

// HEADER

const subtitle = (model: Model): string =>
	AsyncData.hasData(model.open)
		? model.openCount === 0
			? "Every source record is linked to an account."
			: `${plural(model.openCount, "source record")} couldn't be linked to an account. Each link is saved and reused on every future sync.`
		: "Source records no account claims. Each link is saved and reused on every future sync."

const header = (h: HtmlBuilder<Message>, model: Model, shared: Shared): Html => {
	const high = highConfidenceRecords(model).length
	return settingsHeader(h, {
		title: "Unmatched records",
		subtitle: subtitle(model),
		crumbs: [
			{
				label: "Data sources",
				href: hrefOf(AppRoute.CustomersSettingsSources({ orgSlug: shared.orgSlug ?? "" })),
			},
			{ label: "Unmatched records" },
		],
		actions:
			isCustomersAdmin(shared) && high > 0
				? [
						button(
							h,
							{ intent: "primary", size: "sm", onPress: Message.PressedLinkHighConfidence() },
							[IconCheck(h, icon), `Link ${formatCount(high)} high-confidence`],
						),
					]
				: [],
	})
}

// CONTROLS

const controls = (h: HtmlBuilder<Message>, model: Model): Html =>
	viewTabs(h, {
		ariaLabel: "Records",
		tabs: [
			{ key: "all", label: "All", count: model.openCount },
			...sourceTabs(model).map(({ provider, count }) => ({
				key: provider,
				label: providerOf(provider).name,
				count,
			})),
			{ key: "ignored", label: "Ignored", count: itemsOf(model.ignored).length },
		],
		selected: model.tab,
		onSelect: toTab,
		trailing: h.div(
			[h.Class("ml-auto flex items-center gap-2 pb-1 max-sm:hidden")],
			[
				searchBox(h, {
					id: SEARCH_ID,
					value: model.search,
					placeholder: "Search records…",
					onInput: toSearch,
					onClear: Message.ClearedSearch(),
					className: "w-56",
				}),
				h.submodel({
					slotId: model.sortMenu.id,
					model: model.sortMenu,
					view: menuView,
					viewInputs: {
						entries: sortEntries,
						toTrigger: (attributes: ReadonlyArray<ChildAttribute>, overlay: Html) =>
							sortTrigger(h, { label: SORT_LABEL[model.sort], attributes, overlay }),
						content: (key: string) => [
							menuLabel(h, model.sortMenu.id, key, SORT_LABEL[key as Sort]),
						],
					},
					toParentMessage: toSortMenuMessage,
				}),
			],
		),
	})

/** Shown while rows are checked: link the suggested ones, or ignore them all. */
const bulkBar = (h: HtmlBuilder<Message>, model: Model): Html => {
	const selected = openRecords(model).filter((record) => model.selected.includes(record.id))
	const suggested = selected.filter((record) => record.suggestedAccountId !== null).length
	return h.div(
		[
			h.Role("toolbar"),
			h.AriaLabel("Selected records"),
			h.Class(
				"flex flex-wrap items-center gap-2 rounded-lg border border-border bg-secondary/40 px-3 py-2",
			),
		],
		[
			h.span([h.Class("font-medium text-fg text-sm")], [`${formatCount(selected.length)} selected`]),
			h.span([h.Class("ml-auto")]),
			button(
				h,
				{
					intent: "outline",
					size: "xs",
					isDisabled: suggested === 0,
					onPress: Message.PressedLinkSelected(),
				},
				[IconCheck(h, icon), `Link ${formatCount(suggested)} suggested`],
			),
			button(h, { intent: "outline", size: "xs", onPress: Message.PressedIgnoreSelected() }, [
				"Ignore",
			]),
			button(h, { intent: "plain", size: "xs", onPress: Message.ClearedSelection() }, ["Clear"]),
		],
	)
}

// STATES

const failure = (h: HtmlBuilder<Message>, reason: CommonReason): Html => {
	const message = commonMessage(reason)
	return h.div(
		[h.Class(`flex flex-col items-center gap-3 px-6 py-14 text-center ${card}`)],
		[
			h.span([h.Class("font-medium text-fg")], [message.title]),
			...(message.description
				? [h.span([h.Class("text-muted-fg text-sm")], [message.description])]
				: []),
			button(h, { intent: "outline", size: "sm", onPress: Message.PressedRetry() }, [
				IconArrowPath(h, icon),
				"Try again",
			]),
		],
	)
}

const framed = (h: HtmlBuilder<Message>, child: Html): Html =>
	h.div([h.Class(`flex items-center justify-center px-6 ${card}`)], [child])

const allLinked = (h: HtmlBuilder<Message>): Html =>
	framed(
		h,
		emptyState(h, {
			title: "All records are linked",
			icon: (className) => IconCheck(h, { className }),
			description:
				"Every record from your sources belongs to an account. New ones show up here after a sync.",
		}),
	)

const adminsOnly = (h: HtmlBuilder<Message>): Html =>
	framed(
		h,
		emptyState(h, {
			title: "Only admins and owners resolve unmatched records",
			icon: (className) => IconLock(h, { className }),
			description: "Ask an admin to link or ignore the records your sources couldn't match.",
		}),
	)

/** The list's states: loading, failed, or its rows. */
const withList = (
	h: HtmlBuilder<Message>,
	records: Records,
	ready: (list: RecordList) => ReadonlyArray<Html>,
): ReadonlyArray<Html> =>
	Option.match(AsyncData.getData(records), {
		onSome: ready,
		onNone: () =>
			Option.match(AsyncData.getError(records), {
				onSome: (reason) => [failure(h, reason)],
				onNone: () => [h.div([h.Class(card)], [loadingTable(h)])],
			}),
	})

const loadMore = (
	h: HtmlBuilder<Message>,
	model: Model,
	status: RecordStatus,
	list: RecordList,
): ReadonlyArray<Html> =>
	list.nextCursor === null
		? []
		: [
				h.div(
					[h.Class("flex justify-center border-border border-b px-4 py-2.5")],
					[
						button(
							h,
							{
								intent: "plain",
								size: "xs",
								isPending: model.loadingMore === status,
								onPress: Message.PressedLoadMore({ status }),
							},
							["Load more"],
						),
					],
				),
			]

// TABS

const openTab = (h: HtmlBuilder<Message>, model: Model, shared: Shared): ReadonlyArray<Html> =>
	withList(h, model.open, (list) => {
		const records = visibleRecords(model)
		if (list.items.length === 0 && list.nextCursor === null) return [allLinked(h)]
		if (records.length === 0)
			return [
				model.search === ""
					? framed(
							h,
							emptyState(h, {
								title: "Nothing left in this source",
								icon: (className) => IconCheck(h, { className }),
								description: "Every record from this source is linked or ignored.",
							}),
						)
					: noResultsState(h, {
							title: "No records match",
							description: "Search by name, email, domain or source id.",
							onClear: Message.ClearedSearch(),
							clearLabel: "Clear search",
						}),
			]
		const ignored = itemsOf(model.ignored).length
		return [
			h.div(
				[h.Class(card)],
				[
					recordsTable(h, model, groupsOf(records), {
						id: "unmatched-open",
						ariaLabel: "Unmatched records",
						accountsById: new Map((model.accounts ?? []).map((account) => [account.id, account])),
						isAdmin: isCustomersAdmin(shared),
					}),
					...loadMore(h, model, "open", list),
					...(ignored === 0
						? []
						: [
								h.div(
									[
										h.Class(
											"flex flex-wrap items-center gap-3 px-4 py-2.5 text-muted-fg text-xs",
										),
									],
									[
										h.span(
											[h.Class("flex-1")],
											[
												`${plural(ignored, "ignored record")} ${ignored === 1 ? "is" : "are"} hidden. Ignored records never create accounts and don't count toward coverage.`,
											],
										),
										button(
											h,
											{
												intent: "plain",
												size: "xs",
												onPress: Message.ClickedTab({ tab: "ignored" }),
											},
											["Show ignored"],
										),
									],
								),
							]),
				],
			),
		]
	})

const ruleRow = (h: HtmlBuilder<Message>, rule: IgnoreRuleRow, isAdmin: boolean): Html =>
	h.li(
		[h.Key(rule.id), h.Class("flex items-center gap-3 px-4 py-2.5 text-sm")],
		[
			h.span([h.Class("text-muted-fg")], [`${FIELD_LABEL[rule.field]} matches`]),
			h.code([h.Class("rounded bg-secondary px-1.5 py-0.5 font-mono text-fg text-xs")], [rule.pattern]),
			h.span(
				[h.Class("truncate text-muted-fg")],
				[
					rule.provider === null
						? `All sources · ${rule.entityType}s`
						: `${providerOf(rule.provider).name} ${nounOf(rule.provider, rule.entityType)}`,
				],
			),
			...(isAdmin
				? [
						button(
							h,
							{
								intent: "plain",
								size: "sq-xs",
								className: "ml-auto",
								attributes: [
									h.AriaLabel(
										`Delete the rule ${FIELD_LABEL[rule.field]} matches ${rule.pattern}`,
									),
								],
								onPress: Message.PressedDeleteRule({ ruleId: rule.id }),
							},
							[IconTrash(h, { className: "size-4" })],
						),
					]
				: []),
		],
	)

const rulesSection = (h: HtmlBuilder<Message>, model: Model, isAdmin: boolean): Html =>
	h.section(
		[h.AriaLabelledBy("unmatched-rules-title"), h.Class(`flex flex-col ${card}`)],
		[
			h.div(
				[h.Class("flex flex-col gap-0.5 border-border border-b px-4 py-3")],
				[
					h.h2(
						[h.Id("unmatched-rules-title"), h.Class("font-medium text-fg text-sm")],
						["Ignore rules"],
					),
					h.p(
						[h.Class("text-muted-fg text-xs")],
						[
							"Every future record matching a rule is ignored on sync. Patterns use * as a wildcard.",
						],
					),
				],
			),
			Option.match(AsyncData.getData(model.rules), {
				onSome: (rules) =>
					rules.length === 0
						? h.p(
								[h.Class("px-4 py-4 text-muted-fg text-sm")],
								["No rules yet. A record's ⋯ menu ignores every record like it."],
							)
						: h.ul(
								[h.Class("divide-y divide-border")],
								rules.map((rule) => ruleRow(h, rule, isAdmin)),
							),
				onNone: () =>
					h.p(
						[h.Class("px-4 py-4 text-muted-fg text-sm")],
						[AsyncData.hasError(model.rules) ? "Couldn't load the rules." : "Loading…"],
					),
			}),
		],
	)

const ignoredTab = (h: HtmlBuilder<Message>, model: Model, shared: Shared): ReadonlyArray<Html> => [
	...withList(h, model.ignored, (list) => {
		const records = visibleRecords(model)
		if (records.length === 0)
			return [
				list.items.length === 0
					? framed(
							h,
							emptyState(h, {
								title: "Nothing ignored",
								description: "Records you ignore show up here and are skipped on every sync.",
							}),
						)
					: noResultsState(h, {
							title: "No records match",
							description: "Search by name, email, domain or source id.",
							onClear: Message.ClearedSearch(),
							clearLabel: "Clear search",
						}),
			]
		return [
			h.div(
				[h.Class(card)],
				[
					recordsTable(h, model, groupsOf(records), {
						id: "unmatched-ignored",
						ariaLabel: "Ignored records",
						accountsById: new Map((model.accounts ?? []).map((account) => [account.id, account])),
						isAdmin: false,
					}),
					...loadMore(h, model, "ignored", list),
				],
			),
		]
	}),
	rulesSection(h, model, isCustomersAdmin(shared)),
]

// PAGE

export const view = Submodel.defineView<Model, Message, PageViewInputs>((model, { shared }, h) => {
	const isAdmin = isCustomersAdmin(shared)
	if (!isAdmin && AsyncData.isIdle(model.open))
		return settingsPage(h, [header(h, model, shared), adminsOnly(h)])
	return settingsPage(h, [
		header(h, model, shared),
		...(isAdmin ? [] : [readOnlyNotice(h, "unmatched records")]),
		controls(h, model),
		...(isAdmin && model.selected.length > 0 && model.tab !== "ignored" ? [bulkBar(h, model)] : []),
		...(model.tab === "ignored" ? ignoredTab(h, model, shared) : openTab(h, model, shared)),
	])
})
