import "@fontsource/inter/400.css"
import "@fontsource/inter/500.css"
import "@fontsource/inter/600.css"
import "../styles.css"
import { Context } from "effect"
import type { Html, HtmlBuilder } from "foldkit/html"
import { MountTracker } from "foldkit/mount"
import { __clearRuntime, __htmlBuilder, __setRuntime } from "foldkit-internal/html/index.js"
import { Dispatch } from "foldkit-internal/runtime/dispatch.js"
import { patch } from "foldkit-internal/vdom.js"
import { afterEach, test } from "vitest"
import { page } from "vitest/browser"
import { IconCheck, IconClock, IconDots, IconUser } from "../icons"
import {
	ACCOUNTS,
	ACCOUNTS_BY_KEY,
	CLERK_CONNECTION,
	MAPLE_ERROR_AT,
	NOW,
	OPEN_ENTRIES,
	SETTINGS,
	STRIPE_PROGRESS,
	memberOf,
	overviewFixture,
} from "../lab/fixtures/customers"
import { healthDistribution } from "./charts/distribution"
import { chartCard, chartLegend } from "./charts/frame"
import { ACTIVE_USERS_LEGEND, activeUsersChart } from "./charts/line-chart"
import { sparkline } from "./charts/sparkline"
import { mrrLegend, mrrMovementChart } from "./charts/stacked-bar-chart"
import {
	formatCount,
	formatDeltaPct,
	formatDeltaPoints,
	formatMoney,
	formatPct,
	formatRelative,
} from "./format"
import { healthBadge, healthDot, kindChip, severityChip, stageBadge } from "./ui/badges"
import { connectCard } from "./ui/connect-card"
import { dataTable, primaryCell } from "./ui/data-table"
import { allClearState } from "./ui/empty-states"
import { evidenceViz } from "./ui/evidence"
import {
	addFilterButton,
	filterBar,
	filterChip,
	rangePicker,
	segmented,
	sortTrigger,
	viewTabs,
} from "./ui/filter-bar"
import { companyLogo, personLabel, sourceChip } from "./ui/identity"
import { kpiTile } from "./ui/kpi-tile"
import { queueAction, queueList, queueRow } from "./ui/queue-row"
import { QUEUE_SHORTCUTS, shortcutBar } from "./ui/shortcuts"

/**
 * The Customers kit gallery: the kit's real views over the lab fixtures, screenshotted in light and
 * dark (`bun run gallery`). Writes `customers-light.png` / `customers-dark.png` (or
 * `<VITE_GALLERY_LABEL>-customers-*.png`). Charts render with a hovered index, so the tooltips show.
 */

type M = Readonly<{ _tag: "Ignored" }>
const ignored: M = { _tag: "Ignored" }

const render = (view: (h: HtmlBuilder<M>) => Html) => {
	const dispatch = Dispatch.of({ dispatchAsync: () => undefined as never, dispatchSync: () => undefined })
	__setRuntime(
		dispatch.dispatchSync,
		Context.make(Dispatch, dispatch).pipe(
			Context.add(MountTracker, { started: () => {}, ended: () => {} }),
		),
	)
	try {
		const vnode = view(__htmlBuilder<M>())
		const container = document.createElement("div")
		document.body.append(container)
		if (vnode) patch(container, vnode)
	} finally {
		__clearRuntime()
	}
}

afterEach(() => {
	document.body.innerHTML = ""
	document.documentElement.classList.remove("dark")
})

const overview = overviewFixture("30d")
const yearly = overviewFixture("12m")

const kpis = (h: HtmlBuilder<M>) =>
	h.div(
		[h.Class("grid grid-cols-4 gap-4")],
		[
			kpiTile(h, {
				id: "mrr",
				label: "MRR",
				definition: "Monthly recurring revenue.",
				value: formatMoney(overview.kpis.mrrMinor.value),
				delta: { value: 6.2, text: formatDeltaPct(6.2) },
				comparison: "vs previous 30 days",
				trend: sparkline(h, {
					values: [41, 42, 43, 43, 45, 45, 46, 47, 48],
					size: "md",
					area: true,
					ariaLabel: "MRR",
				}),
			}),
			kpiTile(h, {
				id: "churn",
				label: "Logo churn",
				value: formatPct(2.8),
				delta: { value: 0.9, text: formatDeltaPoints(0.9), goodWhen: "down" },
				comparison: "vs previous 30 days",
				trend: sparkline(h, {
					values: [1.6, 1.9, 1.8, 2.1, 2.4, 2.8],
					size: "md",
					area: true,
					tone: "negative",
					ariaLabel: "Churn",
				}),
			}),
			kpiTile(h, {
				id: "stickiness",
				label: "Stickiness (WAU ÷ MAU)",
				value: "61%",
				detail: `${formatCount(978)} / ${formatCount(1_611)}`,
				delta: { value: 2, text: formatDeltaPoints(2) },
				comparison: "vs previous 30 days",
			}),
			kpiTile(h, { id: "paying", label: "Paying customers", state: "loading" }),
		],
	)

