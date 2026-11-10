/**
 * Signal evaluation (`docs/customers/tech-design.md` §4.4), pure: one rule against one account's
 * facts. Compute, the rule dry run and the tests share it.
 *
 * A match carries its evidence (drawn by the UI per `_tag`) and `step`, how far past the threshold
 * it is: the signal's severity is the rule's raised by `step` (the rule's is the floor), and "worse
 * by a full step" compares steps. A non-match says why, for the dry run's histogram.
 */
import {
	type CustomerProvider,
	escalate,
	type EvidenceStep,
	type RuleConfig,
	type RuleScope,
	type SignalEvidence,
	type SignalSeverity,
	type SignalTemplate,
	TEMPLATES,
} from "@hazel/domain/customers"
import {
	type AccountFacts,
	activeUsersIn,
	DERIVED_METRICS,
	formatMoney,
	mrrSeries,
	type OrgFacts,
	rollingActiveSeries,
	seriesOf,
} from "./facts"
import { addDays, DAY_MS, daysBetween, daysSince } from "./time"

/** The parts of a rule evaluation reads. */
export interface RuleInput {
	readonly name: string
	readonly template: SignalTemplate
	readonly severity: SignalSeverity
	readonly config: RuleConfig
	readonly scope: RuleScope
}

export type NonMatchReason =
	| "Churned"
	| "Out of scope"
	| "Missing data source"
	| "No data"
	| "Below threshold"

export interface Match {
	readonly _tag: "Match"
	readonly severity: SignalSeverity
	readonly title: string
	readonly reason: string
	readonly evidence: SignalEvidence
}

export type Evaluation = Match | { readonly _tag: "NoMatch"; readonly reason: NonMatchReason }

const noMatch = (reason: NonMatchReason): Evaluation => ({ _tag: "NoMatch", reason })

