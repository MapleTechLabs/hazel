import type { Account } from "@hazel/domain/customers"
import { Effect, Schema } from "effect"
import type { Html, HtmlBuilder } from "foldkit/html"
import { defineMessageUnion } from "foldkit/message"
import { toEpochMs } from "~/lib/utils"
import { IconDots } from "../../../../icons"
import { sparkline } from "../../../../customers/charts/sparkline"
import { formatCount, formatMoney, formatRelative } from "../../../../customers/format"
import { healthBadge, stageBadge } from "../../../../customers/ui/badges"
import { type Column, dataTable, primaryCell } from "../../../../customers/ui/data-table"
import { noResultsState } from "../../../../customers/ui/empty-states"
import { companyLogo, personLabel } from "../../../../customers/ui/identity"
import { queueAction } from "../../../../customers/ui/queue-row"
import { defineLabWithFlags, queryParam } from "../../../define"
import { labPage, labSection } from "../../../frame"
import { ACCOUNTS, ACCOUNTS_BY_KEY, NOW, memberOf } from "../../../fixtures/customers"

// `/lab/customers/kit/table`: Foundations › Table Customers States. Sort by MRR / active users /
// last active, select rows, hover a row for its actions; `?state=default|loading|empty`.

const STATES = ["default", "loading", "empty"] as const
const State = Schema.Literals(STATES)
const SortKey = Schema.Literals(["mrr", "active", "last_active"])
type SortKey = typeof SortKey.Type

const Model = Schema.Struct({
	state: State,
	sort: Schema.Struct({ key: SortKey, direction: Schema.Literals(["asc", "desc"]) }),
	selected: Schema.Array(Schema.String),
	focused: Schema.NullOr(Schema.String),
})
type Model = typeof Model.Type

const Message = defineMessageUnion({
	PressedSort: { key: SortKey },
	ToggledRow: { key: Schema.String, isSelected: Schema.Boolean },
	ToggledAll: { isSelected: Schema.Boolean },
	PressedRow: { key: Schema.String },
	Ignored: {},
})
type Message = typeof Message.Type

const ROWS = ACCOUNTS.slice(0, 24)

/** A plausible 30-day active-users series for the sparkline column. */
const activitySeries = (account: Account): ReadonlyArray<number> => {
	const trend = (account.activeUsersTrendPct ?? 0) / 100
	return Array.from({ length: 12 }, (_, index) =>
		Math.max(
			0,
			account.activeUsers30d * (1 - trend * (1 - index / 11)) +
				((index * 7 + account.name.length) % 3) -
				1,
		),
	)
}

const sortValue = (account: Account, key: SortKey): number =>
	key === "mrr"
		? account.mrrMinor
		: key === "active"
			? account.activeUsers30d
			: account.lastActiveAt === null
				? 0
				: toEpochMs(account.lastActiveAt)

const update = (model: Model, message: Message): { model: Model } => ({
	model: Message.match(message, {
		PressedSort: ({ key }) => ({
			...model,
			sort: {
				key,
				direction:
					model.sort.key === key && model.sort.direction === "desc"
						? ("asc" as const)
						: ("desc" as const),
			},
		}),
		ToggledRow: ({ key, isSelected }) => ({
			...model,
			selected: isSelected ? [...model.selected, key] : model.selected.filter((entry) => entry !== key),
		}),
		ToggledAll: ({ isSelected }) => ({ ...model, selected: isSelected ? ROWS.map((row) => row.id) : [] }),
		PressedRow: ({ key }) => ({ ...model, focused: key }),
		Ignored: () => model,
	}),
})

