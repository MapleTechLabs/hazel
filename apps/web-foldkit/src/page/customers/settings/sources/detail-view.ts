import type { CustomerProvider } from "@hazel/domain/customers"
import type { OrganizationId } from "@hazel/schema"
import type { Html } from "foldkit/html"
import { formatCount, formatDate, formatDateTime, formatRelative } from "../../../../customers/format"
import { providerOf, webhookUrlOf } from "../../../../customers/providers"
import { dataTable } from "../../../../customers/ui/data-table"
import { segmented } from "../../../../customers/ui/filter-bar"
import { sourceMark } from "../../../../customers/ui/identity"
import { IconArrowPath, IconChevronRight, IconExternalLink } from "../../../../icons"
import { AppRoute, hrefOf } from "../../../../route"
import { button, buttonClassName } from "../../../../ui/button"
import { readOnlyNotice, settingsHeader, settingsPage } from "../shared"
import { Message } from "./message"
import { connectionOf, type HistoryFilter, isLive, type Model, runsOf, statusOf, visibleRuns } from "./model"
import { addsList, type Context, connectButton, errorBanner, syncModeLines } from "./overview-view"
import {
	BACKEND_URL,
	card,
	cardHeader,
	chips,
	codeChips,
	eyebrow,
	formatClock,
	formatDuration,
	type H,
	statParts,
	statusBadge,
	syncErrorMessage,
	TRIGGER_LABEL,
	webhookUrlField,
} from "./parts"
import type { ConnectionRow, SyncRunRow } from "./queries"
import { settingsCard } from "./settings-view"

/** One source (Wonder `loy`, `one`): its runs, connection, mapping, settings and the way out. */

export interface DetailContext extends Context {
	readonly organizationId: OrganizationId | null
}

const toHistoryFilter = (filter: HistoryFilter) => Message.ClickedHistoryFilter({ filter })

// HISTORY

const runStatus = (h: H, run: SyncRunRow): Html => {
	const [dot, label, text] =
		run.status === "running"
			? ["bg-primary", "Running", "text-fg"]
			: run.status === "failed"
				? ["bg-danger-subtle-fg", "Failed", "text-danger"]
				: ["bg-success-subtle-fg", "Succeeded", "text-fg"]
	return h.span(
		[h.Class(`inline-flex items-center gap-1.5 text-sm ${text}`)],
		[h.span([h.AriaHidden(true), h.Class(`size-1.5 rounded-full ${dot}`)]), label],
	)
}

const runRecords = (h: H, run: SyncRunRow, name: string): Html => {
	const written = statParts(run.stats)
	const note =
		run.error !== null
			? syncErrorMessage(run.error, name).title
			: run.status === "running" && run.progress !== null
				? `${run.progress.step} ${formatCount(run.progress.done)}${run.progress.total === null ? "" : ` of ${formatCount(run.progress.total)}`}`
				: null
	return h.div(
		[h.Class("flex min-w-0 flex-col")],
		[
			h.span(
				[h.Class(written.length === 0 ? "text-muted-fg text-sm" : "text-fg text-sm")],
				[written.length === 0 ? "Nothing written" : written.join(" · ")],
			),
			...(note === null
				? []
				: [
						h.span(
							[h.Class(run.error === null ? "text-muted-fg text-xs" : "text-danger text-xs")],
							[note],
						),
					]),
		],
	)
}

