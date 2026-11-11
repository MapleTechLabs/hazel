import type { CustomerProvider, UnmatchedEntityType } from "@hazel/domain/customers"
import { Option } from "effect"
import type { ChildAttribute, Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { formatCount, formatMoney } from "../../../../customers/format"
import { providerOf } from "../../../../customers/providers"
import type { AccountRow } from "../../../../customers/queries"
import { companyLogo, sourceMark } from "../../../../customers/ui/identity"
import { kbd } from "../../../../customers/ui/shortcuts"
import {
	IconCheck,
	IconChevronDown,
	IconDots,
	IconEyeSlash,
	IconMagnifier3,
	IconPlus,
} from "../../../../icons"
import { badge } from "../../../../ui/badge"
import { button } from "../../../../ui/button"
import { checkbox } from "../../../../ui/checkbox"
import * as Menu from "../../../../ui/menu"
import { menuLabel, view as menuView } from "../../../../ui/menu-view"
import * as Popover from "../../../../ui/popover"
import { Message } from "./message"
import {
	type Confidence,
	confidenceOf,
	CREATE_KEY,
	IGNORE_KEY,
	ignorePatternsOf,
	linkCandidates,
	linkPopoverId,
	type Model,
	type RecordGroup,
	type RecordRow,
	rowMenuEntries,
	rowMenuId,
} from "./model"

/** The records table (Wonder `ids`): grouped by source and kind, a row's suggestion and its actions. */

// COPY

const ACCOUNT_NOUN = {
	clerk: "organizations",
	stripe: "customers",
	autumn: "customers",
	maple: "groups",
} as const satisfies Record<CustomerProvider, string>

/** What a source calls its records of a kind: Stripe "customers", Maple "groups". */
export const nounOf = (provider: CustomerProvider, entityType: UnmatchedEntityType): string =>
	entityType === "account" ? ACCOUNT_NOUN[provider] : entityType === "contact" ? "users" : `${entityType}s`

const VALUE_SUFFIX = {
	account: "MRR",
	contact: "",
	subscription: "MRR",
	invoice: "due",
} as const satisfies Record<UnmatchedEntityType, string>

const CONFIDENCE_LABEL = { high: "High", medium: "Medium", low: "Low" } as const satisfies Record<
	Confidence,
	string
>
const CONFIDENCE_INTENT = { high: "success", medium: "warning", low: "secondary" } as const satisfies Record<
	Confidence,
	string
>

const icon = { attributes: { "data-slot": "icon" } }

// CELLS

const sourceCell = (h: HtmlBuilder<Message>, record: RecordRow): Html => {
	const details = [...new Set([record.externalId, record.email, record.domain])].filter(
		(value): value is string => value !== null && value !== record.label,
	)
	return h.div(
		[h.Class("flex min-w-0 items-center gap-3")],
		[
			sourceMark(h, record.provider),
			h.div(
				[h.Class("flex min-w-0 flex-col")],
				[
					h.span([h.Class("truncate font-medium text-fg text-sm")], [record.label]),
					...(details.length === 0
						? []
						: [
								h.span(
									[h.Class("truncate font-mono text-muted-fg text-xs")],
									[details.join(" · ")],
								),
							]),
				],
			),
		],
	)
}

const valueCell = (h: HtmlBuilder<Message>, record: RecordRow): Html => {
	const line = (value: string, unit: string, detail: string | null) =>
		h.div(
			[h.Class("flex flex-col items-end")],
			[
				h.span(
					[h.Class("whitespace-nowrap text-fg text-sm tabular-nums")],
					[
						value,
						...(unit === "" ? [] : [h.span([h.Class("ml-1 text-muted-fg text-xs")], [unit])]),
					],
				),
				...(detail === null ? [] : [h.span([h.Class("text-muted-fg text-xs")], [detail])]),
			],
		)
	if (record.valueMinor !== null)
		return line(
			formatMoney(record.valueMinor, record.currency ?? undefined),
			VALUE_SUFFIX[record.entityType],
			null,
		)
	if (record.eventCount30d !== null) return line(formatCount(record.eventCount30d), "events", "30d")
	return h.span([h.Class("text-muted-fg text-sm")], ["—"])
}

const confidenceBadge = (h: HtmlBuilder<Message>, record: RecordRow, confidence: Confidence): Html =>
	badge(h, { intent: CONFIDENCE_INTENT[confidence], size: "sm", isPill: true }, [
		record.confidence === null
			? CONFIDENCE_LABEL[confidence]
			: `${CONFIDENCE_LABEL[confidence]} · ${Math.round(record.confidence * 100)}%`,
	])

const suggestionCell = (
	h: HtmlBuilder<Message>,
	record: RecordRow,
	account: AccountRow | undefined,
): Html => {
	const confidence = confidenceOf(record)
	const reason = h.span([h.Class("line-clamp-2 text-muted-fg text-xs")], [record.reason])
	if (confidence === null || account === undefined)
		return h.div(
			[h.Class("flex min-w-0 flex-col gap-0.5")],
			[h.span([h.Class("text-muted-fg text-sm")], ["No suggestion"]), reason],
		)
	return h.div(
		[h.Class("flex min-w-0 items-start gap-2.5")],
		[
			companyLogo(h, { name: account.name, logoUrl: account.logoUrl, size: "xs", className: "mt-0.5" }),
			h.div(
				[h.Class("flex min-w-0 flex-col gap-0.5")],
				[
					h.div(
						[h.Class("flex min-w-0 items-center gap-2")],
						[
							h.span([h.Class("truncate font-medium text-fg text-sm")], [account.name]),
							confidenceBadge(h, record, confidence),
						],
					),
					reason,
				],
			),
		],
	)
}

// LINK TO…

const toLinkPopoverMessage = (recordId: RecordRow["id"]) => (message: Popover.Message) =>
	Message.GotLinkPopoverMessage({ recordId, message })

const linkResults = (
	h: HtmlBuilder<Message>,
	model: Model,
	record: RecordRow,
	query: string,
): ReadonlyArray<Html> => {
	const { matches, total } = linkCandidates(model.accounts ?? [], query, record.suggestedAccountId)
	return [
		h.div(
			[h.Class("flex items-center gap-2 border-border border-b px-3 py-2")],
			[
				IconMagnifier3(h, { className: "size-4 shrink-0 text-muted-fg" }),
				h.input([
					h.Type("text"),
					h.Value(query),
					h.Placeholder("Search accounts…"),
					h.AriaLabel("Search accounts"),
					h.Autofocus(true),
					h.Class(
						"min-w-0 flex-1 bg-transparent text-fg text-sm outline-hidden placeholder:text-muted-fg",
					),
					h.OnInput((value) => Message.ChangedLinkQuery({ value })),
					h.OnKeyDownPreventDefault((key) =>
						key === "Enter"
							? Option.some(Message.SubmittedLinkQuery({ recordId: record.id }))
							: Option.none(),
					),
				]),
				h.span(
					[h.Class("shrink-0 text-muted-fg text-xs tabular-nums")],
					[
						`${formatCount(Math.min(matches.length, total))} of ${formatCount(model.accounts?.length ?? 0)}`,
					],
				),
			],
		),
		h.ul(
			[h.AriaLabel("Accounts"), h.Class("flex max-h-72 flex-col overflow-y-auto p-1")],
			matches.length === 0
				? [h.li([h.Class("px-2 py-3 text-center text-muted-fg text-sm")], ["No accounts match"])]
				: matches.map((account, index) =>
						h.li(
							[h.Key(account.id)],
							[
								h.button(
									[
										h.Type("button"),
										h.Class(
											"flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-left outline-hidden hover:bg-secondary focus-visible:bg-secondary",
										),
										h.OnClick(
											Message.PickedLinkAccount({
												recordId: record.id,
												accountId: account.id,
											}),
										),
									],
									[
										companyLogo(h, {
											name: account.name,
											logoUrl: account.logoUrl,
											size: "xs",
										}),
										h.span(
											[h.Class("flex min-w-0 flex-1 flex-col")],
											[
												h.span([h.Class("truncate text-fg text-sm")], [account.name]),
												...(account.domain === null
													? []
													: [
															h.span(
																[h.Class("truncate text-muted-fg text-xs")],
																[account.domain],
															),
														]),
											],
										),
										...(index === 0 ? [kbd(h, "Enter", "shrink-0")] : []),
									],
								),
							],
						),
					),
		),
		...(record.entityType === "account"
			? [
					h.div(
						[h.Class("border-border border-t p-1")],
						[
							h.button(
								[
									h.Type("button"),
									h.Class(
										"flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-fg text-sm outline-hidden hover:bg-secondary focus-visible:bg-secondary",
									),
									h.OnClick(Message.PressedCreateAccount({ recordId: record.id })),
								],
								[
									IconPlus(h, { className: "size-4 text-muted-fg" }),
									`Create account “${record.label}”`,
								],
							),
						],
					),
				]
			: []),
	]
}

const linkTo = (h: HtmlBuilder<Message>, model: Model, record: RecordRow): Html => {
	const search = model.linkSearch?.recordId === record.id ? model.linkSearch : null
	const popover = search?.popover ?? Popover.init(linkPopoverId(record.id))
	return h.submodel({
		slotId: popover.id,
		model: popover,
		view: Popover.view,
		viewInputs: {
			toTrigger: (attributes: ReadonlyArray<ChildAttribute>) =>
				button(h, { intent: "outline", size: "xs", attributes }, [
					"Link to…",
					IconChevronDown(h, icon),
				]),
			toContent: () => (popover.isOpen ? linkResults(h, model, record, search?.query ?? "") : []),
			placement: "bottom end",
			className: "w-80 p-0",
		},
		toParentMessage: toLinkPopoverMessage(record.id),
	})
}

// ⋯

const rowMenu = (h: HtmlBuilder<Message>, model: Model, record: RecordRow): Html => {
	const menu =
		model.rowMenu?.recordId === record.id
			? model.rowMenu.menu
			: Menu.init({ id: rowMenuId(record.id), placement: "bottom end" })
	const patterns = ignorePatternsOf(record)
	const noun = nounOf(record.provider, record.entityType)
	const label = (key: string): string => {
		if (key === CREATE_KEY) return "Create new account"
		if (key === IGNORE_KEY) return "Ignore this record"
		const pattern = patterns.find((option) => option.key === key)
		return pattern?.field === "domain"
			? `Ignore all from ${pattern.pattern}`
			: `Ignore all “${pattern?.pattern}” ${noun}`
	}
	return h.submodel({
		slotId: menu.id,
		model: menu,
		view: menuView,
		viewInputs: {
			entries: rowMenuEntries(record),
			toTrigger: (attributes: ReadonlyArray<ChildAttribute>, overlay: Html) =>
				button(
					h,
					{
						intent: "plain",
						size: "sq-xs",
						attributes: [h.AriaLabel("More actions"), ...attributes],
					},
					[IconDots(h, { className: "size-4" }), overlay],
				),
			content: (key: string) => [
				key === CREATE_KEY
					? IconPlus(h, { className: "size-4" })
					: IconEyeSlash(h, { className: "size-4" }),
				menuLabel(h, menu.id, key, label(key)),
			],
			className: "min-w-56",
		},
		toParentMessage: (message: Menu.Message) =>
			Message.GotRowMenuMessage({ recordId: record.id, message }),
	})
}

const rowActions = (h: HtmlBuilder<Message>, model: Model, record: RecordRow): Html =>
	h.div(
		[h.Class("flex items-center justify-end gap-1.5 whitespace-nowrap")],
		[
			...(record.suggestedAccountId !== null
				? [
						button(
							h,
							{
								intent: "outline",
								size: "xs",
								onPress: Message.PressedLinkSuggested({ recordId: record.id }),
							},
							[IconCheck(h, icon), "Link"],
						),
					]
				: record.entityType === "account"
					? [
							button(
								h,
								{
									intent: "outline",
									size: "xs",
									onPress: Message.PressedCreateAccount({ recordId: record.id }),
								},
								[IconPlus(h, icon), "Create"],
							),
						]
					: []),
			linkTo(h, model, record),
			rowMenu(h, model, record),
		],
	)

// TABLE

export interface TableContext {
	readonly id: string
	readonly ariaLabel: string
	readonly accountsById: ReadonlyMap<string, AccountRow>
	/** Admins act: checkboxes and row actions. */
	readonly isAdmin: boolean
}

const cell = "px-3 first:pl-4 last:pr-4"
/** Fits Create or Link, Link to… and ⋯ on one line; the source column takes the rest and truncates. */
const actionsWidth = "w-60"

/** One total per currency, never summed across them: `$1,840 + €200`. */
const moneyTotal = (records: RecordGroup["records"]): string | null => {
	const totals = new Map<string | null, number>()
	for (const record of records)
		if (record.valueMinor !== null)
			totals.set(record.currency, (totals.get(record.currency) ?? 0) + record.valueMinor)
	return totals.size === 0
		? null
		: [...totals].map(([currency, minor]) => formatMoney(minor, currency ?? undefined)).join(" + ")
}

/** `STRIPE CUSTOMERS · 5 · $1,840 MRR`, `MAPLE GROUPS · 9 · 6,951 EVENTS · 30D`. */
const groupSummary = (group: RecordGroup): string => {
	const money = moneyTotal(group.records)
	const events = group.records.reduce((sum, record) => sum + (record.eventCount30d ?? 0), 0)
	const value =
		money !== null
			? [`${money} ${VALUE_SUFFIX[group.entityType]}`.trim()]
			: events > 0
				? [`${formatCount(events)} events · 30d`]
				: []
	return [
		`${providerOf(group.provider).name} ${nounOf(group.provider, group.entityType)}`,
		formatCount(group.records.length),
		...value,
	].join(" · ")
}

export const recordsTable = (
	h: HtmlBuilder<Message>,
	model: Model,
	groups: ReadonlyArray<RecordGroup>,
	context: TableContext,
): Html => {
	const records = groups.flatMap((group) => group.records)
	const selectedCount = records.filter((record) => model.selected.includes(record.id)).length
	const columnCount = context.isAdmin ? 5 : 3
	const header = (label: string, className: string) =>
		h.th(
			[h.Scope("col"), h.Class(twMerge("h-10 font-normal text-muted-fg text-sm", cell, className))],
			[label],
		)
	const row = (record: RecordRow): Html => {
		const isSelected = model.selected.includes(record.id)
		return h.tr(
			[
				h.Key(record.id),
				h.Class(twMerge("transition-colors", isSelected ? "bg-primary-subtle/40" : "hover:bg-wash")),
			],
			[
				...(context.isAdmin
					? [
							h.td(
								[h.Class("w-10 pl-4")],
								[
									checkbox(
										h,
										{
											id: `${context.id}-${record.id}`,
											isSelected,
											ariaLabel: `Select ${record.label}`,
											onChange: (next) =>
												Message.ToggledRecord({
													recordId: record.id,
													isSelected: next,
												}),
										},
										[],
									),
								],
							),
						]
					: []),
				h.td([h.Class(twMerge("py-3", cell))], [sourceCell(h, record)]),
				h.td([h.Class(twMerge("w-32 py-3 text-right", cell))], [valueCell(h, record)]),
				h.td(
					[h.Class(twMerge("w-[34%] py-3 max-md:hidden", cell))],
					[suggestionCell(h, record, context.accountsById.get(record.suggestedAccountId ?? ""))],
				),
				...(context.isAdmin
					? [h.td([h.Class(twMerge("py-3", cell, actionsWidth))], [rowActions(h, model, record)])]
					: []),
			],
		)
	}
	return h.table(
		[h.AriaLabel(context.ariaLabel), h.Class("w-full table-fixed border-separate border-spacing-0")],
		[
			h.thead(
				[],
				[
					h.tr(
						[h.Class("[&>th]:border-border [&>th]:border-b")],
						[
							...(context.isAdmin
								? [
										h.th(
											[h.Class("w-10 pl-4")],
											[
												checkbox(
													h,
													{
														id: `${context.id}-all`,
														isSelected:
															records.length > 0 &&
															selectedCount === records.length,
														isIndeterminate:
															selectedCount > 0 &&
															selectedCount < records.length,
														ariaLabel: "Select all records",
														onChange: (isSelected) =>
															Message.ToggledAllRecords({ isSelected }),
													},
													[],
												),
											],
										),
									]
								: []),
							header("Source record", "text-left"),
							header("Value", "w-32 text-right"),
							header("Suggested account", "w-[34%] text-left max-md:hidden"),
							...(context.isAdmin ? [header("", actionsWidth)] : []),
						],
					),
				],
			),
			...groups.map((group) =>
				h.tbody(
					[
						h.Key(`${group.provider}-${group.entityType}`),
						h.Class("[&>tr>td]:border-border [&>tr>td]:border-b"),
					],
					[
						h.tr(
							[],
							[
								h.th(
									[
										h.Scope("colgroup"),
										h.Attribute("colspan", String(columnCount)),
										h.Class(
											"bg-secondary/40 px-4 py-1.5 text-left font-medium text-[11px] text-muted-fg uppercase tracking-wider",
										),
									],
									[groupSummary(group)],
								),
							],
						),
						...group.records.map(row),
					],
				),
			),
		],
	)
}

/** Skeleton rows while the first page loads. */
export const loadingTable = (h: HtmlBuilder<Message>): Html =>
	h.div(
		[h.AriaBusy(true), h.AriaLabel("Loading records"), h.Class("flex flex-col")],
		Array.from({ length: 6 }, (_, index) =>
			h.div(
				[
					h.Key(`skeleton-${index}`),
					h.Class("flex h-16 items-center gap-4 border-border border-b px-4 last:border-b-0"),
				],
				[
					h.span([h.Class("size-8 shrink-0 animate-pulse rounded-lg bg-secondary")]),
					h.span([h.Class("h-3 w-1/3 animate-pulse rounded bg-secondary")]),
					h.span([h.Class("ml-auto h-3 w-1/4 animate-pulse rounded bg-secondary")]),
				],
			),
		),
	)