const view = (model: Model, h: HtmlBuilder<Message>): Html => {
	const tableColumns: ReadonlyArray<Column<Account, SortKey | "name" | "owner" | "stage" | "health">> = [
		{
			key: "name",
			label: "Customer",
			cell: (account) =>
				primaryCell(h, {
					leading: companyLogo(h, { name: account.name, logoUrl: account.logoUrl }),
					title: account.name,
					subtitle: account.domains[0] ?? null,
				}),
			footer: `${formatCount(ROWS.length)} customers`,
		},
		{
			key: "owner",
			label: "Owner",
			widthClass: "w-44",
			hideClass: "max-lg:hidden",
			cell: (account) => personLabel(h, memberOf(account.ownerUserId)),
		},
		{
			key: "stage",
			label: "Stage",
			widthClass: "w-28",
			cell: (account) => stageBadge(h, account.lifecycleStage),
		},
		{
			key: "mrr",
			label: "MRR",
			align: "right",
			sortable: true,
			widthClass: "w-28",
			cell: (account) =>
				h.span(
					[h.Class(account.mrrMinor === 0 ? "text-muted-fg" : "")],
					[formatMoney(account.mrrMinor, account.currency)],
				),
			footer: formatMoney(ROWS.reduce((sum, account) => sum + account.mrrMinor, 0)),
		},
		{
			key: "active",
			label: "Active users 30d",
			align: "right",
			sortable: true,
			widthClass: "w-44",
			cell: (account) =>
				h.span(
					[h.Class("inline-flex items-center justify-end gap-3")],
					[
						sparkline(h, {
							values: activitySeries(account),
							ariaLabel: `${account.name} active users, 30 days`,
						}),
						h.span([h.Class("w-8")], [formatCount(account.activeUsers30d)]),
					],
				),
		},
		{
			key: "health",
			label: "Health",
			widthClass: "w-32",
			cell: (account) => healthBadge(h, { status: account.healthStatus, score: account.healthScore }),
		},
		{
			key: "last_active",
			label: "Last active",
			align: "right",
			sortable: true,
			widthClass: "w-32",
			cell: (account) =>
				h.span(
					[h.Class("text-muted-fg")],
					[account.lastActiveAt === null ? "Never" : formatRelative(account.lastActiveAt, NOW)],
				),
		},
	]
	const rows = [...ROWS].sort((a, b) => {
		const delta = sortValue(a, model.sort.key) - sortValue(b, model.sort.key)
		return model.sort.direction === "asc" ? delta : -delta
	})
	const table =
		model.state === "empty"
			? noResultsState(h, { onClear: Message.Ignored() })
			: dataTable(h, {
					ariaLabel: "Customers",
					id: "lab-customers",
					columns: tableColumns,
					rows,
					rowKey: (account) => account.id,
					sort: model.sort,
					onSort: (key) =>
						key === "mrr" || key === "active" || key === "last_active"
							? Message.PressedSort({ key })
							: Message.Ignored(),
					selection: {
						selected: new Set(model.selected),
						onToggle: (key, isSelected) => Message.ToggledRow({ key, isSelected }),
						onToggleAll: (isSelected) => Message.ToggledAll({ isSelected }),
					},
					onRowPress: (account) => Message.PressedRow({ key: account.id }),
					focusedKey: model.focused,
					rowActions: () =>
						queueAction(h, {
							label: "Row actions",
							icon: IconDots(h),
							iconOnly: true,
							onPress: Message.Ignored(),
						}),
					stickyHeader: true,
					loadingRows: model.state === "loading" ? 6 : undefined,
				})
	return labPage(
		h,
		{ title: "Customers table", switches: [{ name: "state", values: STATES, current: model.state }] },
		[
			labSection(
				h,
				`Header (sorted) · hover · selected (${model.selected.length}) · focused (click a row)`,
				[h.div([h.Class("max-h-[36rem] overflow-y-auto")], [table])],
			),
		],
	)
}

export const lab = defineLabWithFlags("Customers table", {
	Model,
	Flags: Schema.Struct({ state: State }),
	flags: Effect.all({ state: queryParam("state", STATES, "default") }),
	init: (flags) => ({
		model: {
			state: flags.state,
			sort: { key: "mrr" as const, direction: "desc" as const },
			selected: [ACCOUNTS_BY_KEY.kestrel.id],
			focused: null,
		},
	}),
	update,
	view,
})
