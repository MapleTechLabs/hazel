import { TEMPLATES } from "@hazel/domain/customers"
import { Submodel } from "foldkit"
import type { ChildAttribute, Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { formatMoney, formatRelative, formatWeekdayTime } from "../../../customers/format"
import { KIND_LABEL, SEVERITY_LABEL } from "../../../customers/ui/badges"
import { companyLogo } from "../../../customers/ui/identity"
import {
	addFilterButton,
	filterBar,
	filterChip,
	searchBox,
	segmented,
	sortTrigger,
	viewTabs,
} from "../../../customers/ui/filter-bar"
import { snoozeMenuContent } from "../../../customers/ui/menus"
import { queueAction, queueList } from "../../../customers/ui/queue-row"
import { kbd, shortcutBar, type Shortcut } from "../../../customers/ui/shortcuts"
import { IconArrowPath, IconCheck, IconClock, IconDots, IconLightbulb, IconUser } from "../../../icons"
import { AppRoute, hrefOf } from "../../../route"
import { buttonClassName } from "../../../ui/button"
import type * as Menu from "../../../ui/menu"
import { menuLabel, view as menuView } from "../../../ui/menu-view"
import type { PageViewInputs } from "../../contract"
import { doneDialog, snoozeDateDialog } from "./done-dialog"
import { Message } from "./message"
import {
	accountGroups,
	accountsByIdOfModel,
	ASSIGN_ME,
	ASSIGN_NONE,
	assignEntries,
	canReopen,
	filterEntries,
	type Filters,
	moreEntries,
	type Model,
	SEARCH_ID,
	selectedSignal,
	snoozeEntries,
	snoozeUntilMs,
	NEXT_RETRY,
	sortEntries,
	tabCounts,
	userIdOfAssignKey,
	type Viewer,
	visibleSignals,
} from "./model"
import { previewPanel } from "./preview"
import { accountGroupRow, compactRow, doneRow, type RowContext, rowIdOf, signalRow, snoozedRow } from "./rows"
import { ScrollRowIntoView } from "./commands"
import { viewerOf } from "./update"

/** The Needs-attention page (Wonder: Needs Attention). */

const toAssignMenuMessage = (message: Menu.Message) => Message.GotAssignMenuMessage({ message })
const toSnoozeMenuMessage = (message: Menu.Message) => Message.GotSnoozeMenuMessage({ message })
const toMoreMenuMessage = (message: Menu.Message) => Message.GotMoreMenuMessage({ message })
const toFilterMenuMessage = (message: Menu.Message) => Message.GotFilterMenuMessage({ message })
const toSortMenuMessage = (message: Menu.Message) => Message.GotSortMenuMessage({ message })

const SORT_LABEL = { priority: "Priority", severity: "Severity", age: "Oldest first", mrr: "MRR" } as const
const OWNER_LABEL = { mine: "Mine", anyone: "Anyone", unowned: "Unowned" } as const

// MENUS

const menu = (
	h: HtmlBuilder<Message>,
	model: Menu.Model,
	options: Readonly<{
		entries: ReadonlyArray<Menu.Entry>
		trigger: (attributes: ReadonlyArray<ChildAttribute>, overlay: Html) => Html
		content: (key: string) => ReadonlyArray<Html | string>
		toMessage: (message: Menu.Message) => Message
		className?: string
	}>,
): Html =>
	h.submodel({
		slotId: model.id,
		model,
		view: menuView,
		viewInputs: {
			entries: options.entries,
			toTrigger: options.trigger,
			content: options.content,
			className: options.className,
		},
		toParentMessage: options.toMessage,
	})

const icon = { attributes: { "data-slot": "icon" } }

/** The selected signal's actions: Assign, Snooze, Done and `⋯` (open), or Wake / Reopen. */
const signalActions = (h: HtmlBuilder<Message>, model: Model, viewer: Viewer): ReadonlyArray<Html> => {
	const signal = selectedSignal(model)
	if (signal === undefined) return []
	const assign = menu(h, model.assignMenu, {
		entries: assignEntries(model.members, viewer),
		trigger: (attributes, overlay) =>
			queueAction(h, { label: "Assign", icon: IconUser(h, icon), attributes, overlay }),
		content: (key) => [
			menuLabel(
				h,
				model.assignMenu.id,
				key,
				key === ASSIGN_ME
					? "Assign to me"
					: key === ASSIGN_NONE
						? "Unassign"
						: (model.members.find((member) => member.id === userIdOfAssignKey(key))?.name ?? key),
			),
		],
		toMessage: toAssignMenuMessage,
	})
	const snooze = menu(h, model.snoozeMenu, {
		entries: snoozeEntries(signal),
		trigger: (attributes, overlay) =>
			queueAction(h, {
				label: signal.status === "snoozed" ? "Change snooze" : "Snooze",
				icon: IconClock(h, icon),
				attributes,
				overlay,
			}),
		content: (key) =>
			key === NEXT_RETRY
				? [
						menuLabel(h, model.snoozeMenu.id, key, "After next retry"),
						h.span(
							[h.Class("ml-auto pl-4 text-muted-fg text-xs tabular-nums")],
							[formatWeekdayTime(new Date(snoozeUntilMs(NEXT_RETRY, viewer.nowMs, signal)))],
						),
					]
				: snoozeMenuContent(h, model.snoozeMenu.id, new Date(viewer.nowMs))(key),
		toMessage: toSnoozeMenuMessage,
		className: "min-w-64",
	})
	const done = queueAction(h, {
		label: "Done",
		icon: IconCheck(h, icon),
		onPress: Message.PressedMarkDone({ signalId: signal.id }),
	})
	if (model.tab === "done")
		return canReopen(signal)
			? [
					queueAction(h, {
						label: "Reopen",
						icon: IconArrowPath(h, icon),
						onPress: Message.PressedReopen({ signalId: signal.id }),
					}),
				]
			: []
	if (model.tab === "snoozed")
		return [
			queueAction(h, {
				label: "Wake now",
				icon: IconArrowPath(h, icon),
				onPress: Message.PressedReopen({ signalId: signal.id }),
			}),
			snooze,
			done,
		]
	const more = menu(h, model.moreMenu, {
		entries: moreEntries,
		trigger: (attributes, overlay) =>
			queueAction(h, {
				label: "More actions",
				iconOnly: true,
				icon: IconDots(h, icon),
				attributes,
				overlay,
			}),
		content: (key) => [
			menuLabel(
				h,
				model.moreMenu.id,
				key,
				key === "dismiss" ? "Dismiss (not useful)" : "Open customer",
			),
			...(key === "dismiss" ? [kbd(h, "E", "ml-auto")] : [kbd(h, "Enter", "ml-auto")]),
		],
		toMessage: toMoreMenuMessage,
	})
	return [assign, snooze, done, more]
}

// HEADER AND CONTROLS

const header = (h: HtmlBuilder<Message>, model: Model, viewer: Viewer, orgSlug: string | null): Html => {
	const signals = visibleSignals(model, viewer)
	const accountsById = accountsByIdOfModel(model)
	const highRiskMrr = [
		...new Set(
			signals
				.filter((signal) => signal.kind === "risk" && signal.severity === "high")
				.map((signal) => signal.accountId),
		),
	].reduce((sum, accountId) => sum + (accountsById.get(accountId)?.mrrMinor ?? 0), 0)
	const currency = model.accounts?.[0]?.currency ?? "USD"
	const whose = model.filters.owner === "mine" ? " on your accounts" : ""
	const subtitle =
		model.signals === null || model.accounts === null
			? "Loading…"
			: model.tab === "open"
				? signals.length === 0
					? `Nothing${whose} needs you right now`
					: [
							`${signals.length} open signal${signals.length === 1 ? "" : "s"}${whose}`,
							`${signals.filter((signal) => signal.kind === "risk").length} risk, ${signals.filter((signal) => signal.kind === "opportunity").length} opportunity`,
							...(highRiskMrr > 0
								? [`${formatMoney(highRiskMrr, currency)} MRR with a high-severity risk`]
								: []),
						].join(" · ")
				: model.tab === "snoozed"
					? `${signals.length} snoozed signal${signals.length === 1 ? "" : "s"}${whose}`
					: `${signals.length} signal${signals.length === 1 ? "" : "s"} resolved in the last 7 days · ${signals.filter((signal) => signal.status === "auto_resolved").length} cleared on their own`
	return h.div(
		[h.Class("flex items-start justify-between gap-4")],
		[
			h.div(
				[h.Class("flex min-w-0 flex-col gap-1")],
				[
					h.h1([h.Class("font-semibold text-2xl text-fg")], ["Needs attention"]),
					h.p([h.Class("text-muted-fg text-sm")], [subtitle]),
				],
			),
			h.div(
				[h.Class("flex shrink-0 items-center gap-4")],
				[
					...(model.lastComputedAtMs === null
						? []
						: [
								h.span(
									[
										h.Class(
											"inline-flex items-center gap-1.5 text-muted-fg text-sm max-md:hidden",
										),
									],
									[
										IconArrowPath(h, { className: "size-3.5" }),
										`Evaluated ${formatRelative(new Date(model.lastComputedAtMs), new Date(viewer.nowMs))}`,
									],
								),
							]),
					...(orgSlug === null
						? []
						: [
								h.a(
									[
										h.Href(hrefOf(AppRoute.CustomersSettingsSignals({ orgSlug }))),
										h.Class(buttonClassName({ intent: "outline", size: "sm" })),
									],
									[IconLightbulb(h, icon), "Signal rules"],
								),
							]),
				],
			),
		],
	)
}

const filterChips = (h: HtmlBuilder<Message>, filters: Filters): ReadonlyArray<Html> => [
	...(filters.owner === "anyone"
		? []
		: [
				filterChip(h, {
					field: "Owner",
					operator: "is",
					value: OWNER_LABEL[filters.owner],
					onRemove: Message.ClearedFilter({ field: "owner" }),
				}),
			]),
	...(filters.kind === null
		? []
		: [
				filterChip(h, {
					field: "Kind",
					operator: "is",
					value: KIND_LABEL[filters.kind],
					onRemove: Message.ClearedFilter({ field: "kind" }),
				}),
			]),
	...(filters.template === null
		? []
		: [
				filterChip(h, {
					field: "Signal",
					operator: "is",
					value: TEMPLATES[filters.template].name,
					onRemove: Message.ClearedFilter({ field: "template" }),
				}),
			]),
	...(filters.severity === null
		? []
		: [
				filterChip(h, {
					field: "Severity",
					operator: "is",
					value: SEVERITY_LABEL[filters.severity],
					onRemove: Message.ClearedFilter({ field: "severity" }),
				}),
			]),
	...(filters.plan === null
		? []
		: [
				filterChip(h, {
					field: "Plan",
					operator: "is",
					value: filters.plan,
					onRemove: Message.ClearedFilter({ field: "plan" }),
				}),
			]),
]

/** A filter key's label, checked when that filter is active. */
const filterItemContent = (h: HtmlBuilder<Message>, model: Model, key: string): ReadonlyArray<Html> => {
	const [field = "", value = ""] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)]
	const { filters } = model
	const label =
		field === "owner"
			? OWNER_LABEL[value as keyof typeof OWNER_LABEL]
			: field === "kind"
				? KIND_LABEL[value as keyof typeof KIND_LABEL]
				: field === "severity"
					? SEVERITY_LABEL[value as keyof typeof SEVERITY_LABEL]
					: field === "template"
						? TEMPLATES[value as keyof typeof TEMPLATES].name
						: value
	const isActive = (filters as Record<string, unknown>)[field] === value
	return [
		menuLabel(h, model.filterMenu.id, key, label),
		...(isActive ? [IconCheck(h, { className: "ml-auto size-4 text-primary" })] : []),
	]
}

