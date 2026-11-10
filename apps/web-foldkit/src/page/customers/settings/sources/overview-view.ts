import type { CustomerProvider } from "@hazel/domain/customers"
import * as AsyncData from "foldkit/asyncData"
import type { Html } from "foldkit/html"
import { formatCount, formatDate, formatRelative } from "../../../../customers/format"
import { PROVIDER_ORDER, providerOf } from "../../../../customers/providers"
import { sourceMark } from "../../../../customers/ui/identity"
import { IconArrowPath, IconCheck, IconChevronRight, IconGear, IconPlus } from "../../../../icons"
import { AppRoute, hrefOf } from "../../../../route"
import { button, buttonClassName } from "../../../../ui/button"
import { progressBar, progressBarTrack } from "../../../../ui/progress-bar"
import { readOnlyNotice, settingsHeader, settingsPage } from "../shared"
import { Message } from "./message"
import { connectionOf, isLive, type Model, runningRunOf, statusOf } from "./model"
import {
	callout,
	card,
	chips,
	comingSoonBadge,
	eyebrow,
	formatClock,
	type H,
	statParts,
	statusBadge,
	syncErrorMessage,
	TRIGGER_LABEL,
} from "./parts"
import type { ConnectionRow, SyncRunRow } from "./queries"

/** The Data sources overview (Wonder `lac`): identity coverage, connected sources, the rest. */

export interface Context {
	readonly orgSlug: string
	readonly nowMs: number
	readonly isAdmin: boolean
}

export const detailHref = (context: Context, provider: CustomerProvider): string =>
	hrefOf(AppRoute.CustomersSourceDetail({ orgSlug: context.orgSlug, provider }))

const linkButton = (h: H, href: string, children: ReadonlyArray<Html | string>, primary = false): Html =>
	h.a(
		[
			h.Href(href),
			h.Class(buttonClassName({ intent: primary ? "primary" : "outline", size: "sm" }, "no-underline")),
		],
		[...children],
	)

// COVERAGE

const unmatchedPanel = (h: H, model: Model, context: Context): Html =>
	AsyncData.matchData(model.unmatched, {
		onEmpty: () => h.p([h.Class("text-muted-fg text-sm")], ["Counting unmatched records…"]),
		onFailure: () => h.p([h.Class("text-muted-fg text-sm")], ["Couldn't count unmatched records."]),
		onData: (count) => unmatchedCount(h, count, context),
	})

const unmatchedCount = (h: H, count: number, context: Context): Html =>
	h.div(
		[h.Class("flex flex-col items-start gap-2")],
		count === 0
			? [
					h.p([h.Class("font-medium text-fg text-sm")], ["No unmatched records"]),
					h.p([h.Class("text-muted-fg text-sm")], ["Every synced record found its account."]),
				]
			: [
					h.p(
						[h.Class("flex items-center gap-1.5 font-medium text-fg text-sm")],
						[
							h.span([h.AriaHidden(true), h.Class("size-1.5 rounded-full bg-warning")]),
							`${formatCount(count)} unmatched ${count === 1 ? "record" : "records"}`,
						],
					),
					h.p(
						[h.Class("text-muted-fg text-sm")],
						["Synced records no account claimed yet. Link them, create accounts or ignore them."],
					),
					linkButton(
						h,
						hrefOf(AppRoute.CustomersUnmatched({ orgSlug: context.orgSlug })),
						["Resolve records", IconChevronRight(h, { attributes: { "data-slot": "icon" } })],
						true,
					),
				],
	)

const coverageCard = (h: H, model: Model, context: Context, live: ReadonlyArray<ConnectionRow>): Html =>
	card(
		h,
		[
			h.div(
				[h.Class("flex flex-col gap-1")],
				[
					eyebrow(h, "Identity coverage"),
					h.p(
						[h.Class("flex items-baseline gap-1.5")],
						[
							h.span(
								[h.Class("font-semibold text-3xl text-fg tabular-nums")],
								[model.accountCount === null ? "—" : formatCount(model.accountCount)],
							),
							h.span([h.Class("text-muted-fg text-sm")], ["accounts"]),
						],
					),
					h.p(
						[h.Class("text-muted-fg text-sm")],
						["One customer model, whichever sources each account came from."],
					),
				],
			),
			h.div(
				[h.Class("flex min-w-0 flex-col gap-2 lg:border-border lg:border-x lg:px-5")],
				[
					eyebrow(h, "Records per source"),
					live.length === 0
						? h.p([h.Class("text-muted-fg text-sm")], ["Nothing synced yet."])
						: h.ul(
								[h.Class("flex flex-col gap-1.5")],
								live.map((connection) =>
									h.li(
										[h.Class("flex items-center gap-2 text-sm")],
										[
											sourceMark(h, connection.provider, {
												size: "sm",
												className: "size-6",
											}),
											h.span(
												[h.Class("font-medium text-fg")],
												[providerOf(connection.provider).name],
											),
											h.span(
												[h.Class("truncate text-muted-fg tabular-nums")],
												[
													statParts(connection.stats).slice(0, 2).join(" · ") ||
														"No records yet",
												],
											),
										],
									),
								),
							),
					h.p(
						[h.Class("text-muted-fg text-xs")],
						["Match order: existing link → shared ID → email domain → new account"],
					),
				],
			),
			...(context.isAdmin ? [unmatchedPanel(h, model, context)] : []),
		],
		"grid gap-5 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.4fr)_minmax(0,1fr)]",
	)

