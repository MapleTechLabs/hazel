// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The overview's view (today's `overview/view.ts`): the header, the headline numbers, the queue and
 * its side column, suggested links, this period's lists, the folded charts, and the setup cards.
 */
import {
	billingPreferenceOrder,
	startingIntegration,
	suggestedBillingIntegration,
} from "@hazel/customer-integrations"
import type * as Customers from "@hazel/domain/customers"
import type { Content, Hazel } from "@hazel/ui/vocabulary/index"
import { Cause, Option } from "effect"
import { type CommonReason, commonCopy } from "../../../modals/feedback"
import {
	bucketLabels,
	deltaTone,
	formatCount,
	formatDate,
	formatDeltaCount,
	formatDeltaPct,
	formatMetricValue,
	formatMoney,
	formatPct,
	formatRelative,
} from "../../data/format"
import { customerAccountOf, environmentCounts, environmentsHintOf, queueNameOf } from "../../data/groups"
import { connectBillingTitle, PROVIDER_ORDER, providerOf, startingSource } from "../../data/providers"
import { type AccountRow, msOf, type SignalRow } from "../../data/queries"
import { reasonSummary, type ShownSuggestion, shownSuggestions } from "../../data/suggestions"
import { connectCard } from "../../ui/connect-card"
import { companyLogo } from "../../ui/identity"
import { type Delta, kpiTile } from "../../ui/kpi-tile"
import { rangePicker } from "../../ui/filter-bar"
import { OverviewMessage as Message, type OverviewH, type OverviewModel } from "./model"
import { customersHref, pageHeader, panel, panelHeader } from "../parts"
import { formatResponse, formatWithin } from "../support/report"
import {
	ATTENTION_SHOWN,
	isConverted,
	newAccounts,
	openSignals,
	previousPeriodOf,
	QUIET_AFTER_DAYS,
	quietAccounts,
	SUGGESTIONS_SHOWN,
} from "./data"

type Result = Customers.OverviewResult
type Msg = Message
type Child = Hazel.NoTextInput<Msg>
type H = OverviewH

interface Context {
	readonly session: OverviewH["props"]["session"]
	readonly nowMs: number
	readonly accountsById: ReadonlyMap<string, AccountRow>
	/** Each primary's environments: a signal's customer is the primary. */
	readonly environmentCounts: ReadonlyMap<string, number>
}

const href = (context: Context, path: string) => customersHref(context.session, path)
const accountHref = (context: Context, accountId: string) => href(context, `/${accountId}`)
const listHref = (context: Context, view?: string) =>
	href(context, view === undefined ? "/list" : `/list?view=${view}`)

const isUnconnected = (model: OverviewModel) => model.providers !== null && model.providers.length === 0

const successOf = <A>(result: { readonly _tag: string; readonly value?: A }): A | undefined =>
	result._tag === "Success" ? result.value : undefined

/** A link at a panel's end (today's `moreLink`). */
const moreLink = (h: H, label: string, to: string) => h.link.label(label).href(to)

/** A KPI's change, in the tone its direction earns. */
// HAZEL-GAP(pk1-delta-arrow): today's delta pill leads with an up or down arrow; `IconName` has no arrow-down.
const deltaText = (h: H, delta: Delta) => {
	const tone = deltaTone(delta.value, delta.goodWhen ?? "up")
	return h.text
		.role("caption")
		.strong()
		.numeric()
		.tone(tone === "positive" ? "success" : tone === "negative" ? "danger" : "muted")
		.children(delta.text)
}

/** A label that explains itself on hover (today's `definedLabel`). */
const definedLabel = (h: H, label: string, definition: string) =>
	h.popover
		.open()
		.trigger("hover")
		.anchor(h.text.role("caption").strong().tone("muted").children(label))
		.children(h.text.role("caption").children(definition))

// HEADER

const header = (h: H, model: OverviewModel, result: Result | undefined) => {
	const { nowMs } = h.props
	const customers = model.accounts?.length ?? 0
	const synced =
		model.settings?.lastComputedAtMs == null
			? null
			: `Synced ${formatRelative(new Date(model.settings.lastComputedAtMs), new Date(nowMs))}`
	const subtitle = isUnconnected(model)
		? "No data sources connected yet"
		: [
				`${result?.hasData.billing === false ? "Usage" : "Revenue and usage"} across ${formatCount(customers)} customers`,
				...(synced === null ? [] : [synced]),
			].join(" · ")
	const previous = previousPeriodOf(model.range, nowMs)
	const now = { now: new Date(nowMs) }
	return pageHeader(h, {
		title: "Overview",
		stacked: h.props.isMobile,
		actionsDensity: "regular",
		subtitle,
		actions: isUnconnected(model)
			? []
			: [
					// A row keeps the switch beside its label (a toggle fills its line alone).
					h.stack.axis("horizontal").children(
						h.toggle
							.label(
								`Compare to ${formatDate(new Date(previous.startMs), now)} – ${formatDate(new Date(previous.endMs), now)}`,
							)
							.checked(model.isComparing)
							.on("change", ({ checked }) => Message.ToggledCompare({ isComparing: checked })),
					),
					rangePickerOf(h, model),
				],
	})
}

