import type * as Customers from "@hazel/domain/customers"
import { Submodel } from "foldkit"
import type { ChildAttribute, Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { type ChannelOption, channelMark } from "../../../customers/channels"
import { formatRelative } from "../../../customers/format"
import { type IssueRow, needsReply, PRIORITY_LABEL, STATUS_LABEL } from "../../../customers/issues"
import type { AccountRow, MemberRow } from "../../../customers/queries"
import { type IssueSlaRow, overdueByMs, slaDisplayOf } from "../../../customers/sla"
import { addFilterButton, filterBar, filterChip, searchBox, viewTabs } from "../../../customers/ui/filter-bar"
import { companyLogo, personAvatar } from "../../../customers/ui/identity"
import { queueAction, queueColumnHeader, queueList } from "../../../customers/ui/queue-row"
import { kbd, shortcutBar, type Shortcut } from "../../../customers/ui/shortcuts"
import { slaChip } from "../../../customers/ui/sla-chip"
import { pageHeader } from "../../../customers/ui/surface"
import {
	IconChartBar,
	IconCheck,
	IconChatBubble,
	IconExternalLink,
	IconMagnifier3,
	IconSupport,
	IconUser,
} from "../../../icons"
import { customersListRoute, hrefOf } from "../../../route"
import { badge } from "../../../ui/badge"
import { buttonClassName } from "../../../ui/button"
import { heading } from "../../../ui/heading"
import type * as Menu from "../../../ui/menu"
import { menuLabel, view as menuView } from "../../../ui/menu-view"
import type { PageViewInputs } from "../../contract"
import { ScrollInboxRow } from "./commands"
import { Message } from "./message"
import {
	ASSIGN_ME,
	ASSIGN_NONE,
	ASSIGNEE_LABEL,
	accountsByIdOfModel,
	assignEntries,
	type Filters,
	filterEntries,
	isNarrowed,
	type Model,
	priorityEntries,
	SEARCH_ID,
	selectedIssue,
	slasByIdOfModel,
	statusEntries,
	tabCounts,
	userIdOfAssignKey,
	type Viewer,
	visibleIssues,
	waitingSinceMs,
} from "./model"
import { viewerOf } from "./update"

/** The Support inbox page: Needs attention's sibling, one row per support issue. */

export const rowIdOf = (issueId: string) => `inbox-row-${issueId}`

const icon = { attributes: { "data-slot": "icon" } }

// CHIPS

const STATUS_INTENT = {
	new: "primary",
	waiting_on_us: "warning",
	waiting_on_customer: "secondary",
	on_hold: "outline",
	closed: "success",
} as const satisfies Record<Customers.IssueStatus, string>

export const statusChip = <M>(h: HtmlBuilder<M>, status: Customers.IssueStatus): Html =>
	badge(h, { intent: STATUS_INTENT[status], size: "sm" }, [STATUS_LABEL[status]])

const PRIORITY_CLASS = {
	none: "text-muted-fg",
	low: "text-muted-fg",
	medium: "text-fg",
	high: "text-warning",
	urgent: "text-danger",
} as const satisfies Record<Customers.IssuePriority, string>

export const priorityLabel = <M>(h: HtmlBuilder<M>, priority: Customers.IssuePriority): Html =>
	h.span(
		[h.Class(twMerge("inline-flex items-center gap-1.5 text-xs", PRIORITY_CLASS[priority]))],
		[
			IconChartBar(h, { className: "size-3.5 shrink-0" }),
			priority === "none" ? "None" : PRIORITY_LABEL[priority],
		],
	)

const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

/** `6h`, `2d`, `5m`. */
const ageText = (fromMs: number, nowMs: number): string => {
	const ms = Math.max(0, nowMs - fromMs)
	return ms < HOUR_MS
		? `${Math.floor(ms / 60_000)}m`
		: ms < DAY_MS
			? `${Math.floor(ms / HOUR_MS)}h`
			: `${Math.floor(ms / DAY_MS)}d`
}

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

/** The selected issue's actions: Assign, Status, Priority, Open in chat. */
const issueActions = (
	h: HtmlBuilder<Message>,
	model: Model,
	viewer: Viewer,
	issue: IssueRow,
): ReadonlyArray<Html> => [
	menu(h, model.assignMenu, {
		entries: assignEntries(model.members, viewer),
		trigger: (attributes, overlay) =>
			queueAction(h, { label: "Assign", icon: IconUser(h, icon), shortcut: "A", attributes, overlay }),
		content: (key) => [
			key === ASSIGN_ME
				? menuLabel(
						h,
						model.assignMenu.id,
						key,
						["Assign to me", kbd(h, "I")],
						"flex items-center justify-between gap-4",
					)
				: menuLabel(
						h,
						model.assignMenu.id,
						key,
						key === ASSIGN_NONE
							? "Unassign"
							: (model.members.find((member) => member.id === userIdOfAssignKey(key))?.name ??
									key),
					),
		],
		toMessage: (message) => Message.GotAssignMenuMessage({ message }),
	}),
	menu(h, model.statusMenu, {
		entries: statusEntries,
		trigger: (attributes, overlay) =>
			queueAction(h, { label: "Status", icon: IconCheck(h, icon), shortcut: "S", attributes, overlay }),
		content: (key) => [
			menuLabel(h, model.statusMenu.id, key, STATUS_LABEL[key as Customers.IssueStatus]),
			...(key === issue.status ? [IconCheck(h, { className: "ml-auto size-4 text-primary" })] : []),
		],
		toMessage: (message) => Message.GotStatusMenuMessage({ message }),
		className: "min-w-52",
	}),
	menu(h, model.priorityMenu, {
		entries: priorityEntries,
		trigger: (attributes, overlay) =>
			queueAction(h, {
				label: "Priority",
				icon: IconChartBar(h, icon),
				shortcut: "P",
				attributes,
				overlay,
			}),
		content: (key) => [
			menuLabel(h, model.priorityMenu.id, key, PRIORITY_LABEL[key as Customers.IssuePriority]),
			...(key === issue.priority ? [IconCheck(h, { className: "ml-auto size-4 text-primary" })] : []),
		],
		toMessage: (message) => Message.GotPriorityMenuMessage({ message }),
	}),
	queueAction(h, {
		label: "Open in chat",
		icon: IconExternalLink(h, icon),
		shortcut: "↵",
		onPress: Message.PressedInboxKey({ key: "open" }),
	}),
]

// ROWS

interface RowContext {
	readonly nowMs: number
	readonly accountsById: ReadonlyMap<string, AccountRow>
	readonly channelsById: ReadonlyMap<string, ChannelOption>
	readonly membersById: ReadonlyMap<string, MemberRow>
	readonly slasById: ReadonlyMap<string, IssueSlaRow>
	readonly selectedId: string | null
	readonly actions: ReadonlyArray<Html>
}

const issueRow = (h: HtmlBuilder<Message>, issue: IssueRow, context: RowContext): Html => {
	const account = context.accountsById.get(issue.accountId)
	const channel = context.channelsById.get(issue.sourceChannelId)
	const assignee = issue.assigneeUserId === null ? undefined : context.membersById.get(issue.assigneeUserId)
	const isSelected = issue.id === context.selectedId
	const hasActions = isSelected && context.actions.length > 0
	const waiting = needsReply(issue)
	const sla = context.slasById.get(issue.id)
	const hasChip = slaDisplayOf(sla, context.nowMs)._tag !== "None"
	const chip = slaChip(h, { sla, nowMs: context.nowMs, status: issue.status })
	const ageMs =
		issue.status === "closed"
			? (issue.closedAtMs ?? issue.lastMessageAtMs)
			: waiting
				? waitingSinceMs(issue)
				: issue.lastMessageAtMs
	return h.keyed("div")(
		issue.id,
		[
			h.Id(rowIdOf(issue.id)),
			h.Role("row"),
			h.AriaSelected(isSelected),
			...(isSelected ? [h.DataAttribute("focused", "true")] : []),
			h.Class(
				twMerge(
					"group/queue relative flex min-h-16 cursor-pointer items-center gap-4 border-border border-t px-4 py-3 first:border-t-0",
					"max-md:flex-wrap max-md:gap-x-3 max-md:gap-y-1.5",
					"transition-colors hover:bg-wash data-focused:bg-wash",
					"before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-primary before:opacity-0 data-focused:before:opacity-100",
				),
			),
			h.OnClick(Message.ClickedRow({ issueId: issue.id })),
		],
		[
			// Account and channel.
			h.div(
				[
					h.Role("cell"),
					h.Class(
						"flex w-52 shrink-0 items-center gap-3 max-md:w-auto max-md:min-w-0 max-md:flex-1",
					),
				],
				[
					companyLogo(h, {
						name: account?.name ?? "Customer",
						logoUrl: account?.logoUrl ?? null,
						size: "sm",
					}),
					h.div(
						[h.Class("flex min-w-0 flex-col")],
						[
							h.span(
								[h.Class("truncate font-medium text-fg text-sm")],
								[account?.name ?? "Customer"],
							),
							h.span(
								[h.Class("flex min-w-0 items-center gap-1 text-muted-fg text-xs")],
								channel === undefined
									? ["Linked channel"]
									: [
											channelMark(h, channel, "size-3"),
											h.span([h.Class("truncate")], [channel.name]),
										],
							),
						],
					),
				],
			),
			// Title and activity.
			h.div(
				[
					h.Role("cell"),
					h.Class(
						"flex min-w-0 flex-1 flex-col gap-0.5 max-md:order-last max-md:basis-full max-md:pl-11",
					),
				],
				[
					h.span([h.Class("truncate text-fg text-sm")], [issue.title]),
					h.span(
						[h.Class("flex min-w-0 items-center gap-2 truncate text-muted-fg text-xs")],
						[
							IconChatBubble(h, { className: "size-3 shrink-0" }),
							h.span(
								[h.Class("truncate")],
								[
									[
										`${issue.messageCount} message${issue.messageCount === 1 ? "" : "s"}`,
										`opened ${formatRelative(new Date(issue.openedAtMs), new Date(context.nowMs))}`,
										...(issue.reopenCount > 0 ? [`reopened ${issue.reopenCount}×`] : []),
									].join(" · "),
								],
							),
							...issue.tags.map((tag) =>
								h.span(
									[h.Class("rounded-sm bg-secondary px-1.5 py-px text-secondary-fg")],
									[tag],
								),
							),
						],
					),
					// The SLA chip under the title until the list is wide enough for its column, and on
					// the selected row, whose actions take the columns' room.
					...(hasChip
						? [
								h.div(
									[h.Class(twMerge("mt-1 flex min-w-0", !isSelected && "@6xl:hidden"))],
									[chip],
								),
							]
						: []),
				],
			),
			// The selected row's actions take the chips' place on a wide screen; narrower, the chips stay
			// and the actions wrap onto a line of their own, so touch has them too.
			h.div(
				[h.Role("cell"), h.Class(twMerge("w-40 shrink-0 max-md:w-auto", hasActions && "lg:hidden"))],
				[statusChip(h, issue.status)],
			),
			h.div(
				[h.Role("cell"), h.Class(twMerge("w-24 shrink-0 max-md:hidden", hasActions && "lg:hidden"))],
				[priorityLabel(h, issue.priority)],
			),
			...(hasActions
				? [
						h.div(
							[
								h.Class(
									"flex shrink-0 flex-wrap items-center gap-1.5 max-lg:order-last max-lg:basis-full max-lg:pl-11",
								),
								h.OnClick(Message.ClickedRowActions(), { propagation: "Stop" }),
							],
							[...context.actions],
						),
					]
				: []),
			// The SLA column, on a wide list only (the selected row shows its chip under the title).
			...(isSelected
				? []
				: [
						h.div(
							[h.Role("cell"), h.Class("hidden w-52 shrink-0 @6xl:flex")],
							hasChip ? [chip] : [],
						),
					]),
			h.div(
				[
					h.Role("cell"),
					h.Title(
						waiting
							? "Waiting on us since the customer's last message"
							: "Since the last message",
					),
					h.Class(
						twMerge(
							"w-10 shrink-0 text-right text-xs tabular-nums",
							waiting ? "font-medium text-warning" : "text-muted-fg",
						),
					),
				],
				[ageText(ageMs, context.nowMs)],
			),
			h.div(
				[h.Role("cell"), h.Class("flex w-7 shrink-0 justify-end")],
				[
					personAvatar(
						h,
						assignee === undefined
							? null
							: { name: assignee.name, avatarUrl: assignee.avatarUrl },
					),
				],
			),
		],
	)
}

// HEADER AND CONTROLS

const header = (h: HtmlBuilder<Message>, model: Model, viewer: Viewer, orgSlug: string | null): Html => {
	const issues = visibleIssues(model, viewer)
	const waiting = issues.filter(needsReply).length
	const slasById = slasByIdOfModel(model)
	const overdue = issues.filter(
		(issue) => overdueByMs(slasById.get(issue.id), viewer.nowMs) !== null,
	).length
	const subtitle =
		model.issues === null || model.accounts === null
			? "Loading…"
			: issues.length === 0 && isNarrowed(model)
				? "No issues match your search and filters"
				: model.tab === "open"
					? issues.length === 0
						? "Nothing waiting on you"
						: [
								`${issues.length} open issue${issues.length === 1 ? "" : "s"}`,
								`${waiting} waiting on us`,
								...(overdue > 0 ? [`${overdue} overdue`] : []),
							].join(" · ")
					: model.tab === "on_hold"
						? `${issues.length} on hold`
						: `${issues.length} closed in the last 30 days`
	return pageHeader(h, {
		title: "Support inbox",
		subtitle,
		actions:
			orgSlug === null
				? []
				: [
						h.a(
							[
								h.Href(hrefOf(customersListRoute(orgSlug))),
								h.Class(buttonClassName({ intent: "outline", size: "sm" })),
							],
							["Customers"],
						),
					],
	})
}

const filterChips = (h: HtmlBuilder<Message>, model: Model, filters: Filters): ReadonlyArray<Html> => [
	...(filters.assignee === "anyone"
		? []
		: [
				filterChip(h, {
					field: "Assignee",
					operator: "is",
					value: ASSIGNEE_LABEL[filters.assignee],
					onRemove: Message.ClearedFilter({ field: "assignee" }),
				}),
			]),
	...(filters.waitingOnUs
		? [
				filterChip(h, {
					field: "Waiting",
					operator: "is",
					value: "On us",
					onRemove: Message.ClearedFilter({ field: "waitingOnUs" }),
				}),
			]
		: []),
	...(filters.overdue
		? [
				filterChip(h, {
					field: "SLA",
					operator: "is",
					value: "Overdue",
					onRemove: Message.ClearedFilter({ field: "overdue" }),
				}),
			]
		: []),
	...(filters.status === null
		? []
		: [
				filterChip(h, {
					field: "Status",
					operator: "is",
					value: STATUS_LABEL[filters.status],
					onRemove: Message.ClearedFilter({ field: "status" }),
				}),
			]),
	...(filters.priority === null
		? []
		: [
				filterChip(h, {
					field: "Priority",
					operator: "is",
					value: PRIORITY_LABEL[filters.priority],
					onRemove: Message.ClearedFilter({ field: "priority" }),
				}),
			]),
	...(filters.accountId === null
		? []
		: [
				filterChip(h, {
					field: "Account",
					operator: "is",
					value: accountsByIdOfModel(model).get(filters.accountId)?.name ?? "Customer",
					onRemove: Message.ClearedFilter({ field: "accountId" }),
				}),
			]),
]

const filterItemContent = (h: HtmlBuilder<Message>, model: Model, key: string): ReadonlyArray<Html> => {
	const field = key.slice(0, key.indexOf(":"))
	const value = key.slice(key.indexOf(":") + 1)
	const { filters } = model
	const label =
		field === "assignee"
			? ASSIGNEE_LABEL[value as keyof typeof ASSIGNEE_LABEL]
			: field === "waitingOnUs"
				? "Waiting on us"
				: field === "overdue"
					? "Overdue"
					: field === "status"
						? STATUS_LABEL[value as Customers.IssueStatus]
						: field === "priority"
							? PRIORITY_LABEL[value as Customers.IssuePriority]
							: (accountsByIdOfModel(model).get(value)?.name ?? value)
	const isActive =
		field === "waitingOnUs"
			? filters.waitingOnUs
			: field === "overdue"
				? filters.overdue
				: String((filters as Record<string, unknown>)[field]) === value
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
				placeholder: "Search issues…",
				onInput: (value) => Message.ChangedSearch({ value }),
				onClear: Message.ClearedSearch(),
			}),
			...filterChips(h, model, model.filters),
			menu(h, model.filterMenu, {
				entries: filterEntries(model),
				trigger: (attributes, overlay) => addFilterButton(h, { attributes, overlay }),
				content: (key) => filterItemContent(h, model, key),
				toMessage: (message) => Message.GotFilterMenuMessage({ message }),
				className: "max-h-96 min-w-56",
			}),
		],
		end: [],
	})