const badges = (h: HtmlBuilder<M>) =>
	h.div(
		[h.Class("flex flex-wrap items-center gap-2")],
		[
			healthBadge(h, { status: "healthy", score: 82 }),
			healthBadge(h, { status: "at_risk", score: 54 }),
			healthBadge(h, { status: "critical", score: 27 }),
			healthBadge(h, { status: "unknown", score: null }),
			healthDot(h, { status: "healthy", score: 82 }),
			severityChip(h, "high"),
			severityChip(h, "medium"),
			severityChip(h, "low"),
			kindChip(h, "risk"),
			kindChip(h, "opportunity"),
			stageBadge(h, "lead"),
			stageBadge(h, "trialing", { trialDaysLeft: 4 }),
			stageBadge(h, "active"),
			stageBadge(h, "past_due"),
			stageBadge(h, "churned"),
			sourceChip(h, "stripe"),
		],
	)

const charts = (h: HtmlBuilder<M>) =>
	h.div(
		[h.Class("grid grid-cols-[1fr_1fr_24rem] gap-4")],
		[
			chartCard(
				h,
				{
					title: "Active users",
					description: "Last 30 days",
					aside: chartLegend(h, ACTIVE_USERS_LEGEND),
				},
				[
					activeUsersChart(h, {
						points: overview.activeUsers,
						bucket: "day",
						hoveredIndex: 21,
						onHover: () => ignored,
					}),
				],
			),
			chartCard(
				h,
				{
					title: "MRR movement",
					description: "Last 12 months",
					aside: chartLegend(h, mrrLegend(yearly.mrrMovements)),
				},
				[
					mrrMovementChart(h, {
						buckets: yearly.mrrMovements,
						bucket: "month",
						currency: "USD",
						hoveredIndex: 10,
						onHover: () => ignored,
					}),
				],
			),
			healthDistribution(h, {
				rows: overview.healthDistribution,
				bands: SETTINGS.health.bands,
				currency: "USD",
				metric: "customers",
				onMetric: () => ignored,
			}),
		],
	)

const table = (h: HtmlBuilder<M>) =>
	dataTable(h, {
		ariaLabel: "Customers",
		id: "gallery",
		columns: [
			{
				key: "name",
				label: "Customer",
				cell: (account) =>
					primaryCell(h, {
						leading: companyLogo(h, { name: account.name }),
						title: account.name,
						subtitle: account.domains[0] ?? null,
					}),
				footer: "4 customers",
			},
			{
				key: "owner",
				label: "Owner",
				widthClass: "w-48",
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
				cell: (account) => formatMoney(account.mrrMinor),
			},
			{
				key: "health",
				label: "Health",
				widthClass: "w-32",
				cell: (account) =>
					healthBadge(h, { status: account.healthStatus, score: account.healthScore }),
			},
			{
				key: "last",
				label: "Last active",
				align: "right",
				widthClass: "w-28",
				cell: (account) =>
					account.lastActiveAt === null ? "Never" : formatRelative(account.lastActiveAt, NOW),
			},
		],
		rows: ACCOUNTS.slice(0, 4),
		rowKey: (account) => account.id,
		sort: { key: "mrr", direction: "desc" },
		onSort: () => ignored,
		selection: {
			selected: new Set([ACCOUNTS_BY_KEY.kestrel.id]),
			onToggle: () => ignored,
			onToggleAll: () => ignored,
		},
		focusedKey: ACCOUNTS_BY_KEY.acme.id,
	})