const rangePickerOf = (h: H, model: OverviewModel) =>
	rangePicker(h, {
		selected: model.range,
		onSelect: (range) => Message.ClickedRange({ range }),
		caption: null,
	})

// HEADLINE

const pctDelta = (model: OverviewModel, kpi: Customers.Kpi, goodWhen: "up" | "down" = "up"): Delta | null =>
	!model.isComparing || kpi.deltaPct === null
		? null
		: { value: kpi.deltaPct, text: formatDeltaPct(kpi.deltaPct), goodWhen }

const countDelta = (model: OverviewModel, kpi: Customers.Kpi, goodWhen: "up" | "down" = "up"): Delta | null =>
	!model.isComparing || kpi.previous === null
		? null
		: { value: kpi.value - kpi.previous, text: formatDeltaCount(kpi.value - kpi.previous), goodWhen }

const HEADLINE_LABELS = ["MRR", "MRR at risk", "Active customers"] as const

/**
 * The three numbers worth reading every day: revenue, the revenue at risk, and who is using the
 * product. The rest of the KPIs follow in one quiet line.
 */
// HAZEL-GAP(pk1-kpi-strip): today's three numbers share one card split by hairlines; here each is its own tile.
const headline = (h: H, model: OverviewModel, result: Result | undefined, context: Context) => {
	const strip = (tiles: ReadonlyArray<Child>) =>
		h.grid
			.key("headline")
			.columns("3")
			.density("cozy")
			.children(...tiles)
	if (result === undefined)
		return strip(HEADLINE_LABELS.map((label) => kpiTile(h, { label, state: "loading" }).key(label)))
	const { kpis, currency } = result
	const total = model.accounts?.length ?? 0
	const active = kpiTile(h, {
		label: "Active customers",
		definition: "Customers with at least one active user in the last 30 days.",
		value: formatCount(kpis.activeCustomers.value),
		detail: `of ${formatCount(total)}`,
		delta: pctDelta(model, kpis.activeCustomers),
		comparison: `${formatCount(kpis.mau.value)} monthly users`,
	}).key("active")
	if (!result.hasData.billing)
		return strip([
			kpiTile(h, {
				label: "MRR · MRR at risk",
				state: "empty",
				emptyAction: h.stack.density("tight").children(
					h.text.role("label").strong().children(connectBillingTitle()),
					h.stack
						.axis("horizontal")
						.density("cozy")
						.align("center")
						.wrap()
						.children(
							h.text
								.role("caption")
								.tone("muted")
								.children(
									`Subscriptions are matched to your ${formatCount(total)} customers automatically.`,
								),
							moreLink(h, "Connect billing", href(context, "/settings/sources")),
						),
				),
			}).key("billing"),
			active,
		])
	const atRiskPct = kpis.mrrMinor.value === 0 ? 0 : (kpis.atRiskMrrMinor.value / kpis.mrrMinor.value) * 100
	return strip([
		kpiTile(h, {
			label: "MRR",
			definition:
				"Monthly recurring revenue of every active subscription, plus usage billing averaged over the last 3 months, in the reporting currency.",
			value: formatMoney(kpis.mrrMinor.value, currency),
			delta: pctDelta(model, kpis.mrrMinor),
			comparison: model.isComparing ? "vs previous period" : undefined,
		}).key("mrr"),
		// HAZEL-GAP(pk1-stat-value-tone): today's at-risk value is in the warning ink while above zero.
		kpiTile(h, {
			label: "MRR at risk",
			definition: "MRR of customers with an open high-severity risk signal.",
			value: formatMoney(kpis.atRiskMrrMinor.value, currency),
			comparison: `${formatPct(atRiskPct, { digits: 0 })} of MRR`,
		}).key("at-risk"),
		active,
	])
}