// LIST

const SHORTCUTS: ReadonlyArray<Shortcut> = [
	{ keys: ["J", "K"], label: "Move" },
	{ keys: ["A"], label: "Assign" },
	{ keys: ["I"], label: "Assign to me" },
	{ keys: ["S"], label: "Status" },
	{ keys: ["P"], label: "Priority" },
	{ keys: ["C"], label: "Close / reopen" },
	{ keys: ["Enter"], label: "Open in chat" },
	{ keys: ["O"], label: "Open customer" },
]

const emptyState = (
	h: HtmlBuilder<Message>,
	options: Readonly<{ glyph: Html; title: string; body: string; actions?: ReadonlyArray<Html> }>,
): Html =>
	h.div(
		[h.Class("flex flex-col items-center gap-4 rounded-xl border border-border px-6 py-14 text-center")],
		[
			h.div(
				[h.Class("flex size-11 items-center justify-center rounded-xl bg-secondary text-muted-fg")],
				[options.glyph],
			),
			h.div(
				[h.Class("flex flex-col gap-1")],
				[
					heading(h, { variant: "subsection", level: 2 }, [options.title]),
					h.p([h.Class("max-w-sm text-muted-fg text-sm")], [options.body]),
				],
			),
			...(options.actions === undefined || options.actions.length === 0
				? []
				: [h.div([h.Class("flex items-center gap-2")], [...options.actions])]),
		],
	)