const controls = (h: HtmlBuilder<Message>, model: Model): Html =>
	filterBar(h, {
		start: [
			searchBox(h, {
				id: SEARCH_ID,
				value: model.search,
				placeholder: "Search accounts…",
				onInput: (value) => Message.ChangedSearch({ value }),
				onClear: Message.ClearedSearch(),
			}),
			...filterChips(h, model.filters),
			menu(h, model.filterMenu, {
				entries: filterEntries(model),
				trigger: (attributes, overlay) => addFilterButton(h, { attributes, overlay }),
				content: (key) => filterItemContent(h, model, key),
				toMessage: toFilterMenuMessage,
				className: "max-h-96 min-w-56",
			}),
		],
		end:
			model.tab === "open"
				? [
						menu(h, model.sortMenu, {
							entries: sortEntries,
							trigger: (attributes, overlay) =>
								sortTrigger(h, { label: SORT_LABEL[model.sort], attributes, overlay }),
							content: (key) => [
								menuLabel(
									h,
									model.sortMenu.id,
									key,
									SORT_LABEL[key as keyof typeof SORT_LABEL],
								),
							],
							toMessage: toSortMenuMessage,
						}),
						segmented(h, {
							ariaLabel: "Group the queue by",
							segments: [
								{ key: "signals", label: "Signals" },
								{ key: "accounts", label: "Accounts" },
							],
							selected: model.grouping,
							onSelect: (grouping) => Message.ClickedGrouping({ grouping }),
						}),
					]
				: [],
	})