/** Revenue, paying customers and logo churn: worth a glance, not a tile each. */
const secondaryLine = (h: H, model: OverviewModel, result: Result | undefined) => {
	if (result === undefined || !result.hasData.billing) return null
	const { kpis, currency } = result
	const total = model.accounts?.length ?? 0
	const churnBase = kpis.payingCustomers.previous ?? kpis.payingCustomers.value
	const churnPct = churnBase === 0 ? 0 : (kpis.logoChurn.value / churnBase) * 100
	const part = (
		key: string,
		label: string,
		definition: string,
		value: string,
		delta: Delta | null,
		detail?: string,
	) =>
		h.stack
			.key(key)
			.axis("horizontal")
			.density("snug")
			.align("center")
			.children(
				definedLabel(h, label, definition),
				h.text.role("label").strong().numeric().children(value),
				detail === undefined ? null : h.text.role("label").tone("muted").numeric().children(detail),
				delta === null ? null : deltaText(h, delta),
			)
	return (
		h.stack
			.key("secondary")
			.axis("horizontal")
			// HAZEL-GAP(pk1-row-gaps): today's line is `gap-x-6 gap-y-1`; a stack has one gap.
			.density(h.props.isMobile ? "tight" : "relaxed")
			.align("center")
			.wrap()
			.children(
				part(
					"revenue",
					"Revenue",
					"Revenue collected in the period from paid invoices, recurring and one-off, in the reporting currency.",
					formatMoney(kpis.revenueMinor.value, currency),
					pctDelta(model, kpis.revenueMinor),
				),
				part(
					"paying",
					"Paying customers",
					"Customers with MRR above zero.",
					formatCount(kpis.payingCustomers.value),
					countDelta(model, kpis.payingCustomers),
					`of ${formatCount(total)}`,
				),
				part(
					"churn",
					"Logo churn",
					"Paying customers lost in the period, as a share of those paying at its start.",
					formatPct(churnPct),
					countDelta(model, kpis.logoChurn, "down"),
					`${formatCount(kpis.logoChurn.value)} of ${formatCount(churnBase)}`,
				),
			)
	)
}

// NEEDS ATTENTION

/** Rows of a card, a hairline between them running edge to edge. */
const rowsOf = (h: H, rows: ReadonlyArray<Child>) =>
	rows.flatMap((row, index) => (index === 0 ? [row] : [h.divider.key(`divider:${index}`), row]))

/** The queue's top rows: the page's main list. Each row opens the customer. */
const attentionSection = (h: H, model: OverviewModel, context: Context) => {
	const open = openSignals(model.signals, model.accounts)
	const userId = context.session.user?.id ?? null
	// "Mine" as the queue and the sidebar badge count it: signals on accounts I own.
	const mine = open.filter((signal) => {
		const account = context.accountsById.get(signal.accountId)
		return (
			userId !== null &&
			account !== undefined &&
			customerAccountOf(account, context.accountsById).ownerUserId === userId
		)
	}).length
	// HAZEL-GAP(p4-item-subtitle-icons): today's second line leads with the severity bars and sets the title in fg-2.
	const row = (signal: SignalRow) => {
		const account = context.accountsById.get(signal.accountId)
		if (account === undefined) return null
		const environments = environmentsHintOf(context.environmentCounts.get(account.id) ?? 0)
		return h.item
			.key(signal.id)
			.leadingSize("large")
			.href(accountHref(context, account.id))
			.title(environments === null ? queueNameOf(account) : `${queueNameOf(account)} · ${environments}`)
			.subtitle(`${signal.title} · ${signal.reason}`)
			.leading(companyLogo(h, { name: account.name, logoUrl: account.logoUrl, size: "sm" }))
			.trailing(
				h.text
					.role("caption")
					.tone("muted")
					.numeric()
					.children(
						account.mrrMinor > 0 ? `${formatMoney(account.mrrMinor, account.currency)}/mo` : "",
					),
			)
	}
	const rows = open.slice(0, ATTENTION_SHOWN).flatMap((signal) => {
		const each = row(signal)
		return each === null ? [] : [each]
	})
	const count =
		open.length === 0
			? null
			: `${formatCount(open.length)} open${mine > 0 ? ` · ${formatCount(mine)} on your accounts` : ""}`
	return h.frame
		.key("attention")
		.surface("flush")
		.children(
			h.stack.inset("bar").children(
				h.stack
					.axis("horizontal")
					.align("center")
					.children(
						h.stack
							.axis("horizontal")
							.density("compact")
							.align("center")
							.children(
								h.heading.children("Needs attention"),
								count === null
									? null
									: h.text.role("label").tone("muted").numeric().children(count),
							),
						h.spacer,
						moreLink(h, "View queue", href(context, "/attention")),
					),
			),
			...(model.signals === null
				? [h.progress.key("loading").style("spinner").label("Loading the queue")]
				: rows.length === 0
					? [h.emptyState.key("clear").title("All clear: no open signals.")]
					: [h.divider.key("top"), ...rowsOf(h, rows)]),
		)
}