const historyCard = (h: H, model: Model, connection: ConnectionRow): Html => {
	const name = providerOf(connection.provider).name
	const all = runsOf(model, connection.id)
	const failed = all.filter((run) => run.status === "failed").length
	const rows = visibleRuns(model, connection.id)
	return card(h, [
		cardHeader(
			h,
			"Sync history",
			"Scheduled, manual and backfill runs of the last 7 days.",
			segmented(h, {
				ariaLabel: "Show runs",
				segments: [
					{ key: "all", label: "All" },
					{ key: "failed", label: failed === 0 ? "Failed" : `Failed ${formatCount(failed)}` },
				],
				selected: model.historyFilter,
				onSelect: toHistoryFilter,
			}),
		),
		rows.length === 0
			? h.p(
					[h.Class("py-6 text-center text-muted-fg text-sm")],
					[
						model.historyFilter === "failed"
							? "No failed runs in the last 7 days."
							: "No runs in the last 7 days.",
					],
				)
			: dataTable(h, {
					ariaLabel: "Sync history",
					id: "customers-sync-history",
					rows,
					rowKey: (run) => run.id,
					columns: [
						{
							key: "trigger",
							label: "Trigger",
							widthClass: "w-28",
							cell: (run) =>
								h.span(
									[
										h.Class(
											"rounded-md bg-secondary px-1.5 py-0.5 font-medium text-fg text-xs",
										),
									],
									[TRIGGER_LABEL[run.trigger]],
								),
						},
						{
							key: "status",
							label: "Status",
							widthClass: "w-32",
							cell: (run) => runStatus(h, run),
						},
						{
							key: "started",
							label: "Started",
							widthClass: "w-36",
							hideClass: "max-sm:hidden",
							cell: (run) => formatDateTime(new Date(run.startedAtMs)),
						},
						{
							key: "duration",
							label: "Duration",
							align: "right",
							widthClass: "w-24",
							cell: (run) =>
								run.finishedAtMs === null
									? "—"
									: formatDuration(run.finishedAtMs - run.startedAtMs),
						},
						{
							key: "records",
							label: "Records upserted · note",
							cell: (run) => runRecords(h, run, name),
						},
					],
				}),
		h.p(
			[h.Class("text-muted-fg text-xs")],
			[`${formatCount(all.length)} ${all.length === 1 ? "run" : "runs"} in the last 7 days`],
		),
	])
}

// CONNECTION

const row = (h: H, label: string, value: Html | string): Html =>
	h.div(
		[h.Class("flex items-baseline justify-between gap-3 text-sm")],
		[
			h.dt([h.Class("shrink-0 text-muted-fg")], [label]),
			h.dd([h.Class("min-w-0 truncate text-right text-fg")], [value]),
		],
	)

const connectionCard = (h: H, model: Model, connection: ConnectionRow, context: DetailContext): Html => {
	const descriptor = providerOf(connection.provider)
	const connectedBy =
		model.members.find((member) => member.id === connection.connectedBy)?.name ?? "A former member"
	const now = new Date(context.nowMs)
	return card(h, [
		cardHeader(h, "Connection"),
		h.dl(
			[h.Class("flex flex-col gap-2")],
			[
				row(h, "Account", connection.externalAccountName ?? "—"),
				row(
					h,
					"Connected by",
					`${connectedBy} · ${formatDate(new Date(connection.connectedAtMs), { now })}`,
				),
				row(h, "Schedule", descriptor.syncMode),
				row(
					h,
					"Next sync",
					connection.nextSyncAtMs === null
						? "Not scheduled"
						: `${formatClock(connection.nextSyncAtMs)} (${formatRelative(new Date(connection.nextSyncAtMs), now)})`,
				),
			],
		),
		...(descriptor.webhook === null || context.organizationId === null
			? []
			: [
					h.div(
						[h.Class("flex flex-col gap-1.5")],
						[
							eyebrow(h, "Webhook URL"),
							webhookUrlField(
								h,
								webhookUrlOf(
									BACKEND_URL,
									connection.provider,
									context.organizationId,
									connection.id,
								),
							),
							...syncModeLines(h, connection).slice(1),
						],
					),
				]),
		...(context.isAdmin
			? [
					button(
						h,
						{
							intent: "outline",
							size: "sm",
							className: "self-start",
							onPress: Message.PressedUpdateKeys({ connectionId: connection.id }),
						},
						["Update keys"],
					),
				]
			: []),
	])
}