const list = (h: HtmlBuilder<Message>, model: Model, viewer: Viewer, orgSlug: string | null): Html => {
	if (model.issues === null || model.accounts === null)
		return queueList(
			h,
			{ ariaLabel: "Issues loading" },
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
	const issues = visibleIssues(model, viewer)
	if (model.issues.length === 0)
		return emptyState(h, {
			glyph: IconSupport(h, { className: "size-5" }),
			title: "No support issues yet",
			body: "An issue opens when a customer starts a conversation in a channel linked to them. Link a customer's channels from their page, or open an issue on any message in chat.",
			actions:
				orgSlug === null
					? []
					: [
							h.a(
								[
									h.Href(hrefOf(customersListRoute(orgSlug))),
									h.Class(buttonClassName({ intent: "outline", size: "sm" })),
								],
								["Go to customers"],
							),
						],
		})
	if (issues.length === 0 && isNarrowed(model))
		return emptyState(h, {
			glyph: IconMagnifier3(h, { className: "size-5" }),
			title: "No matches",
			body: "No issues in this tab match your search and filters.",
			actions: [
				queueAction(h, {
					label: "Clear search and filters",
					onPress: Message.PressedClearNarrowing(),
				}),
			],
		})
	if (issues.length === 0) {
		const others = tabCounts({ ...model, filters: { ...model.filters, assignee: "anyone" } }, viewer)[
			model.tab
		]
		return model.tab === "open"
			? emptyState(h, {
					glyph: IconCheck(h, { className: "size-5" }),
					title: "Inbox zero",
					body: "No open issues are waiting on you or unassigned.",
					actions:
						model.filters.assignee !== "anyone" && others > 0
							? [
									queueAction(h, {
										label: `Show all assignees · ${others} open`,
										icon: IconUser(h, icon),
										onPress: Message.PressedShowAllAssignees(),
									}),
								]
							: [],
				})
			: h.div(
					[h.Class("rounded-xl border border-border px-6 py-14 text-center text-muted-fg text-sm")],
					[model.tab === "on_hold" ? "Nothing is on hold." : "Nothing closed in the last 30 days."],
				)
	}
	const selected = selectedIssue(model)
	const context: RowContext = {
		nowMs: viewer.nowMs,
		accountsById: accountsByIdOfModel(model),
		channelsById: new Map(model.channels.map((channel) => [channel.id, channel])),
		membersById: new Map(model.members.map((member) => [member.id, member])),
		slasById: slasByIdOfModel(model),
		selectedId: model.selectedId,
		actions: selected === undefined ? [] : issueActions(h, model, viewer, selected),
	}
	// A container: the SLA column shows by the list's width, as the shell's sidebars take a share.
	return queueList(h, { ariaLabel: "Support issues", className: "@container" }, [
		queueColumnHeader(h, [
			{ label: "Customer", className: "w-52" },
			{ label: "Issue", className: "flex-1" },
			{ label: "Status", className: "w-40" },
			{ label: "Priority", className: "w-24 max-md:hidden" },
			{ label: "SLA", className: "hidden w-52 @6xl:block" },
			{ label: model.tab === "closed" ? "Closed" : "Waiting", className: "w-10 text-right" },
			{ label: "", className: "w-7" },
		]),
		...issues.map((issue) => issueRow(h, issue, context)),
	])
}

// PAGE

export const view = Submodel.defineView<Model, Message, PageViewInputs>((model, { shared }, h) => {
	const viewer = viewerOf(shared)
	const counts = tabCounts(model, viewer)
	return h.div(
		[h.Class("flex h-full max-h-dvh min-h-0 w-full")],
		[
			h.div(
				[h.Class("flex min-w-0 flex-1 flex-col overflow-y-auto")],
				[
					h.div(
						[h.Class("mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-6 lg:px-8")],
						[
							header(h, model, viewer, shared.orgSlug),
							viewTabs(h, {
								ariaLabel: "Inbox",
								tabs: [
									{ key: "open", label: "Open", count: counts.open },
									{ key: "on_hold", label: "On hold", count: counts.on_hold },
									{ key: "closed", label: "Closed", count: counts.closed },
								],
								selected: model.tab,
								onSelect: (tab) => Message.ClickedTab({ tab }),
							}),
							controls(h, model),
							list(h, model, viewer, shared.orgSlug),
							...(model.selectedId === null
								? []
								: [
										h.keyed("span")(`scroll-${model.selectedId}`, [
											h.Class("hidden"),
											h.OnMount(ScrollInboxRow({ rowId: rowIdOf(model.selectedId) })),
										]),
									]),
							shortcutBar(h, SHORTCUTS),
						],
					),
				],
			),
		],
	)
})