// SIDE COLUMN: DROPS AND SUPPORT

/** The customers whose usage fell most, beside the queue: the ones a signal may not have caught yet. */
const dropsCard = (h: H, result: Result, context: Context) => {
	const drops = result.topMovers.decliners.slice(0, 4)
	return h.frame
		.key("drops")
		.surface("flush")
		.children(
			h.stack
				.inset("bar")
				.density("none")
				.children(
					h.heading.level("3").children("Biggest usage drops"),
					h.text
						.role("caption")
						.tone("muted")
						.children(
							result.range === "12m"
								? "Daily active users, last 90 days"
								: "Daily active users, this period",
						),
				),
			drops.length === 0
				? h.stack
						.inset("bar")
						.children(h.text.role("label").tone("muted").children("No big drops in this period."))
				: h.stack.density("none").children(
						...drops.map((mover) =>
							h.item
								.key(mover.accountId)
								.href(accountHref(context, mover.accountId))
								.title(mover.name)
								.leading(
									companyLogo(h, { name: mover.name, logoUrl: mover.logoUrl, size: "xs" }),
								)
								.trailing(
									deltaText(h, {
										value: mover.changePct,
										text: formatDeltaPct(mover.changePct),
									}),
								),
						),
					),
		)
}

/** First response and breaches for the range, in a small card that opens the Support report. */
const supportCard = (h: H, context: Context) => {
	const result = h.queries.support
	const report = successOf(result)
	const stat = (key: string, label: string, value: string, danger = false) =>
		h.property
			.key(key)
			.label(label)
			.style("justified")
			.children(
				h.text
					.role("label")
					.strong()
					.numeric()
					.tone(danger ? "danger" : "default")
					.children(value),
			)
	return panel(h, "support", [
		h.stack
			.axis("horizontal")
			.align("center")
			.children(
				h.heading.level("3").children("Support"),
				h.spacer,
				moreLink(h, "Report", href(context, "/support")),
			),
		...(report === undefined
			? result._tag === "Failure"
				? [
						h.button
							.label("Couldn't load · Retry")
							.icon("refresh")
							.variant("ghost")
							.size("xsmall")
							.on("press", Message.PressedRetrySupport()),
					]
				: [h.progress.key("loading").style("spinner").label("Loading support")]
			: [
					stat("median", "Median first response", formatResponse(report.firstResponse.medianMs)),
					stat("within", "Within SLA", formatWithin(report.firstResponse.withinPct)),
					stat(
						"breaches",
						report.overdueNow > 0
							? `Breaches · ${formatCount(report.overdueNow)} overdue now`
							: "Breaches",
						formatCount(report.breaches),
						report.overdueNow > 0,
					),
				]),
	])
}

// SUGGESTED CHANNEL LINKS

/** One suggestion: channel → account, the strongest reason, strength, Link and dismiss. */
const suggestionRow = (h: H, shown: ShownSuggestion, context: Context) => {
	const { suggestion, channel } = shown
	const summary = reasonSummary(suggestion)
	// HAZEL-GAP(pk1-suggestion-reasons): today's "+2" opens the other reasons in place; here it only counts them.
	const reason =
		summary === null
			? null
			: summary.others.length === 0
				? summary.top
				: `${summary.top} +${summary.others.length}`
	return h.stack
		.key(suggestion.id)
		.axis("horizontal")
		.density("cozy")
		.align("center")
		.children(
			h.stack.density("tight").children(
				h.stack
					.axis("horizontal")
					.density("snug")
					.align("center")
					.children(
						h.channelIcon
							.private(channel.isPrivate)
							.sync(
								channel.origin === "slack" || channel.origin === "discord"
									? channel.origin
									: "none",
							),
						h.text.role("label").strong().truncate().children(channel.name),
						h.text.role("label").tone("muted").children("→"),
						h.link.label(suggestion.accountName).href(accountHref(context, suggestion.accountId)),
						suggestion.strength === "strong"
							? h.text.role("caption").strong().tone("success").children("Strong match")
							: null,
					),
				reason === null ? null : h.text.role("caption").tone("muted").children(reason),
			),
			h.spacer,
			h.button
				.label("Link")
				.variant("outline")
				.size("xsmall")
				.on("press", Message.PressedAcceptSuggestion({ suggestionId: suggestion.id })),
			h.button
				.label(`Dismiss: ${channel.name} is not ${suggestion.accountName}`)
				.icon("close")
				.iconOnly()
				.variant("ghost")
				.size("xsmall")
				.on("press", Message.PressedDismissSuggestion({ suggestionId: suggestion.id })),
		)
}