// CONNECTED

const progressLine = (h: H, run: SyncRunRow, context: Context): Html => {
	const progress = run.progress
	const pct =
		progress === null || progress.total === null || progress.total === 0
			? null
			: Math.min(100, (progress.done / progress.total) * 100)
	const counts =
		progress === null
			? "Starting…"
			: progress.total === null
				? `${progress.step} ${formatCount(progress.done)}`
				: `${progress.step} ${formatCount(progress.done)} of ${formatCount(progress.total)}`
	return h.div(
		[h.Class("flex flex-col gap-2")],
		[
			h.div(
				[h.Class("flex items-center justify-between gap-3 text-sm")],
				[
					h.span(
						[h.Class("min-w-0 truncate")],
						[
							h.span(
								[h.Class("font-medium text-fg")],
								[`${TRIGGER_LABEL[run.trigger]} · ${counts}`],
							),
							h.span(
								[h.Class("text-muted-fg")],
								[
									` · started ${formatRelative(new Date(run.startedAtMs), new Date(context.nowMs))}`,
								],
							),
						],
					),
					...(pct === null
						? []
						: [h.span([h.Class("text-muted-fg tabular-nums")], [`${Math.round(pct)}%`])]),
				],
			),
			progressBar(
				h,
				{
					ariaLabel: `Syncing ${progress?.step ?? ""}`,
					...(pct === null ? { isIndeterminate: true } : { value: pct }),
				},
				[progressBarTrack(h, pct === null ? { isIndeterminate: true } : { value: pct })],
			),
		],
	)
}

/** The failing source's banner: what broke, in our words, and the way out. */
export const errorBanner = (
	h: H,
	connection: ConnectionRow,
	context: Context,
	showRunLink: boolean,
): Html => {
	const descriptor = providerOf(connection.provider)
	const error = connection.lastError
	const message =
		error === null
			? { title: "Sync failing", description: "The last syncs failed. Syncs retry with backoff." }
			: syncErrorMessage(error, descriptor.name)
	const lastGood =
		connection.lastSuccessAtMs === null
			? "No sync has succeeded yet."
			: `Last successful sync ${formatDate(new Date(connection.lastSuccessAtMs), { now: new Date(context.nowMs) })}, ${formatClock(connection.lastSuccessAtMs)} (${formatRelative(new Date(connection.lastSuccessAtMs), new Date(context.nowMs))}).`
	return callout(h, {
		message: { title: message.title, description: `${message.description} ${lastGood}` },
		actions: [
			...(showRunLink
				? [
						h.a(
							[
								h.Href(detailHref(context, connection.provider)),
								h.Class(
									buttonClassName({ intent: "plain", size: "sm" }, "text-danger-subtle-fg"),
								),
							],
							["View failed run"],
						),
					]
				: []),
			...(context.isAdmin && error?.code === "auth"
				? [
						button(
							h,
							{
								intent: "primary",
								size: "sm",
								onPress: Message.PressedReconnect({ connectionId: connection.id }),
							},
							["Reconnect"],
						),
					]
				: []),
		],
	})
}

const column = (h: H, label: string, children: ReadonlyArray<Html>): Html =>
	h.div([h.Class("flex min-w-0 flex-col gap-1 px-4 py-3")], [eyebrow(h, label), ...children])

const value = (h: H, text: string, className = "text-fg"): Html =>
	h.p([h.Class(`truncate font-medium text-sm ${className}`)], [text])
const detail = (h: H, text: string): Html => h.p([h.Class("truncate text-muted-fg text-xs")], [text])