const queue = (h: HtmlBuilder<M>) =>
	queueList(
		h,
		{ ariaLabel: "Needs attention" },
		OPEN_ENTRIES.slice(0, 4).map(({ signal, account }, index) => {
			return queueRow(h, {
				id: `gallery-${signal.id}`,
				rank: index + 1,
				account: {
					name: account.name,
					logoUrl: null,
					planName: account.planName,
					mrrMinor: account.mrrMinor,
					currency: "USD",
				},
				signal,
				evidence: evidenceViz(h, signal.evidence),
				age: formatRelative(signal.openedAt, NOW).replace(" ago", ""),
				assignee: memberOf(signal.assigneeUserId),
				health: { status: account.healthStatus, score: account.healthScore },
				isFocused: index === 1,
				actions: [
					queueAction(h, { label: "Assign", icon: IconUser(h), onPress: ignored }),
					queueAction(h, { label: "Snooze", icon: IconClock(h), onPress: ignored }),
					queueAction(h, { label: "Done", icon: IconCheck(h), onPress: ignored }),
					queueAction(h, { label: "More", icon: IconDots(h), iconOnly: true, onPress: ignored }),
				],
			})
		}),
	)

const controls = (h: HtmlBuilder<M>) =>
	h.div(
		[h.Class("flex flex-col gap-3")],
		[
			h.div(
				[h.Class("flex items-end justify-between")],
				[
					viewTabs(h, {
						ariaLabel: "Queue",
						tabs: [
							{ key: "open", label: "Open", count: 12 },
							{ key: "snoozed", label: "Snoozed", count: 4 },
							{ key: "done", label: "Done" },
						],
						selected: "open",
						onSelect: () => ignored,
						className: "flex-1",
					}),
					rangePicker(h, { selected: "30d", onSelect: () => ignored }),
				],
			),
			filterBar(h, {
				start: [
					filterChip(h, { field: "Kind", operator: "is", value: "Risk", onRemove: ignored }),
					filterChip(h, {
						field: "Severity",
						operator: "is any of",
						value: "High, Medium",
						onRemove: ignored,
					}),
					addFilterButton(h),
				],
				end: [
					sortTrigger(h, { label: "Priority" }),
					segmented(h, {
						ariaLabel: "Group by",
						segments: [
							{ key: "signals", label: "Signals" },
							{ key: "accounts", label: "Accounts" },
						],
						selected: "signals",
						onSelect: () => ignored,
					}),
				],
			}),
			shortcutBar(h, QUEUE_SHORTCUTS),
		],
	)

const sources = (h: HtmlBuilder<M>) =>
	h.div(
		[h.Class("grid grid-cols-[1fr_1fr_1fr_20rem] gap-4")],
		[
			connectCard(h, {
				provider: "clerk",
				now: NOW,
				status: {
					_tag: "Connected",
					syncedAt: CLERK_CONNECTION.lastSyncAt,
					summary: "214 organizations · 1,862 users",
					onSyncNow: ignored,
				},
			}),
			connectCard(h, {
				provider: "stripe",
				now: NOW,
				status: {
					_tag: "Syncing",
					step: "invoices",
					done: STRIPE_PROGRESS.done,
					total: STRIPE_PROGRESS.total,
					onCancel: ignored,
				},
			}),
			connectCard(h, {
				provider: "maple",
				now: NOW,
				status: {
					_tag: "Error",
					at: MAPLE_ERROR_AT,
					message: "API key was revoked.",
					action: { label: "Update API key", onPress: ignored },
				},
			}),
			allClearState(h, { snoozedCount: 4, onViewSnoozed: ignored }),
		],
	)

const screen = (h: HtmlBuilder<M>) =>
	h.div(
		[h.Id("gallery"), h.Class("flex w-[1600px] flex-col gap-6 bg-bg p-8 font-sans text-fg antialiased")],
		[badges(h), kpis(h), charts(h), controls(h), queue(h), table(h), sources(h)],
	)

for (const theme of ["light", "dark"] as const) {
	test(theme, async () => {
		if (theme === "dark") document.documentElement.classList.add("dark")
		await page.viewport(1600, 1800)
		render(screen)
		await document.fonts.ready
		const label = import.meta.env.VITE_GALLERY_LABEL ? `${import.meta.env.VITE_GALLERY_LABEL}-` : ""
		const gallery = document.getElementById("gallery")
		if (gallery === null) throw new Error("The gallery did not render")
		await page.screenshot({ path: `${label}customers-${theme}.png`, element: gallery })
	})
}