/** Channels that look like a customer's, best first; hidden while there are none. */
const suggestionsCard = (h: H, model: OverviewModel, context: Context) => {
	const items = successOf(h.queries.suggestions) ?? []
	const shown = shownSuggestions({ items, hidden: model.hiddenSuggestions }, model.channels)
	if (shown.length === 0) return null
	const more = shown.length - SUGGESTIONS_SHOWN
	return panel(h, "suggestions", [
		panelHeader(h, {
			title: "Suggested channel links",
			count: shown.length,
			description:
				more > 0
					? `Channels that look like a customer's. ${formatCount(more)} more after these.`
					: "Channels that look like a customer's. Linking shows the customer in the channel.",
		}),
		h.stack.density("none").children(
			...rowsOf(
				h,
				shown.slice(0, SUGGESTIONS_SHOWN).map((entry) => suggestionRow(h, entry, context)),
			),
		),
	])
}

// THIS PERIOD

const LIFECYCLE_SHOWN = 4

const accountsLabel = (count: number): string => `${formatCount(count)} account${count === 1 ? "" : "s"}`

type ValueTone = "default" | "muted" | "success" | "warning" | "danger"

interface ListEntry {
	readonly accountId: string
	readonly name: string
	readonly logoUrl: string | null
	readonly detail: string
	readonly date: number
	readonly value: string
	readonly tone?: ValueTone
}

// HAZEL-GAP(pk1-list-row-meta): today's row is one line (name, plan, date, value); `item` sets the plan under the name.
const listRow = (h: H, context: Context, entry: ListEntry) =>
	h.item
		.key(entry.accountId)
		.href(accountHref(context, entry.accountId))
		.title(entry.name)
		.subtitle(entry.detail === "" ? undefined : entry.detail)
		.leading(companyLogo(h, { name: entry.name, logoUrl: entry.logoUrl, size: "xs" }))
		.trailing(
			h.text
				.role("caption")
				.tone("muted")
				.numeric()
				.children(formatDate(new Date(entry.date), { now: new Date(context.nowMs) })),
			h.text
				.role("label")
				.numeric()
				.tone(entry.tone ?? "default")
				.children(entry.value),
		)

/** One column: a title, a one-line summary, a few rows and a way to all of them. */
const lifecycleColumn = (
	h: H,
	options: Readonly<{
		key: string
		title: string
		summary: string
		aside: Child
		rows: ReadonlyArray<Child>
		empty: string
	}>,
) =>
	h.stack
		.key(options.key)
		.inset("page")
		.density("tight")
		.children(
			h.stack
				.axis("horizontal")
				.align("center")
				.children(h.heading.level("3").children(options.title), h.spacer, options.aside),
			h.text.role("caption").tone("muted").children(options.summary),
			options.rows.length === 0
				? h.text.role("label").tone("muted").children(options.empty)
				: h.stack.density("none").children(...options.rows.slice(0, LIFECYCLE_SHOWN)),
		)