// LIST

const SHORTCUTS = {
	open: [
		{ keys: ["J", "K"], label: "Move" },
		{ keys: ["A"], label: "Assign" },
		{ keys: ["S"], label: "Snooze" },
		{ keys: ["D"], label: "Mark done" },
		{ keys: ["E"], label: "Dismiss" },
		{ keys: ["Enter"], label: "Open customer" },
		{ keys: ["Space"], label: "Preview" },
	],
	snoozed: [
		{ keys: ["J", "K"], label: "Move" },
		{ keys: ["W"], label: "Wake now" },
		{ keys: ["S"], label: "Change snooze" },
		{ keys: ["D"], label: "Mark done" },
		{ keys: ["Enter"], label: "Open customer" },
	],
	done: [
		{ keys: ["J", "K"], label: "Move" },
		{ keys: ["R"], label: "Reopen" },
		{ keys: ["Enter"], label: "Open customer" },
	],
} as const satisfies Record<Model["tab"], ReadonlyArray<Shortcut>>

const columnHeader = (h: HtmlBuilder<Message>, cells: ReadonlyArray<readonly [string, string]>): Html =>
	h.div(
		[
			h.Role("row"),
			h.Class(
				"flex items-center gap-4 border-border border-b bg-secondary/30 px-4 py-2 font-medium text-[11px] text-muted-fg uppercase tracking-wider",
			),
		],
		cells.map(([label, className]) => h.span([h.Role("columnheader"), h.Class(className)], [label])),
	)