const lastSyncColumn = (h: H, model: Model, connection: ConnectionRow, context: Context): Html => {
	const now = new Date(context.nowMs)
	const running = runningRunOf(model, connection.id)
	if (running !== undefined)
		return column(h, "Last sync", [
			value(h, "Running now"),
			detail(
				h,
				`${TRIGGER_LABEL[running.trigger]} · started ${formatRelative(new Date(running.startedAtMs), now)}`,
			),
		])
	if (connection.status === "error")
		return column(h, "Last success", [
			value(
				h,
				connection.lastSuccessAtMs === null
					? "Never"
					: formatRelative(new Date(connection.lastSuccessAtMs), now),
				"text-danger",
			),
			detail(
				h,
				`${formatCount(connection.consecutiveFailures)} failed ${connection.consecutiveFailures === 1 ? "attempt" : "attempts"} since`,
			),
		])
	return column(h, "Last sync", [
		value(
			h,
			connection.lastSyncAtMs === null
				? "Not synced yet"
				: formatRelative(new Date(connection.lastSyncAtMs), now),
		),
		detail(
			h,
			connection.nextSyncAtMs === null
				? "No sync scheduled"
				: `Next at ${formatClock(connection.nextSyncAtMs)}`,
		),
	])
}

/** The sync mode, and whether the webhook can be verified (its signing secret is stored). */
export const syncModeLines = (h: H, connection: ConnectionRow): ReadonlyArray<Html> => {
	const descriptor = providerOf(connection.provider)
	return [
		value(h, descriptor.syncMode),
		descriptor.webhook === null
			? detail(h, "No webhooks")
			: h.p(
					[h.Class("flex items-center gap-1.5 text-muted-fg text-xs")],
					[
						h.span([
							h.AriaHidden(true),
							h.Class(
								`size-1.5 shrink-0 rounded-full ${connection.hasWebhookSecret ? "bg-success-subtle-fg" : "bg-warning"}`,
							),
						]),
						connection.hasWebhookSecret ? "Signing secret set" : "Signing secret missing",
					],
				),
	]
}

const connectedCard = (h: H, model: Model, connection: ConnectionRow, context: Context): Html => {
	const descriptor = providerOf(connection.provider)
	const status = statusOf(model, connection)
	const running = runningRunOf(model, connection.id)
	const records = statParts(connection.stats)
	return h.article(
		[h.AriaLabel(descriptor.name), h.Class("flex flex-col rounded-xl border border-border bg-bg")],
		[
			h.div(
				[h.Class("flex flex-col gap-3 p-4 sm:p-5")],
				[
					h.div(
						[h.Class("flex flex-wrap items-start gap-3")],
						[
							sourceMark(h, connection.provider, { size: "md" }),
							h.div(
								[h.Class("flex min-w-0 flex-1 flex-col gap-0.5")],
								[
									h.div(
										[h.Class("flex flex-wrap items-center gap-2")],
										[
											h.h3(
												[h.Class("font-medium text-base/6 text-fg")],
												[
													h.a(
														[
															h.Href(detailHref(context, connection.provider)),
															h.Class("hover:underline"),
														],
														[descriptor.name],
													),
												],
											),
											statusBadge(h, status),
										],
									),
									h.p([h.Class("text-muted-fg text-sm")], [descriptor.blurb]),
								],
							),
							h.div(
								[h.Class("flex items-center gap-2")],
								[
									...(context.isAdmin && status !== "syncing"
										? [
												button(
													h,
													{
														intent: "outline",
														size: "sm",
														isPending: model.syncing.includes(connection.id),
														onPress: Message.PressedSyncNow({
															connectionId: connection.id,
														}),
													},
													[
														IconArrowPath(h, {
															attributes: { "data-slot": "icon" },
														}),
														"Sync now",
													],
												),
											]
										: []),
									linkButton(h, detailHref(context, connection.provider), [
										IconGear(h, { attributes: { "data-slot": "icon" } }),
										context.isAdmin ? "Settings" : "Details",
									]),
								],
							),
						],
					),
					...(running === undefined ? [] : [progressLine(h, running, context)]),
					...(status === "failing" ? [errorBanner(h, connection, context, true)] : []),
				],
			),
			h.div(
				[
					h.Class(
						"grid grid-cols-2 border-border border-t lg:grid-cols-4 lg:divide-x lg:divide-border",
					),
				],
				[
					column(h, "Provides", [chips(h, descriptor.provides)]),
					column(h, "Records synced", [
						value(h, records[0] ?? "Nothing yet"),
						detail(h, records.slice(1, 3).join(" · ")),
					]),
					lastSyncColumn(h, model, connection, context),
					column(h, "Sync mode", syncModeLines(h, connection)),
				],
			),
		],
	)
}

// NOT CONNECTED

/** "Adds to the model": what connecting brings. */
export const addsList = (h: H, provider: CustomerProvider): Html =>
	h.ul(
		[h.Class("flex flex-col gap-1.5")],
		providerOf(provider).adds.map((item) =>
			h.li(
				[h.Class("flex items-start gap-2 text-sm")],
				[
					IconCheck(h, { className: "mt-0.5 size-3.5 shrink-0 text-success" }),
					h.span(
						[],
						[
							h.span([h.Class("font-medium text-fg")], [item.title]),
							h.span([h.Class("text-muted-fg")], [` ${item.detail}`]),
						],
					),
				],
			),
		),
	)