/** Who arrived, who is trying it and who left in the range: one panel, three columns. */
// HAZEL-GAP(pk1-divided-columns): today's columns are split by hairlines inside one card.
const lifecycleSection = (h: H, model: OverviewModel, result: Result, context: Context) => {
	const panelOf = (columns: ReadonlyArray<Child>) =>
		h.stack
			.key("period")
			.density("cozy")
			.children(
				h.heading.children("This period"),
				h.frame.surface("flush").children(
					h.grid
						.columns(columns.length === 3 ? "3" : "2")
						.density("none")
						.children(...columns),
				),
			)
	const accounts = model.accounts ?? []
	if (!result.hasData.billing) {
		const fresh = newAccounts(accounts, model.range, context.nowMs, LIFECYCLE_SHOWN)
		const quiet = quietAccounts(accounts, context.nowMs, LIFECYCLE_SHOWN)
		return panelOf([
			lifecycleColumn(h, {
				key: "new-accounts",
				title: "New accounts",
				summary: "First seen in this period",
				aside: moreLink(h, "View customers", listHref(context)),
				rows: fresh.map((account) =>
					listRow(h, context, {
						accountId: account.id,
						name: account.name,
						logoUrl: account.logoUrl,
						detail: account.domain ?? "",
						date: account.firstSeenAtMs,
						value: `${formatCount(account.activeUsers30d)} of ${formatCount(account.contactCount)}`,
					}),
				),
				empty: "No new accounts in this period.",
			}),
			lifecycleColumn(h, {
				key: "quiet",
				title: "Went quiet",
				summary: `No activity for ${QUIET_AFTER_DAYS}+ days after being active. Churn needs billing data.`,
				aside: moreLink(h, "Connect billing", href(context, "/settings/sources")),
				rows: quiet.map((account) =>
					listRow(h, context, {
						accountId: account.id,
						name: account.name,
						logoUrl: account.logoUrl,
						detail: `${formatCount(account.activeUsers30d)} active users`,
						date: account.lastActiveAtMs ?? context.nowMs,
						value: `${Math.floor((context.nowMs - (account.lastActiveAtMs ?? context.nowMs)) / 86_400_000)}d`,
						tone: "warning",
					}),
				),
				empty: "Nobody went quiet.",
			}),
		])
	}
	const brief = (entry: Customers.AccountBrief, value: string, tone?: ValueTone) =>
		listRow(h, context, {
			accountId: entry.accountId,
			name: entry.name,
			logoUrl: entry.logoUrl,
			detail: entry.planName ?? "",
			date: msOf(entry.at),
			value,
			tone,
		})
	const newMrr = result.recentNew.reduce((sum, entry) => sum + entry.mrrMinor, 0)
	const lostMrr = result.recentChurn.reduce((sum, entry) => sum + entry.mrrMinor, 0)
	const converted = result.newTrials.filter((trial) => isConverted(trial.status)).length
	return panelOf([
		lifecycleColumn(h, {
			key: "new-customers",
			title: "New customers",
			summary: `${accountsLabel(result.recentNew.length)} · ${formatMoney(newMrr, result.currency, { signed: true })} MRR`,
			aside: moreLink(h, "View paying", listHref(context, "paying")),
			rows: result.recentNew.map((entry) => brief(entry, formatMoney(entry.mrrMinor, result.currency))),
			empty: "No new paying customers.",
		}),
		lifecycleColumn(h, {
			key: "trials",
			title: "New trials",
			summary: `${accountsLabel(result.newTrials.length)} · ${formatCount(converted)} converted`,
			aside: moreLink(h, "View trials", listHref(context, "trialing")),
			rows: result.newTrials.map((trial) =>
				trial.status === "trialing"
					? brief(trial, formatMoney(trial.mrrMinor, result.currency))
					: isConverted(trial.status)
						? brief(trial, "Converted", "success")
						: brief(trial, "Ended", "muted"),
			),
			empty: "No trials started.",
		}),
		lifecycleColumn(h, {
			key: "churned",
			title: "Churned",
			summary: `${accountsLabel(result.recentChurn.length)}${lostMrr > 0 ? ` · ${formatMoney(-lostMrr, result.currency)} MRR` : ""}`,
			aside: moreLink(h, "View churned", listHref(context, "churned")),
			rows: result.recentChurn.map((entry) =>
				entry.mrrMinor > 0
					? brief(entry, formatMoney(-entry.mrrMinor, result.currency), "danger")
					: brief(entry, "—", "muted"),
			),
			empty: "Nobody churned.",
		}),
	])
}

// CHARTS

const bucketWord = (bucket: Result["bucket"]) =>
	bucket === "day" ? "Daily" : bucket === "week" ? "Weekly" : "Monthly"