const allClear = (h: HtmlBuilder<Message>, model: Model, viewer: Viewer): Html => {
	const counts = tabCounts(model, viewer)
	const others = tabCounts({ ...model, filters: { ...model.filters, owner: "anyone" } }, viewer).open
	const upcoming = visibleSignals({ ...model, tab: "snoozed" }, viewer).slice(0, 3)
	const accountsById = accountsByIdOfModel(model)
	return h.div(
		[h.Class("flex flex-col items-center gap-4 rounded-xl border border-border px-6 py-14 text-center")],
		[
			h.div(
				[
					h.Class(
						"flex size-11 items-center justify-center rounded-xl bg-success-subtle text-success",
					),
				],
				[IconCheck(h, { className: "size-5" })],
			),
			h.div(
				[h.Class("flex flex-col gap-1")],
				[
					h.h2([h.Class("font-semibold text-fg")], ["All clear"]),
					h.p(
						[h.Class("max-w-sm text-muted-fg text-sm")],
						[
							`No open signals${model.filters.owner === "mine" ? " on your accounts" : ""}. Hazel checks again every hour${counts.snoozed > 0 ? `, and ${counts.snoozed} snoozed signal${counts.snoozed === 1 ? "" : "s"} will wake up` : ""}.`,
						],
					),
				],
			),
			h.div(
				[h.Class("flex items-center gap-2")],
				[
					...(counts.snoozed > 0
						? [
								queueAction(h, {
									label: `View ${counts.snoozed} snoozed`,
									icon: IconClock(h, icon),
									onPress: Message.ClickedTab({ tab: "snoozed" }),
								}),
							]
						: []),
					...(model.filters.owner !== "anyone" && others > 0
						? [
								queueAction(h, {
									label: `Show all owners · ${others} open`,
									icon: IconUser(h, icon),
									onPress: Message.PressedShowAllOwners(),
								}),
							]
						: []),
				],
			),
			...(upcoming.length === 0
				? []
				: [
						h.div(
							[h.Class("mt-4 flex w-full max-w-lg flex-col gap-2 text-left")],
							[
								h.span([h.Class("text-muted-fg text-xs")], ["Waking up next"]),
								h.ul(
									[h.Class("divide-y divide-border rounded-lg border border-border")],
									upcoming.map((signal) => {
										const account = accountsById.get(signal.accountId)
										if (account === undefined) return h.empty
										return h.li(
											[h.Class("flex items-center gap-3 px-3 py-2 text-sm")],
											[
												companyLogo(h, {
													name: account.name,
													logoUrl: account.logoUrl,
													size: "xs",
												}),
												h.span([h.Class("font-medium text-fg")], [account.name]),
												h.span(
													[h.Class("truncate text-muted-fg text-xs")],
													[signal.title],
												),
												h.span(
													[h.Class("ml-auto shrink-0 text-muted-fg text-xs")],
													[
														signal.snoozedUntilMs === null
															? ""
															: formatWeekdayTime(
																	new Date(signal.snoozedUntilMs),
																),
													],
												),
											],
										)
									}),
								),
							],
						),
					]),
		],
	)
}