/** Connect (or reconnect a disconnected source); "Coming soon" while it has no integration. */
export const connectButton = (
	h: H,
	provider: CustomerProvider,
	connection: ConnectionRow | undefined,
): Html => {
	const descriptor = providerOf(provider)
	return descriptor.isAvailable
		? button(h, { intent: "outline", size: "sm", onPress: Message.PressedConnect({ provider }) }, [
				IconPlus(h, { attributes: { "data-slot": "icon" } }),
				`${connection === undefined ? "Connect" : "Reconnect"} ${descriptor.name}`,
			])
		: button(h, { intent: "outline", size: "sm", isDisabled: true }, ["Coming soon"])
}

const notConnectedCard = (
	h: H,
	provider: CustomerProvider,
	connection: ConnectionRow | undefined,
	context: Context,
): Html => {
	const descriptor = providerOf(provider)
	return h.article(
		[
			h.AriaLabel(descriptor.name),
			h.Class(
				"grid gap-4 rounded-xl border border-border bg-bg p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-center",
			),
		],
		[
			h.div(
				[h.Class("flex items-start gap-3")],
				[
					sourceMark(h, provider, { size: "md" }),
					h.div(
						[h.Class("flex min-w-0 flex-col gap-0.5")],
						[
							h.div(
								[h.Class("flex flex-wrap items-center gap-2")],
								[
									h.h3(
										[h.Class("font-medium text-base/6 text-fg")],
										[
											h.a(
												[
													h.Href(detailHref(context, provider)),
													h.Class("hover:underline"),
												],
												[descriptor.name],
											),
										],
									),
									...(connection === undefined
										? descriptor.isAvailable
											? []
											: [comingSoonBadge(h)]
										: [statusBadge(h, "disconnected")]),
								],
							),
							h.p([h.Class("text-muted-fg text-sm")], [descriptor.blurb]),
							...(connection?.disconnectedAtMs == null
								? []
								: [
										h.p(
											[h.Class("text-muted-fg text-xs")],
											[
												`Disconnected ${formatDate(new Date(connection.disconnectedAtMs), { now: new Date(context.nowMs) })}. Its data is kept, marked stale.`,
											],
										),
									]),
						],
					),
				],
			),
			h.div(
				[h.Class("flex flex-col gap-2 lg:border-border lg:border-l lg:pl-5")],
				[eyebrow(h, "Adds to the model"), addsList(h, provider)],
			),
			...(context.isAdmin ? [connectButton(h, provider, connection)] : []),
		],
	)
}

// PAGE

const section = (h: H, title: string, count: number, children: ReadonlyArray<Html>): Html =>
	h.section(
		[h.Class("flex flex-col gap-3")],
		[
			h.h2(
				[h.Class("flex items-center gap-2 font-semibold text-fg text-sm")],
				[title, h.span([h.Class("font-normal text-muted-fg tabular-nums")], [formatCount(count)])],
			),
			...children,
		],
	)

export const overviewView = (h: H, model: Model, context: Context): Html => {
	const live = PROVIDER_ORDER.flatMap((provider) => {
		const connection = connectionOf(model, provider)
		return connection !== undefined && isLive(connection) ? [connection] : []
	})
	const rest = PROVIDER_ORDER.filter(
		(provider) => !live.some((connection) => connection.provider === provider),
	)
	const isEmpty = model.connections !== null && model.connections.length === 0
	return settingsPage(h, [
		settingsHeader(h, {
			title: "Data sources",
			subtitle:
				"Integrations that write accounts, contacts, billing and usage into one customer model.",
			actions: [
				...(import.meta.env.DEV && context.isAdmin && isEmpty
					? [
							button(
								h,
								{
									intent: "outline",
									size: "sm",
									isPending: model.isSeedingDemo,
									onPress: Message.PressedLoadDemo(),
								},
								["Load demo data"],
							),
						]
					: []),
				...(context.isAdmin && live.length > 0
					? [
							button(h, { intent: "outline", size: "sm", onPress: Message.PressedSyncAll() }, [
								IconArrowPath(h, { attributes: { "data-slot": "icon" } }),
								"Sync all",
							]),
						]
					: []),
			],
		}),
		...(context.isAdmin ? [] : [readOnlyNotice(h, "data sources")]),
		...(model.connections === null
			? [h.p([h.Class("text-muted-fg text-sm")], ["Loading data sources…"])]
			: [
					coverageCard(h, model, context, live),
					...(live.length === 0
						? []
						: [
								section(
									h,
									"Connected",
									live.length,
									live.map((connection) => connectedCard(h, model, connection, context)),
								),
							]),
					...(rest.length === 0
						? []
						: [
								section(
									h,
									"Not connected",
									rest.length,
									rest.map((provider) =>
										notConnectedCard(h, provider, connectionOf(model, provider), context),
									),
								),
							]),
				]),
	])
}