const dangerZone = (h: H, provider: CustomerProvider): Html => {
	const name = providerOf(provider).name
	return card(
		h,
		[
			h.div(
				[h.Class("flex flex-col gap-1")],
				[
					h.span(
						[h.Class("font-medium text-danger text-xs uppercase tracking-wide")],
						["Danger zone"],
					),
					h.h2([h.Class("font-semibold text-base/6 text-fg")], [`Disconnect ${name}`]),
					h.p(
						[h.Class("text-muted-fg text-sm")],
						[
							`Stops syncs and drops the stored keys. Accounts and contacts stay but stop updating and are marked stale; signals that need ${name} go quiet.`,
						],
					),
				],
			),
			button(
				h,
				{
					intent: "outline",
					size: "sm",
					className: "self-start text-danger",
					onPress: Message.PressedDisconnect(),
				},
				[`Disconnect ${name}…`],
			),
		],
		"border-danger/30",
	)
}

// MAPPING

const mappingCard = (h: H, provider: CustomerProvider): Html => {
	const descriptor = providerOf(provider)
	return card(h, [
		cardHeader(h, "Field mapping", `How ${descriptor.name} records become Hazel fields.`),
		h.table(
			[h.Class("w-full text-sm")],
			[
				h.thead(
					[],
					[
						h.tr(
							[h.Class("text-left text-muted-fg text-xs")],
							[
								h.th([h.Class("pb-2 font-medium")], [`${descriptor.name} field`]),
								h.th([h.Class("w-6 pb-2")], []),
								h.th([h.Class("pb-2 font-medium")], ["Hazel field"]),
							],
						),
					],
				),
				...descriptor.mapping.map((group) =>
					h.tbody(
						[],
						[
							h.tr(
								[],
								[
									h.th(
										[
											h.Attribute("colspan", "3"),
											h.Attribute("scope", "rowgroup"),
											h.Class(
												"border-border border-t py-2 text-left font-medium text-muted-fg text-xs uppercase tracking-wide",
											),
										],
										[group.group],
									),
								],
							),
							...group.fields.map((field) =>
								h.tr(
									[h.Class("border-border border-t")],
									[
										h.td([h.Class("py-1.5 font-mono text-fg text-xs")], [field.from]),
										h.td(
											[h.Class("py-1.5 text-muted-fg")],
											[IconChevronRight(h, { className: "size-3.5" })],
										),
										h.td([h.Class("py-1.5 font-mono text-fg text-xs")], [field.to]),
									],
								),
							),
						],
					),
				),
			],
		),
	])
}

// NOT CONNECTED

const notConnectedCard = (
	h: H,
	provider: CustomerProvider,
	connection: ConnectionRow | undefined,
	context: Context,
): Html => {
	const descriptor = providerOf(provider)
	return card(h, [
		cardHeader(
			h,
			connection === undefined ? "Not connected" : "Disconnected",
			connection?.disconnectedAtMs == null
				? descriptor.blurb
				: `Disconnected ${formatDate(new Date(connection.disconnectedAtMs), { now: new Date(context.nowMs) })}. Its data is kept, marked stale, until you reconnect.`,
		),
		h.div(
			[h.Class("grid gap-5 sm:grid-cols-2")],
			[
				h.div(
					[h.Class("flex flex-col gap-2")],
					[eyebrow(h, "Adds to the model"), addsList(h, provider)],
				),
				h.div(
					[h.Class("flex flex-col gap-3")],
					[
						h.div(
							[h.Class("flex flex-col gap-1.5")],
							[eyebrow(h, "Provides"), chips(h, descriptor.provides)],
						),
						h.div(
							[h.Class("flex flex-col gap-1")],
							[
								eyebrow(h, "Sync mode"),
								h.p([h.Class("text-fg text-sm")], [descriptor.syncMode]),
							],
						),
						...(descriptor.permissions.length === 0
							? []
							: [
									h.div(
										[h.Class("flex flex-col gap-1.5")],
										[
											eyebrow(h, "Key permissions"),
											codeChips(
												h,
												descriptor.permissions.map(
													(permission) =>
														`${permission.resource}: ${permission.access}`,
												),
											),
										],
									),
								]),
					],
				),
			],
		),
		h.div(
			[h.Class("flex flex-wrap items-center gap-3 border-border border-t pt-4")],
			[
				...(context.isAdmin ? [connectButton(h, provider, connection)] : []),
				h.a(
					[
						h.Href(descriptor.docsHref),
						h.Target("_blank"),
						h.Rel("noreferrer"),
						h.Class("text-primary text-sm hover:underline"),
					],
					[`${descriptor.name} docs`],
				),
			],
		),
	])
}