const stepOf = (two: boolean, one: boolean): EvidenceStep => (two ? 2 : one ? 1 : 0)

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`

const iso = (date: Date | null) => (date === null ? null : date.toISOString())

const average = (values: ReadonlyArray<number>) =>
	values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length

const round1 = (value: number) => Math.round(value * 10) / 10

/** Whether the rule's scope covers the account. */
export const inScope = (scope: RuleScope, facts: AccountFacts): boolean => {
	const { account } = facts
	if (scope.payingOnly === true && account.mrrMinor <= 0 && facts.stage !== "trialing") return false
	if (
		scope.lifecycleStages !== undefined &&
		scope.lifecycleStages.length > 0 &&
		!scope.lifecycleStages.includes(facts.stage)
	) {
		return false
	}
	if (
		scope.planNames !== undefined &&
		scope.planNames.length > 0 &&
		(account.planName === null || !scope.planNames.includes(account.planName))
	) {
		return false
	}
	if (scope.minMrrMinor !== undefined && account.mrrMinor < scope.minMrrMinor) return false
	if (
		scope.tagsAny !== undefined &&
		scope.tagsAny.length > 0 &&
		!scope.tagsAny.some((tag) => account.tags.includes(tag))
	) {
		return false
	}
	return true
}

type Found = { readonly step: EvidenceStep; readonly reason: string; readonly evidence: SignalEvidence }
type Check = (facts: AccountFacts, org: OrgFacts) => Found | NonMatchReason

const inactive =
	(config: Extract<RuleConfig, { _tag: "inactive" }>): Check =>
	(facts, org) => {
		if (facts.lastActiveDay === null) return "No data"
		const days = daysBetween(facts.lastActiveDay, org.today)
		if (days < config.inactiveDays) return "Below threshold"
		const prior = facts.priorActive.get(config.priorWindowDays) ?? 0
		if (prior < config.minPriorActiveUsers) return "Below threshold"
		const step = stepOf(days >= config.inactiveDays * 4, days >= config.inactiveDays * 2)
		return {
			step,
			reason: `No activity for ${plural(days, "day")}; ${plural(prior, "active user")} before`,
			evidence: {
				_tag: "last_active",
				step,
				lastActiveAt: iso(facts.account.lastActiveAt),
				daysInactive: days,
				priorActiveUsers: prior,
				contactId: null,
				contactName: null,
				contactEmail: null,
			},
		}
	}

const usageDrop =
	(config: Extract<RuleConfig, { _tag: "usage_drop" }>): Check =>
	(facts, org) => {
		// Today is still filling in: the windows end yesterday.
		const last = addDays(org.today, -1)
		const days = config.recentDays + config.baselineDays
		if (!DERIVED_METRICS.has(config.metricKey) && !facts.metrics.has(config.metricKey)) return "No data"
		const series = seriesOf(
			facts,
			config.metricKey,
			last,
			days,
			org.metricAggregations.get(config.metricKey),
		)
		const baselineAvg = average(series.slice(0, config.baselineDays).map((point) => point.value))
		const recentAvg = average(series.slice(config.baselineDays).map((point) => point.value))
		if (baselineAvg <= 0)
			return series.every((point) => point.value === 0) ? "No data" : "Below threshold"
		const changePct = ((recentAvg - baselineAvg) / baselineAvg) * 100
		if (changePct > -config.dropPct) return "Below threshold"
		const drop = -changePct
		const step = stepOf(
			drop >= Math.max(75, config.dropPct + 45),
			drop >= Math.max(50, config.dropPct + 20),
		)
		const name = org.metricNames.get(config.metricKey) ?? config.metricKey
		return {
			step,
			reason: `${name} down ${Math.round(drop)}% (${round1(recentAvg)}/day over ${plural(config.recentDays, "day")} vs ${round1(baselineAvg)} before)`,
			evidence: {
				_tag: "series",
				step,
				metricKey: config.metricKey,
				recentAvg: round1(recentAvg),
				baselineAvg: round1(baselineAvg),
				changePct: round1(changePct),
				recentDays: config.recentDays,
				baselineDays: config.baselineDays,
				series,
			},
		}
	}

const paymentFailed =
	(config: Extract<RuleConfig, { _tag: "payment_failed" }>): Check =>
	(facts, org) => {
		const pastDue = facts.subscriptions.filter(
			(sub) => sub.status === "past_due" || sub.status === "unpaid",
		)
		const overdue = facts.openInvoices
			.flatMap((invoice) =>
				invoice.dueAt !== null && invoice.dueAt.getTime() < org.now.getTime()
					? [{ ...invoice, dueAt: invoice.dueAt }]
					: [],
			)
			.sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())
		const oldest = overdue[0]
		const daysOverdue = oldest === undefined ? 0 : daysSince(oldest.dueAt, org.now)
		const invoiceLate = oldest !== undefined && daysOverdue > config.overdueDays
		if (pastDue.length === 0 && !invoiceLate) {
			return facts.subscriptions.length === 0 && facts.openInvoices.length === 0
				? "No data"
				: "Below threshold"
		}
		const unpaid = pastDue.some((sub) => sub.status === "unpaid")
		const step = stepOf(unpaid || daysOverdue >= 30, daysOverdue >= 14)
		const owed = overdue.reduce(
			(sum, invoice) => sum + invoice.amountDueMinor - invoice.amountPaidMinor,
			0,
		)
		const currency = oldest?.currency ?? pastDue[0]?.currency ?? org.currency
		const amountMinor = owed > 0 ? owed : pastDue.reduce((sum, sub) => sum + sub.mrrMinor, 0)
		const status = pastDue[0]?.status ?? null
		const decline = oldest?.declineReason ? ` (${oldest.declineReason.replaceAll("_", " ")})` : ""
		return {
			step,
			reason:
				daysOverdue > 0
					? `${formatMoney(amountMinor, currency)} unpaid, ${plural(daysOverdue, "day")} overdue${decline}`
					: `Subscription ${status === "unpaid" ? "unpaid" : "past due"}: ${formatMoney(amountMinor, currency)}${decline}`,
			evidence: {
				_tag: "amount",
				step,
				amountMinor,
				currency,
				invoiceId: oldest?.id ?? null,
				invoiceNumber: oldest?.number ?? null,
				subscriptionStatus: status,
				dueAt: iso(oldest?.dueAt ?? null),
				daysOverdue,
				attemptCount: oldest?.attemptCount ?? null,
				declineReason: oldest?.declineReason ?? null,
				nextRetryAt: iso(oldest?.nextRetryAt ?? null),
			},
		}
	}

const cancelScheduled =
	(config: Extract<RuleConfig, { _tag: "cancel_scheduled" }>): Check =>
	(facts, org) => {
		const series = mrrSeries(facts.movements, facts.account.mrrMinor, org.today, 30)
		const canceling = facts.subscriptions
			.filter((sub) => sub.status !== "canceled" && sub.cancelAtPeriodEnd)
			.sort((a, b) => b.mrrMinor - a.mrrMinor)[0]
		if (canceling !== undefined) {
			const from = facts.account.mrrMinor
			const to = Math.max(0, from - canceling.mrrMinor)
			const effective = canceling.currentPeriodEnd
			const daysLeft =
				effective === null
					? null
					: Math.max(0, Math.ceil((effective.getTime() - org.now.getTime()) / DAY_MS))
			const step = stepOf(false, daysLeft !== null && daysLeft <= 7)
			return {
				step,
				reason: `${canceling.planName ?? "Subscription"} (${formatMoney(canceling.mrrMinor, canceling.currency)}/mo) cancels ${daysLeft === null ? "at period end" : daysLeft === 0 ? "today" : `in ${plural(daysLeft, "day")}`}`,
				evidence: {
					_tag: "delta",
					step,
					unit: "minor",
					from,
					to,
					changePct: from === 0 ? null : round1(((to - from) / from) * 100),
					currency: canceling.currency,
					effectiveAt: iso(effective),
					fromLabel: canceling.planName,
					toLabel: "Canceled",
					reason: canceling.cancellationReason,
					series,
				},
			}
		}
		if (!config.includeDowngrades) return facts.subscriptions.length === 0 ? "No data" : "Below threshold"
		const since = addDays(org.today, -config.downgradeWindowDays)
		const downgrade = [...facts.movements]
			.reverse()
			.find((movement) => movement.type === "contraction" && movement.day > since)
		if (downgrade === undefined) return facts.subscriptions.length === 0 ? "No data" : "Below threshold"
		return {
			step: 0,
			reason: `MRR down from ${formatMoney(downgrade.fromMrrMinor, downgrade.currency)} to ${formatMoney(downgrade.toMrrMinor, downgrade.currency)} on ${downgrade.day}`,
			evidence: {
				_tag: "delta",
				step: 0,
				unit: "minor",
				from: downgrade.fromMrrMinor,
				to: downgrade.toMrrMinor,
				changePct:
					downgrade.fromMrrMinor === 0
						? null
						: round1(
								((downgrade.toMrrMinor - downgrade.fromMrrMinor) / downgrade.fromMrrMinor) *
									100,
							),
				currency: downgrade.currency,
				effectiveAt: new Date(`${downgrade.day}T00:00:00.000Z`).toISOString(),
				fromLabel: null,
				toLabel: facts.account.planName,
				reason: "Downgraded",
				series,
			},
		}
	}

const trialEnding =
	(config: Extract<RuleConfig, { _tag: "trial_ending_low_activation" }>): Check =>
	(facts, org) => {
		const end = facts.account.trialEndsAt
		if (end === null || facts.stage !== "trialing") return "Below threshold"
		const msLeft = end.getTime() - org.now.getTime()
		if (msLeft < 0) return "Below threshold"
		const daysLeft = Math.ceil(msLeft / DAY_MS)
		if (daysLeft > config.daysBeforeEnd) return "Below threshold"
		const active = activeUsersIn(facts, addDays(org.today, -(config.activeWindowDays - 1)), org.today)
		if (active >= config.minActiveUsers) return "Below threshold"
		const step = stepOf(active === 0, daysLeft <= 2)
		return {
			step,
			reason: `Trial ends in ${plural(daysLeft, "day")}; ${plural(active, "active user")} in the last ${plural(config.activeWindowDays, "day")}`,
			evidence: {
				_tag: "ratio",
				step,
				value: active,
				target: config.minActiveUsers,
				unit: "users",
				deadline: end.toISOString(),
				daysLeft,
				ageDays: null,
			},
		}
	}

const onboardingStalled =
	(config: Extract<RuleConfig, { _tag: "onboarding_stalled" }>): Check =>
	(facts, org) => {
		const ageDays = daysSince(facts.account.firstSeenAt, org.now)
		if (ageDays < config.minAgeDays || ageDays > config.maxAgeDays) return "Below threshold"
		const active = facts.everActiveContacts
		if (active >= config.minActiveContacts) return "Below threshold"
		const step = stepOf(active === 0, ageDays >= 21)
		return {
			step,
			reason: `${plural(ageDays, "day")} in, ${plural(active, "contact")} ever active of ${facts.contacts.length}`,
			evidence: {
				_tag: "ratio",
				step,
				value: active,
				target: config.minActiveContacts,
				unit: "contacts",
				deadline: null,
				daysLeft: null,
				ageDays,
			},
		}
	}

const healthDrop =
	(config: Extract<RuleConfig, { _tag: "health_drop" }>): Check =>
	(facts, org) => {
		const today = facts.health.find((point) => point.day === org.today)
		if (today === undefined || today.score === null) return "No data"
		const since = addDays(org.today, -config.windowDays)
		const before = facts.health.flatMap((point) =>
			point.day >= since && point.day < org.today && point.score !== null ? [point.score] : [],
		)
		const peak = before.reduce((max, score) => Math.max(max, score), today.score)
		const drop = peak - today.score
		// Entered critical: a scored, non-critical day in the window before (a new account first
		// scored critical has not "entered" it).
		const critical =
			config.onCritical &&
			today.status === "critical" &&
			facts.health.some(
				(point) =>
					point.day >= since &&
					point.day < org.today &&
					point.status !== "critical" &&
					point.status !== "unknown",
			)
		if (drop < config.dropPoints && !critical) return "Below threshold"
		const step = stepOf(drop >= 50, drop >= 35)
		const series = facts.health
			.filter((point) => point.day >= addDays(org.today, -29))
			.map((point) => ({ day: point.day, value: point.score ?? 0 }))
		return {
			step,
			reason:
				drop > 0
					? `Health fell ${drop} points in ${plural(config.windowDays, "day")} (${peak} → ${today.score})${critical ? ", now critical" : ""}`
					: `Health is critical (${today.score})`,
			evidence: {
				_tag: "delta",
				step,
				unit: "points",
				from: peak,
				to: today.score,
				changePct: peak === 0 ? null : round1(((today.score - peak) / peak) * 100),
				currency: null,
				effectiveAt: null,
				fromLabel: null,
				toLabel: today.status,
				reason: null,
				series,
			},
		}
	}

const championInactive =
	(config: Extract<RuleConfig, { _tag: "champion_inactive" }>): Check =>
	(facts, org) => {
		// The champion of the window before the quiet period: most active days, then most events.
		const to = addDays(org.today, -config.inactiveDays)
		const from = addDays(to, -(config.windowDays - 1))
		const totals = new Map<string, { days: number; events: number }>()
		for (const [day, contacts] of facts.activity) {
			if (day < from || day > to) continue
			for (const [contact, events] of contacts) {
				const total = totals.get(contact) ?? { days: 0, events: 0 }
				totals.set(contact, { days: total.days + 1, events: total.events + events })
			}
		}
		const [championId] = [...totals.entries()].sort(
			([, a], [, b]) => b.days - a.days || b.events - a.events,
		)[0] ?? [undefined]
		const champion = facts.contacts.find((contact) => contact.id === championId)
		if (champion === undefined || champion.lastActiveDay === null) return "No data"
		const days = daysBetween(champion.lastActiveDay, org.today)
		if (days < config.inactiveDays) return "Below threshold"
		const step = stepOf(days >= config.inactiveDays * 4, days >= config.inactiveDays * 2)
		const who = champion.name ?? champion.email ?? "The most active user"
		return {
			step,
			reason: `${who}, the most active user, inactive for ${plural(days, "day")}`,
			evidence: {
				_tag: "last_active",
				step,
				lastActiveAt: new Date(`${champion.lastActiveDay}T00:00:00.000Z`).toISOString(),
				daysInactive: days,
				priorActiveUsers: totals.size,
				contactId: champion.id,
				contactName: champion.name,
				contactEmail: champion.email,
			},
		}
	}

const nearLimit =
	(config: Extract<RuleConfig, { _tag: "near_limit" }>): Check =>
	(facts, org) => {
		const recent = addDays(org.today, -2)
		const candidates = [...facts.metrics.entries()]
			.filter(([key]) => config.metricKeys.length === 0 || config.metricKeys.includes(key))
			.flatMap(([key, points]) => {
				const latest = [...points]
					.reverse()
					.find((point) => point.day >= recent && (point.limitValue ?? 0) > 0)
				const limit = latest?.limitValue ?? null
				return latest === undefined || limit === null
					? []
					: [{ key, value: latest.value, limit, pct: (latest.value / limit) * 100 }]
			})
			.sort((a, b) => b.pct - a.pct)
		const top = candidates[0]
		if (top === undefined) return "No data"
		if (top.pct < config.thresholdPct) return "Below threshold"
		const step = stepOf(top.pct >= 120, top.pct >= 100)
		const name = org.metricNames.get(top.key) ?? top.key
		return {
			step,
			reason: `${name} at ${Math.round(top.pct)}% of the plan limit (${round1(top.value)} of ${round1(top.limit)})`,
			evidence: {
				_tag: "limit",
				step,
				metricKey: top.key,
				metricName: name,
				value: top.value,
				limit: top.limit,
				pct: round1(top.pct),
			},
		}
	}

const seatGrowth =
	(config: Extract<RuleConfig, { _tag: "seat_growth" }>): Check =>
	(facts, org) => {
		const now = activeUsersIn(facts, addDays(org.today, -(config.windowDays - 1)), org.today)
		const before = activeUsersIn(
			facts,
			addDays(org.today, -(2 * config.windowDays - 1)),
			addDays(org.today, -config.windowDays),
		)
		if (before < config.minActiveUsers) return before === 0 && now === 0 ? "No data" : "Below threshold"
		const growth = ((now - before) / before) * 100
		if (growth < config.growthPct) return "Below threshold"
		const step = stepOf(growth >= 200, growth >= 100)
		return {
			step,
			reason: `Active users up ${Math.round(growth)}% (${before} → ${now}) over ${plural(config.windowDays, "day")}`,
			evidence: {
				_tag: "delta",
				step,
				unit: "users",
				from: before,
				to: now,
				changePct: round1(growth),
				currency: null,
				effectiveAt: null,
				fromLabel: null,
				toLabel: null,
				reason: null,
				series: rollingActiveSeries(facts, org.today, config.windowDays),
			},
		}
	}

const checkOf = (config: RuleConfig): Check => {
	switch (config._tag) {
		case "inactive":
			return inactive(config)
		case "usage_drop":
			return usageDrop(config)
		case "payment_failed":
			return paymentFailed(config)
		case "cancel_scheduled":
			return cancelScheduled(config)
		case "trial_ending_low_activation":
			return trialEnding(config)
		case "onboarding_stalled":
			return onboardingStalled(config)
		case "health_drop":
			return healthDrop(config)
		case "champion_inactive":
			return championInactive(config)
		case "near_limit":
			return nearLimit(config)
		case "seat_growth":
			return seatGrowth(config)
	}
}

/** The template needs one of its sources connected. */
export const missingSources = (template: SignalTemplate, org: OrgFacts): ReadonlyArray<CustomerProvider> => {
	const required = TEMPLATES[template].requiredSources
	return required.length === 0 || required.some((provider) => org.connected.has(provider)) ? [] : required
}

export const evaluate = (rule: RuleInput, facts: AccountFacts, org: OrgFacts): Evaluation => {
	if (facts.stage === "churned") return noMatch("Churned")
	if (!inScope(rule.scope, facts)) return noMatch("Out of scope")
	if (missingSources(rule.template, org).length > 0) return noMatch("Missing data source")
	const found = checkOf(rule.config)(facts, org)
	if (typeof found === "string") return noMatch(found)
	return {
		_tag: "Match",
		severity: escalate(rule.severity, found.step),
		title: rule.name,
		reason: found.reason,
		evidence: found.evidence,
	}
}

/** The days of activity an evaluation of `rules` looks back over. */
export const activityWindowDays = (rules: ReadonlyArray<RuleInput>) =>
	Math.min(
		400,
		Math.max(
			62,
			...rules.map((rule) => {
				const config = rule.config
				switch (config._tag) {
					case "usage_drop":
						return config.recentDays + config.baselineDays + 31
					case "champion_inactive":
						return config.windowDays + config.inactiveDays + 1
					case "seat_growth":
						return 2 * config.windowDays + 1
					case "trial_ending_low_activation":
						return config.activeWindowDays + 1
					default:
						return 0
				}
			}),
		),
	)