const list = (h: HtmlBuilder<Message>, model: Model, viewer: Viewer): Html => {
	if (model.signals === null || model.accounts === null)
		return queueList(
			h,
			{ ariaLabel: "Signals loading" },
			Array.from({ length: 6 }, (_, index) =>
				h.div(
					[
						h.Class("flex h-16 items-center gap-4 border-border border-t px-4 first:border-t-0"),
						h.Key(`skeleton-${index}`),
					],
					[h.div([h.Class("h-3 w-full animate-pulse rounded bg-secondary")])],
				),
			),
		)
	const signals = visibleSignals(model, viewer)
	if (signals.length === 0)
		return model.tab === "open"
			? allClear(h, model, viewer)
			: h.div(
					[h.Class("rounded-xl border border-border px-6 py-14 text-center text-muted-fg text-sm")],
					[
						model.tab === "snoozed"
							? "Nothing is snoozed."
							: "Nothing resolved in the last 7 days.",
					],
				)
	const context: RowContext = {
		nowMs: viewer.nowMs,
		accountsById: accountsByIdOfModel(model),
		membersById: new Map(model.members.map((member) => [member.id, member])),
		selectedId: model.selectedId,
		actions: model.isPreviewOpen ? [] : signalActions(h, model, viewer),
	}
	if (model.tab === "snoozed")
		return queueList(h, { ariaLabel: "Snoozed signals" }, [
			columnHeader(h, [
				["Account", "w-52"],
				["Signal and snooze note", "flex-1"],
				["Wakes up", "w-44"],
				["Snoozed by", "w-36 max-lg:hidden"],
				["Health", "w-28 text-right"],
			]),
			...signals.map((signal) => snoozedRow(h, signal, context)),
			h.div(
				[h.Class("flex items-center gap-2 border-border border-t px-4 py-2.5 text-muted-fg text-xs")],
				[
					IconArrowPath(h, { className: "size-3.5" }),
					"Snoozed signals return to Open at their wake time, or sooner if the evidence gets a full step worse.",
				],
			),
		])
	if (model.tab === "done")
		return queueList(h, { ariaLabel: "Resolved signals" }, [
			columnHeader(h, [
				["Account", "w-52"],
				["Signal and resolution", "flex-1"],
				["Outcome", "w-28"],
				["Resolved by", "w-36 max-lg:hidden"],
				["Open for", "w-16 text-right whitespace-nowrap"],
				["Resolved", "w-16 text-right"],
			]),
			...signals.map((signal) => doneRow(h, signal, context)),
		])
	if (model.isPreviewOpen && selectedSignal(model) !== undefined)
		return queueList(
			h,
			{ ariaLabel: "Open signals" },
			model.grouping === "accounts"
				? accountGroups(signals).map((group, index) => compactRow(h, group.lead, index + 1, context))
				: signals.map((signal, index) => compactRow(h, signal, index + 1, context)),
		)
	return model.grouping === "accounts"
		? queueList(h, { ariaLabel: "Accounts needing attention" }, [
				columnHeader(h, [
					["#", "w-5 text-right"],
					["Account", "w-52"],
					["Open signals", "flex-1"],
					["Oldest", "w-8 text-right"],
					["", "w-10"],
					["Health", "w-28 text-right"],
				]),
				...accountGroups(signals).map((group, index) =>
					accountGroupRow(h, group, index + 1, context),
				),
			])
		: queueList(h, { ariaLabel: "Open signals" }, [
				columnHeader(h, [
					["#", "w-5 text-right"],
					["Account", "w-52 max-md:w-40"],
					["Signal and reason", "flex-1"],
					["Evidence", "w-32 text-right max-lg:hidden"],
					["Severity", "w-24"],
					["Age", "w-8 text-right"],
					["", "w-6"],
					["Health", "w-28 text-right"],
				]),
				...signals.map((signal, index) => signalRow(h, signal, index + 1, context)),
			])
}