// PAGE

const subtitleOf = (connection: ConnectionRow, context: Context): string => {
	const now = new Date(context.nowMs)
	return [
		...statParts(connection.stats).slice(0, 2),
		connection.lastSyncAtMs === null
			? "not synced yet"
			: `last sync ${formatRelative(new Date(connection.lastSyncAtMs), now)}`,
		...(connection.nextSyncAtMs === null || connection.status === "disconnected"
			? []
			: [`next at ${formatClock(connection.nextSyncAtMs)}`]),
	].join(" · ")
}

export const detailView = (h: H, model: Model, provider: CustomerProvider, context: DetailContext): Html => {
	const descriptor = providerOf(provider)
	const connection = connectionOf(model, provider)
	const live = connection !== undefined && isLive(connection) ? connection : undefined
	return settingsPage(h, [
		settingsHeader(h, {
			crumbs: [
				{
					label: "Data sources",
					href: hrefOf(AppRoute.CustomersSettingsSources({ orgSlug: context.orgSlug })),
				},
				{ label: descriptor.name },
			],
			leading: sourceMark(h, provider, { size: "md" }),
			title: descriptor.name,
			badges: connection === undefined ? [] : [statusBadge(h, statusOf(model, connection))],
			subtitle: live === undefined ? descriptor.blurb : subtitleOf(live, context),
			actions: [
				h.a(
					[
						h.Href(descriptor.dashboardHref),
						h.Target("_blank"),
						h.Rel("noreferrer"),
						h.Class(buttonClassName({ intent: "outline", size: "sm" })),
					],
					[IconExternalLink(h, { attributes: { "data-slot": "icon" } }), `Open ${descriptor.name}`],
				),
				...(context.isAdmin && live !== undefined && statusOf(model, live) !== "syncing"
					? [
							button(
								h,
								{
									intent: "outline",
									size: "sm",
									isPending: model.syncing.includes(live.id),
									onPress: Message.PressedSyncNow({ connectionId: live.id }),
								},
								[IconArrowPath(h, { attributes: { "data-slot": "icon" } }), "Sync now"],
							),
						]
					: []),
			],
		}),
		...(context.isAdmin ? [] : [readOnlyNotice(h, "data sources")]),
		...(model.connections === null
			? [h.p([h.Class("text-muted-fg text-sm")], ["Loading…"])]
			: live === undefined
				? [notConnectedCard(h, provider, connection, context), mappingCard(h, provider)]
				: [
						h.div(
							[h.Class("grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]")],
							[
								h.div(
									[h.Class("flex min-w-0 flex-col gap-5")],
									[
										...(live.status === "error"
											? [errorBanner(h, live, context, false)]
											: []),
										historyCard(h, model, live),
										settingsCard(h, model, live, context.isAdmin),
										mappingCard(h, provider),
									],
								),
								h.div(
									[h.Class("flex min-w-0 flex-col gap-5")],
									[
										connectionCard(h, model, live, context),
										...(context.isAdmin ? [dangerZone(h, provider)] : []),
									],
								),
							],
						),
					]),
	])
}