const mrrCard = (h: H, result: Result) => {
	if (!result.hasData.billing)
		return panel(h, "mrr", [
			panelHeader(h, {
				title: "MRR movement",
				description: `New, expansion, contraction and churn by ${result.bucket}`,
			}),
			h.emptyState
				.title(connectBillingTitle())
				.description(
					"MRR movement needs subscription history. Hazel backfills 12 months once a billing source connects.",
				)
				.action(
					h.stack
						.axis("horizontal")
						.density("compact")
						.children(
							...billingPreferenceOrder.map(({ provider }) =>
								h.button
									.key(provider)
									.label(`Connect ${providerOf(provider).name}`)
									.variant(
										provider === suggestedBillingIntegration.id ? "primary" : "outline",
									)
									.size("small")
									.on("press", Message.PressedConnect({ provider })),
							),
						),
				),
		])
	const net = result.mrrMovements.reduce((sum, entry) => sum + entry.net, 0)
	const labels = result.mrrMovements.map((entry) => bucketLabels(result.bucket, entry.start))
	const hasReactivation = result.mrrMovements.some((entry) => entry.reactivation !== 0)
	const series: ReadonlyArray<Content.ChartSeries> = [
		{ key: "new", label: "New", tone: "new", values: result.mrrMovements.map((entry) => entry.new) },
		...(hasReactivation
			? [
					{
						key: "reactivation",
						label: "Reactivation",
						tone: "series2" as const,
						values: result.mrrMovements.map((entry) => entry.reactivation),
					},
				]
			: []),
		{
			key: "expansion",
			label: "Expansion",
			tone: "expansion",
			values: result.mrrMovements.map((entry) => entry.expansion),
		},
		{
			key: "contraction",
			label: "Contraction",
			tone: "contraction",
			values: result.mrrMovements.map((entry) => entry.contraction),
		},
		{
			key: "churn",
			label: "Churned",
			tone: "churn",
			values: result.mrrMovements.map((entry) => entry.churn),
		},
	]
	return panel(h, "mrr", [
		panelHeader(h, {
			title: "MRR movement",
			description: `${bucketWord(result.bucket)} change by type`,
			aside: h.stack
				.density("none")
				.align("end")
				.children(
					h.text
						.role("label")
						.strong()
						.numeric()
						.tone(net >= 0 ? "success" : "danger")
						.children(`${formatMoney(net, result.currency, { signed: true })} net`),
					result.mrrMovements.length === 0
						? null
						: h.text
								.role("caption")
								.tone("muted")
								.numeric()
								.children(
									`${formatMoney(result.kpis.mrrMinor.value - net, result.currency)} → ${formatMoney(result.kpis.mrrMinor.value, result.currency)}`,
								),
				),
		}),
		h.chart
			.kind("stackedBar")
			.label(
				`MRR movement by ${result.bucket}: net ${formatMoney(net, result.currency, { signed: true })} over ${result.mrrMovements.length} ${result.bucket}s`,
			)
			.legend()
			.net()
			.format("currency")
			.currency(result.currency)
			.series(series)
			.labels(labels.map((label) => label.tick))
			.headings(labels.map((label) => label.heading)),
	])
}

const activeUsersCard = (h: H, model: OverviewModel, result: Result) => {
	const last = result.activeUsers[result.activeUsers.length - 1]
	const labels = result.activeUsers.map((point) => bucketLabels(result.bucket, point.day))
	// HAZEL-GAP(pk1-series-key): today's three counts carry their series' colour as a left rule.
	const stat = (key: string, label: string, value: number, delta: Delta | null) =>
		h.stack
			.key(key)
			.density("none")
			.children(
				h.text.role("caption").tone("muted").children(label),
				h.stack
					.axis("horizontal")
					.density("compact")
					.align("center")
					.wrap()
					.children(
						h.text.role("label").strong().numeric().children(formatCount(value)),
						delta === null ? null : deltaText(h, delta),
					),
			)
	return panel(h, "active-users", [
		panelHeader(h, {
			title: "Active users",
			description: "Distinct contacts with a sign-in or product event",
		}),
		h.grid
			.columns("3")
			.density("cozy")
			.children(
				stat("mau", "MAU", result.kpis.mau.value, pctDelta(model, result.kpis.mau)),
				stat("wau", "WAU", result.kpis.wau.value, pctDelta(model, result.kpis.wau)),
				stat("dau", "DAU", last?.dau ?? 0, null),
			),
		h.chart
			.kind("line")
			.label("Active users")
			.series([
				{
					key: "mau",
					label: "MAU",
					tone: "series3",
					values: result.activeUsers.map((point) => point.mau),
				},
				{
					key: "wau",
					label: "WAU",
					tone: "series2",
					values: result.activeUsers.map((point) => point.wau),
				},
				{
					key: "dau",
					label: "DAU",
					tone: "series1",
					values: result.activeUsers.map((point) => point.dau),
				},
			])
			.labels(labels.map((label) => label.tick))
			.headings(labels.map((label) => label.heading)),
	])
}

const moversCard = (h: H, result: Result, context: Context) => {
	const column = (key: string, title: string, movers: ReadonlyArray<Customers.Mover>) =>
		h.stack
			.key(key)
			.density("compact")
			.children(
				h.heading.level("3").children(title),
				movers.length === 0
					? h.text.role("label").tone("muted").children("No big moves in this period.")
					: h.stack.density("none").children(
							...movers.map((mover) => {
								const account = context.accountsById.get(mover.accountId)
								return h.item
									.key(mover.accountId)
									.href(accountHref(context, mover.accountId))
									.title(mover.name)
									.subtitle(
										account === undefined
											? undefined
											: `${account.planName ?? "No plan"} · ${formatMoney(account.mrrMinor, account.currency)}/mo`,
									)
									.leading(
										companyLogo(h, {
											name: mover.name,
											logoUrl: mover.logoUrl,
											size: "sm",
										}),
									)
									.trailing(
										h.chart
											.kind("sparkline")
											.size("small")
											.label(`${mover.name}: active users`)
											.series([
												{
													key: "users",
													label: "Active users",
													tone: "series1",
													values: mover.series.map((point) => point.value),
												},
											]),
										h.text
											.role("caption")
											.tone("muted")
											.numeric()
											.children(
												`${formatMetricValue(mover.previousAvg, null)} → ${formatMetricValue(mover.currentAvg, null)}`,
											),
										deltaText(h, {
											value: mover.changePct,
											text: formatDeltaPct(mover.changePct),
										}),
									)
							}),
						),
			)
	return panel(h, "movers", [
		panelHeader(h, {
			title: "Top movers",
			description:
				result.range === "12m"
					? "Average daily active users, last 90 days vs the 90 before"
					: "Average daily active users, this period vs the previous one",
		}),
		h.grid
			.columns("2")
			.density("relaxed")
			.children(
				column("gains", "Biggest gains", result.topMovers.gainers),
				column("drops", "Biggest drops", result.topMovers.decliners),
			),
	])
}

