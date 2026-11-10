import * as Customers from "@hazel/domain/customers"
import type { ChildAttribute, Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { distributionBar } from "../../../customers/charts/distribution"
import { formatCount, formatMoney } from "../../../customers/format"
import type { AccountRow, MemberRow } from "../../../customers/queries"
import { HEALTH_FILL, HEALTH_LABEL, STAGE_LABEL } from "../../../customers/ui/badges"
import { IconChevronDown, IconChevronRight } from "../../../icons"
import { button } from "../../../ui/button"
import { checkbox } from "../../../ui/checkbox"
import { input } from "../../../ui/input"
import { switchControl } from "../../../ui/switch"
import { Message } from "./message"
import {
	type Builder,
	COLUMN_NAME,
	countMatching,
	type FilterField,
	hiddenColumns,
	plansOf,
	shownColumns,
	tagsOf,
	toggleIn,
	type Viewer,
	withFilter,
} from "./model"

/** The filter builder's panes, the chips' wording and the column picker. */

const FIELD_LABEL = {
	stage: "Stage",
	plan: "Plan",
	owner: "Owner",
	tag: "Tag",
	health: "Health",
	mrr: "MRR",
	last_active: "Last active",
	signals: "Open risk signals",
} as const satisfies Record<FilterField, string>

const FIELD_KIND = {
	stage: "Select",
	plan: "Select",
	owner: "Person",
	tag: "Select",
	health: "Status",
	mrr: "Amount",
	last_active: "Date",
	signals: "Yes / no",
} as const satisfies Record<FilterField, string>

const FIELD_GROUPS: ReadonlyArray<readonly [string, ReadonlyArray<FilterField>]> = [
	["Account", ["stage", "plan", "owner", "tag"]],
	["Health and usage", ["health", "last_active"]],
	["Revenue", ["mrr"]],
	["Signals", ["signals"]],
]

const FIELD_DESCRIPTION = {
	stage: "Where the account is in its lifecycle, from billing.",
	plan: "The plan of its largest subscription.",
	owner: "Who in your team looks after the account.",
	tag: "Tags your team added.",
	health: "The account's health band from its latest score.",
	mrr: "Monthly recurring revenue, in your reporting currency.",
	last_active: "Most recent activity from any contact, from Maple events and Clerk sign-ins.",
	signals: "Whether the account has an open risk signal now.",
} as const satisfies Record<FilterField, string>

// CHIPS

const joined = (values: ReadonlyArray<string>) => values.join(", ")

/** A chip's `field operator value`, or none when the field is not set. */
export const chipOf = (
	field: FilterField,
	filters: Customers.ViewFilters,
	members: ReadonlyArray<MemberRow>,
	currency: string,
): Readonly<{ field: string; operator: string; value: string }> | null => {
	const anyOf = (values: ReadonlyArray<string> | undefined) =>
		values === undefined || values.length === 0
			? null
			: {
					field: FIELD_LABEL[field],
					operator: values.length === 1 ? "is" : "is any of",
					value: joined(values),
				}
	switch (field) {
		case "stage":
			return anyOf(filters.lifecycleStages?.map((stage) => STAGE_LABEL[stage]))
		case "health":
			return anyOf(filters.healthStatuses?.map((status) => HEALTH_LABEL[status]))
		case "plan":
			return anyOf(filters.planNames)
		case "tag":
			return anyOf(filters.tagsAny)
		case "owner": {
			const names = [
				...(filters.ownedByMe ? ["Me"] : []),
				...(filters.ownerUserIds ?? []).map(
					(id) => members.find((member) => member.id === id)?.name ?? "Someone",
				),
				...(filters.unowned ? ["Unassigned"] : []),
			]
			return anyOf(names)
		}
		case "mrr": {
			const min = filters.minMrrMinor
			const max = filters.maxMrrMinor
			const value =
				min !== undefined && max !== undefined
					? `${formatMoney(min, currency)}–${formatMoney(max, currency)}`
					: min !== undefined
						? `≥ ${formatMoney(min, currency)}`
						: max !== undefined
							? `≤ ${formatMoney(max, currency)}`
							: filters.payingOnly
								? `> ${formatMoney(0, currency)}`
								: null
			return value === null ? null : { field: "MRR", operator: "", value }
		}
		case "last_active":
			return filters.inactiveForDays !== undefined
				? {
						field: "Last active",
						operator: "more than",
						value: `${filters.inactiveForDays} days ago`,
					}
				: filters.lastActiveWithinDays !== undefined
					? {
							field: "Last active",
							operator: "within",
							value: `${filters.lastActiveWithinDays} days`,
						}
					: null
		case "signals":
			return filters.hasOpenRiskSignals === undefined
				? null
				: {
						field: "Open risk signals",
						operator: "",
						value: filters.hasOpenRiskSignals ? "Yes" : "None",
					}
	}
}

// BUILDER

const option = (
	h: HtmlBuilder<Message>,
	id: string,
	label: Html | string,
	isSelected: boolean,
	next: Customers.ViewFilters,
): Html =>
	h.div(
		[h.Class("flex h-8 items-center rounded-md px-2 hover:bg-wash")],
		[
			checkbox(
				h,
				{
					id,
					isSelected,
					onChange: () => Message.ChangedPendingFilters({ filters: next }),
				},
				typeof label === "string" ? label : [label],
			),
		],
	)

const radio = (
	h: HtmlBuilder<Message>,
	label: string,
	isSelected: boolean,
	next: Customers.ViewFilters,
): Html =>
	h.button(
		[
			h.Type("button"),
			h.Role("radio"),
			h.AriaChecked(isSelected),
			h.OnClick(Message.ChangedPendingFilters({ filters: next })),
			h.Class(
				twMerge(
					"flex h-8 cursor-pointer items-center gap-2 rounded-lg border border-border px-2.5 text-left text-sm outline-hidden hover:bg-wash focus-visible:ring-2 focus-visible:ring-ring/70",
					isSelected && "border-primary bg-primary-subtle/40",
				),
			),
		],
		[
			h.span(
				[
					h.Class(
						twMerge(
							"flex size-3.5 items-center justify-center rounded-full border border-border",
							isSelected && "border-primary",
						),
					),
				],
				isSelected ? [h.span([h.Class("size-1.5 rounded-full bg-primary")])] : [],
			),
			label,
		],
	)

const numberField = (
	h: HtmlBuilder<Message>,
	label: string,
	value: number | undefined,
	onInput: (value: number | undefined) => Customers.ViewFilters,
): Html =>
	h.label(
		[h.Class("flex flex-col gap-1 text-muted-fg text-xs")],
		[
			label,
			input(h, {
				attributes: [
					h.Type("number"),
					h.Attribute("min", "0"),
					h.Value(value === undefined ? "" : String(value)),
					h.OnInput((raw) => {
						const parsed = Number.parseFloat(raw)
						return Message.ChangedPendingFilters({
							filters: onInput(raw.trim() === "" || Number.isNaN(parsed) ? undefined : parsed),
						})
					}),
				],
			}),
		],
	)

const DAY_PRESETS = [7, 14, 30, 60, 90] as const

const editor = (
	h: HtmlBuilder<Message>,
	builder: Builder,
	accounts: ReadonlyArray<AccountRow>,
	members: ReadonlyArray<MemberRow>,
	viewer: Viewer,
): ReadonlyArray<Html> => {
	const { pending } = builder
	const optionId = (value: string) => `customers-filter-${builder.field}-${value}`
	switch (builder.field) {
		case "stage":
			return Customers.LifecycleStage.literals.map((stage) =>
				option(
					h,
					optionId(stage),
					STAGE_LABEL[stage],
					pending.lifecycleStages?.includes(stage) ?? false,
					withFilter(pending, "lifecycleStages", toggleIn(pending.lifecycleStages, stage)),
				),
			)
		case "health":
			return Customers.HealthStatus.literals.map((status) =>
				option(
					h,
					optionId(status),
					h.span(
						[h.Class("inline-flex items-center gap-2")],
						[
							h.span([h.Class(twMerge("size-2 rounded-full", HEALTH_FILL[status]))]),
							HEALTH_LABEL[status],
						],
					),
					pending.healthStatuses?.includes(status) ?? false,
					withFilter(pending, "healthStatuses", toggleIn(pending.healthStatuses, status)),
				),
			)
		case "plan":
			return plansOf(accounts).map((plan) =>
				option(
					h,
					optionId(plan),
					plan,
					pending.planNames?.includes(plan) ?? false,
					withFilter(pending, "planNames", toggleIn(pending.planNames, plan)),
				),
			)
		case "tag": {
			const tags = tagsOf(accounts)
			return tags.length === 0
				? [h.p([h.Class("px-2 text-muted-fg text-sm")], ["No account has a tag yet."])]
				: tags.map((tag) =>
						option(
							h,
							optionId(tag),
							tag,
							pending.tagsAny?.includes(tag) ?? false,
							withFilter(pending, "tagsAny", toggleIn(pending.tagsAny, tag)),
						),
					)
		}
		case "owner":
			return [
				option(
					h,
					optionId("me"),
					"Me",
					pending.ownedByMe === true,
					withFilter(pending, "ownedByMe", pending.ownedByMe ? undefined : true),
				),
				...members
					.filter((member) => member.id !== viewer.userId)
					.map((member) =>
						option(
							h,
							optionId(member.id),
							member.name,
							pending.ownerUserIds?.includes(member.id) ?? false,
							withFilter(pending, "ownerUserIds", toggleIn(pending.ownerUserIds, member.id)),
						),
					),
				option(
					h,
					optionId("unassigned"),
					"Unassigned",
					pending.unowned === true,
					withFilter(pending, "unowned", pending.unowned ? undefined : true),
				),
			]
		case "mrr":
			return [
				option(
					h,
					optionId("paying"),
					"Paying only (MRR above zero)",
					pending.payingOnly === true,
					withFilter(pending, "payingOnly", pending.payingOnly ? undefined : true),
				),
				h.div(
					[h.Class("grid grid-cols-2 gap-2 px-2 pt-2")],
					[
						numberField(
							h,
							"At least ($)",
							pending.minMrrMinor === undefined ? undefined : pending.minMrrMinor / 100,
							(value) =>
								withFilter(
									pending,
									"minMrrMinor",
									value === undefined ? undefined : Math.round(value * 100),
								),
						),
						numberField(
							h,
							"At most ($)",
							pending.maxMrrMinor === undefined ? undefined : pending.maxMrrMinor / 100,
							(value) =>
								withFilter(
									pending,
									"maxMrrMinor",
									value === undefined ? undefined : Math.round(value * 100),
								),
						),
					],
				),
			]
		case "last_active": {
			const isInactive = pending.lastActiveWithinDays === undefined
			const days = pending.inactiveForDays ?? pending.lastActiveWithinDays ?? 14
			const set = (inactive: boolean, value: number | undefined): Customers.ViewFilters =>
				withFilter(
					withFilter(pending, "lastActiveWithinDays", inactive ? undefined : value),
					"inactiveForDays",
					inactive ? value : undefined,
				)
			return [
				h.div(
					[h.Role("radiogroup"), h.AriaLabel("Condition"), h.Class("grid grid-cols-2 gap-2 px-2")],
					[
						radio(h, "within the last", !isInactive, set(false, days)),
						radio(
							h,
							"more than",
							isInactive && pending.inactiveForDays !== undefined,
							set(true, days),
						),
					],
				),
				h.div(
					[h.Class("flex flex-col gap-2 px-2 pt-3")],
					[
						numberField(h, isInactive ? "Days ago" : "Days", days, (value) =>
							set(isInactive, value === undefined ? undefined : Math.max(1, Math.round(value))),
						),
						h.div(
							[h.Class("flex gap-1")],
							DAY_PRESETS.map((preset) =>
								button(
									h,
									{
										intent: preset === days ? "secondary" : "plain",
										size: "xs",
										onPress: Message.ChangedPendingFilters({
											filters: set(isInactive, preset),
										}),
									},
									[`${preset}d`],
								),
							),
						),
					],
				),
			]
		}
		case "signals":
			return [
				h.div(
					[
						h.Role("radiogroup"),
						h.AriaLabel("Open risk signals"),
						h.Class("flex flex-col gap-2 px-2"),
					],
					[
						radio(
							h,
							"Any",
							pending.hasOpenRiskSignals === undefined,
							withFilter(pending, "hasOpenRiskSignals", undefined),
						),
						radio(
							h,
							"Has an open risk signal",
							pending.hasOpenRiskSignals === true,
							withFilter(pending, "hasOpenRiskSignals", true),
						),
						radio(
							h,
							"No open risk signals",
							pending.hasOpenRiskSignals === false,
							withFilter(pending, "hasOpenRiskSignals", false),
						),
					],
				),
			]
	}
}

/** The preview under the editor: how many accounts the pending filters keep, their MRR and health. */
const matchPreview = (
	h: HtmlBuilder<Message>,
	builder: Builder,
	accounts: ReadonlyArray<AccountRow>,
	search: string,
	viewer: Viewer,
): Html => {
	const filters = search.trim() === "" ? builder.pending : { ...builder.pending, search }
	const matches = accounts.filter((account) => countMatching([account], filters, viewer) === 1)
	const mrr = matches.reduce((sum, account) => sum + account.mrrMinor, 0)
	const counts = Customers.HealthStatus.literals.map((status) => ({
		status,
		count: matches.filter((account) => account.healthStatus === status).length,
	}))
	return h.div(
		[h.Class("flex flex-col gap-2 rounded-lg border border-border p-3")],
		[
			h.p(
				[h.Class("text-sm"), h.AriaLive("polite")],
				[
					h.span([h.Class("font-semibold text-fg")], [`${formatCount(matches.length)} customers`]),
					h.span(
						[h.Class("text-muted-fg")],
						[
							` of ${formatCount(accounts.length)} · ${formatMoney(mrr, accounts[0]?.currency ?? "USD")} MRR`,
						],
					),
				],
			),
			distributionBar(h, {
				ariaLabel: "Health of the matching customers",
				segments: counts.map(({ status, count }) => ({
					key: status,
					label: HEALTH_LABEL[status],
					value: count,
					fillClass: HEALTH_FILL[status],
				})),
			}),
			h.p(
				[h.Class("text-muted-fg text-xs")],
				[
					counts
						.map(({ status, count }) => `${count} ${HEALTH_LABEL[status].toLowerCase()}`)
						.join(" · "),
				],
			),
		],
	)
}

export const filterBuilder = (
	h: HtmlBuilder<Message>,
	options: Readonly<{
		builder: Builder
		accounts: ReadonlyArray<AccountRow>
		members: ReadonlyArray<MemberRow>
		search: string
		viewer: Viewer
		closeAttributes: ReadonlyArray<ChildAttribute>
	}>,
): ReadonlyArray<Html> => {
	const { builder } = options
	return [
		h.div(
			[h.Class("flex w-[min(40rem,calc(100vw-2rem))] max-sm:flex-col")],
			[
				h.nav(
					[
						h.AriaLabel("Filter by"),
						h.Class(
							"flex w-56 shrink-0 flex-col gap-2 border-border border-r p-2 max-sm:w-full max-sm:border-r-0 max-sm:border-b",
						),
					],
					FIELD_GROUPS.map(([group, fields]) =>
						h.div(
							[h.Class("flex flex-col")],
							[
								h.span([h.Class("px-2 py-1 text-muted-fg text-xs")], [group]),
								...fields.map((field) =>
									h.button(
										[
											h.Type("button"),
											h.AriaCurrent(field === builder.field ? "true" : "false"),
											h.OnClick(Message.ClickedBuilderField({ field })),
											h.Class(
												twMerge(
													"flex h-8 cursor-pointer items-center justify-between gap-2 rounded-md px-2 text-left text-fg text-sm outline-hidden hover:bg-wash focus-visible:ring-2 focus-visible:ring-ring/70",
													field === builder.field && "bg-secondary",
												),
											),
										],
										[
											FIELD_LABEL[field],
											h.span(
												[
													h.Class(
														"inline-flex items-center gap-1 text-muted-fg text-xs",
													),
												],
												[
													FIELD_KIND[field],
													...(field === builder.field
														? [IconChevronRight(h, { className: "size-3" })]
														: []),
												],
											),
										],
									),
								),
							],
						),
					),
				),
				h.div(
					[h.Class("flex min-w-0 flex-1 flex-col gap-3 p-3")],
					[
						h.div(
							[h.Class("flex flex-col gap-0.5 px-2")],
							[
								h.span(
									[h.Class("font-semibold text-fg text-sm")],
									[FIELD_LABEL[builder.field]],
								),
								h.span(
									[h.Class("text-muted-fg text-xs")],
									[FIELD_DESCRIPTION[builder.field]],
								),
							],
						),
						h.div(
							[h.Class("flex max-h-64 flex-col overflow-y-auto")],
							editor(h, builder, options.accounts, options.members, options.viewer),
						),
						matchPreview(h, builder, options.accounts, options.search, options.viewer),
						h.div(
							[h.Class("flex justify-end gap-2")],
							[
								h.button(
									[
										...options.closeAttributes,
										h.Class(
											"h-8 cursor-pointer rounded-lg px-3 text-fg text-sm hover:bg-wash",
										),
									],
									["Cancel"],
								),
								button(h, { size: "sm", onPress: Message.AppliedFilter() }, ["Apply filter"]),
							],
						),
					],
				),
			],
		),
	]
}

// COLUMNS

export const columnPicker = (
	h: HtmlBuilder<Message>,
	columns: ReadonlyArray<Customers.ListColumn>,
): ReadonlyArray<Html> => {
	const shown = shownColumns(columns)
	const hidden = hiddenColumns(columns)
	const switchFor = (column: Customers.ListColumn, isShown: boolean) =>
		switchControl(
			h,
			{
				id: `customers-column-${column}`,
				isSelected: isShown,
				onChange: (next) => Message.ToggledColumn({ column, isShown: next }),
			},
			[h.span([h.Class("sr-only")], [`Show ${COLUMN_NAME[column]}`])],
		)
	const moveButton = (column: Customers.ListColumn, step: -1 | 1, isDisabled: boolean) =>
		h.button(
			[
				h.Type("button"),
				h.AriaLabel(`Move ${COLUMN_NAME[column]} ${step === -1 ? "up" : "down"}`),
				h.Disabled(isDisabled),
				h.OnClick(Message.MovedColumn({ column, step })),
				h.Class(
					"inline-flex size-6 cursor-pointer items-center justify-center rounded text-muted-fg hover:bg-secondary hover:text-fg disabled:cursor-default disabled:opacity-30",
				),
			],
			[IconChevronDown(h, { className: twMerge("size-3", step === -1 && "rotate-180") })],
		)
	return [
		h.div(
			[h.Class("flex w-72 flex-col gap-1 p-2")],
			[
				h.div(
					[h.Class("flex items-center justify-between px-2 py-1")],
					[
						h.span(
							[h.Class("text-sm")],
							[
								h.span([h.Class("font-semibold text-fg")], ["Columns "]),
								h.span(
									[h.Class("text-muted-fg")],
									[`${shown.length} of ${Customers.ListColumn.literals.length} shown`],
								),
							],
						),
						button(h, { intent: "plain", size: "xs", onPress: Message.ResetColumns() }, [
							"Reset",
						]),
					],
				),
				h.span([h.Class("px-2 pt-1 text-muted-fg text-xs")], ["Shown"]),
				h.ul(
					[h.Class("flex flex-col")],
					shown.map((column, index) =>
						h.li(
							[
								h.Class(
									"flex h-8 items-center gap-1 rounded-md px-2 text-fg text-sm hover:bg-wash",
								),
							],
							column === "name"
								? [
										h.span([h.Class("flex-1")], [COLUMN_NAME[column]]),
										h.span([h.Class("text-muted-fg text-xs")], ["Always shown"]),
									]
								: [
										h.span([h.Class("flex-1")], [COLUMN_NAME[column]]),
										moveButton(column, -1, index <= 1),
										moveButton(column, 1, index === shown.length - 1),
										switchFor(column, true),
									],
						),
					),
				),
				...(hidden.length === 0
					? []
					: [
							h.span([h.Class("px-2 pt-2 text-muted-fg text-xs")], ["Hidden"]),
							h.ul(
								[h.Class("flex flex-col")],
								hidden.map((column) =>
									h.li(
										[
											h.Class(
												"flex h-8 items-center gap-1 rounded-md px-2 text-fg text-sm hover:bg-wash",
											),
										],
										[
											h.span([h.Class("flex-1")], [COLUMN_NAME[column]]),
											switchFor(column, false),
										],
									),
								),
							),
						]),
				h.p(
					[h.Class("border-border border-t px-2 pt-2 text-muted-fg text-xs")],
					["Changes apply to this view. Use Save view to keep them."],
				),
			],
		),
	]
}