// PAGE

export const view = Submodel.defineView<Model, Message, PageViewInputs>((model, { shared }, h) => {
	const viewer = viewerOf(shared)
	const counts = tabCounts(model, viewer)
	const selected = selectedSignal(model)
	const isPreviewShown = model.isPreviewOpen && selected !== undefined
	return h.div(
		[h.Class("flex h-full min-h-0 w-full")],
		[
			h.div(
				[h.Class("flex min-w-0 flex-1 flex-col overflow-y-auto")],
				[
					h.div(
						[
							h.Class(
								twMerge(
									"flex flex-col gap-5 px-4 py-6 lg:px-8",
									!isPreviewShown && "mx-auto w-full max-w-7xl",
								),
							),
						],
						[
							header(h, model, viewer, shared.orgSlug),
							viewTabs(h, {
								ariaLabel: "Queue",
								tabs: [
									{ key: "open", label: "Open", count: counts.open },
									{ key: "snoozed", label: "Snoozed", count: counts.snoozed },
									{ key: "done", label: "Done", count: counts.done },
								],
								selected: model.tab,
								onSelect: (tab) => Message.ClickedTab({ tab }),
							}),
							controls(h, model),
							list(h, model, viewer),
							...(model.selectedId === null
								? []
								: [
										h.keyed("span")(`scroll-${model.selectedId}`, [
											h.Class("hidden"),
											h.OnMount(
												ScrollRowIntoView({ rowId: rowIdOf(model.selectedId) }),
											),
										]),
									]),
							shortcutBar(h, SHORTCUTS[model.tab]),
						],
					),
				],
			),
			...(isPreviewShown
				? [previewPanel(h, model, selected, viewer, signalActions(h, model, viewer))]
				: []),
			doneDialog(h, model, viewer),
			snoozeDateDialog(h, model, viewer),
		],
	)
})