/** The charts, folded: worth opening on a review, not on every visit. */
const trendsSection = (h: H, model: OverviewModel, result: Result, context: Context) =>
	h.disclosure
		.key("trends")
		.title("Charts and trends")
		.subtitle("MRR movement, active users, top movers")
		.open(model.trendsOpen)
		.on("toggle", ({ open }) => Message.ToggledTrends({ open }))
		.children(
			...(model.trendsOpen
				? [mrrCard(h, result), activeUsersCard(h, model, result), moversCard(h, result, context)]
				: []),
		)

// STATES

const setup = (h: H) =>
	h.stack
		.key("setup")
		.density("relaxed")
		.children(
			h.stack
				.density("snug")
				.children(
					h.heading.level("2").size("large").children("Connect a data source"),
					h.text
						.role("label")
						.tone("muted")
						.children(
							`Start with ${startingSource.name} for your customer list, then add billing and usage.`,
						),
				),
			// HAZEL-GAP(pk1-card-accent): today's starting source's card has the brand border.
			h.grid
				.columns("2")
				.density("regular")
				.children(
					...PROVIDER_ORDER.map((provider) =>
						connectCard(h, {
							provider,
							description: providerOf(provider).setupSummary,
							now: new Date(h.props.nowMs),
							status: { _tag: "NotConnected", onConnect: Message.PressedConnect({ provider }) },
						}).key(provider === startingIntegration.id ? `start:${provider}` : provider),
					),
				),
		)

const failure = (h: H, cause: Cause.Cause<CommonReason>) => {
	const copy = commonCopy(Option.getOrElse(Cause.findErrorOption(cause), (): CommonReason => "Unexpected"))
	return h.frame
		.key("failure")
		.children(
			h.emptyState
				.title(copy.title)
				.description(copy.description)
				.action(
					h.button
						.label("Try again")
						.icon("refresh")
						.variant("outline")
						.size("small")
						.on("press", Message.PressedRetry()),
				),
		)
}

const dashboard = (h: H, model: OverviewModel, context: Context): ReadonlyArray<Child | null> => {
	const result = h.queries.overview
	if (result._tag === "Failure") return [failure(h, result.cause)]
	const data = successOf(result)
	return [
		h.stack
			.key("numbers")
			.density("cozy")
			.children(headline(h, model, data, context), secondaryLine(h, model, data)),
		// HAZEL-GAP(pk1-dashboard-span): today the queue takes two of three columns, its side column one.
		h.grid
			.key("queue")
			.columns("2")
			.density("regular")
			.children(
				attentionSection(h, model, context),
				h.stack
					.density("regular")
					.children(
						data === undefined ? null : dropsCard(h, data, context),
						supportCard(h, context),
					),
			),
		suggestionsCard(h, model, context),
		...(data === undefined
			? [panel(h, "loading", [h.chart.kind("stackedBar").loading()])]
			: [lifecycleSection(h, model, data, context), trendsSection(h, model, data, context)]),
	]
}

export const overviewView = (h: H, model: OverviewModel) => {
	const { session, isMobile, nowMs } = h.props
	const accounts = model.accounts ?? []
	const context: Context = {
		session,
		nowMs,
		accountsById: new Map(accounts.map((account) => [account.id, account])),
		environmentCounts: environmentCounts(accounts),
	}
	const unconnected = isUnconnected(model)
	// On a phone the top bar names the section; with nothing connected the header holds no controls.
	return h.stack
		.key("customers-overview")
		.density("relaxed")
		.children(
			isMobile && unconnected ? null : header(h, model, successOf(h.queries.overview)),
			...(unconnected ? [setup(h)] : dashboard(h, model, context)),
		)
}
