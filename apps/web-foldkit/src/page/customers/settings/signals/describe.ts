import * as Customers from "@hazel/domain/customers"
import type { Html, HtmlBuilder } from "foldkit/html"
import { formatMoney } from "../../../../customers/format"
import { STAGE_LABEL } from "../../../../customers/ui/badges"
import {
	IconChartBar,
	IconCirclePause,
	IconClock,
	IconHeart,
	IconLoader,
	IconPresentationChart,
	IconRocket,
	IconStar,
	IconUsers,
	IconWarning,
	type IconOptions,
} from "../../../../icons"
import type { ConfigForm, ConfigValue } from "./model"

/**
 * Rules in words: each template's icon and picker blurb, a rule's condition ("No activity for 14
 * days, after at least 1 active user in the prior 30 days"), its scope ("Active · $100+ MRR") and the
 * editor's "In plain words" paragraph. Built from the config, not `TEMPLATES[t].description`.
 */

type Icon = <M>(h: HtmlBuilder<M>, options?: IconOptions) => Html

export const TEMPLATE_ICON = {
	inactive: IconClock,
	usage_drop: IconPresentationChart,
	payment_failed: IconWarning,
	cancel_scheduled: IconCirclePause,
	trial_ending_low_activation: IconRocket,
	onboarding_stalled: IconLoader,
	health_drop: IconHeart,
	champion_inactive: IconStar,
	near_limit: IconChartBar,
	seat_growth: IconUsers,
} as const satisfies Record<Customers.SignalTemplate, Icon>

/** The picker card's one-liner. */
export const TEMPLATE_BLURB = {
	inactive: "No activity for a number of days after the account was active",
	usage_drop: "A daily metric falls a set percentage below its recent baseline",
	payment_failed: "Subscription past due or unpaid, or an invoice left open too long",
	cancel_scheduled: "Set to cancel at period end, or moved to a cheaper plan",
	trial_ending_low_activation: "Trial ends soon and only a few people are using the product",
	onboarding_stalled: "A new account where hardly anyone has become active yet",
	health_drop: "Health score fell sharply, or entered Critical",
	champion_inactive: "The account's most active person stops showing up",
	near_limit: "A metered feature is close to the plan's limit",
	seat_growth: "Active users growing fast: a good moment to talk expansion",
} as const satisfies Record<Customers.SignalTemplate, string>

/** A sentence in pieces: `Bold` pieces are the values a reader scans for. */
export type Part = string | Readonly<{ bold: string }>

const bold = (text: string): Part => ({ bold: text })

export const plainText = (parts: ReadonlyArray<Part>): string =>
	parts.map((part) => (typeof part === "string" ? part : part.bold)).join("")

export const renderParts = <M>(h: HtmlBuilder<M>, parts: ReadonlyArray<Part>): ReadonlyArray<Html | string> =>
	parts.map((part) =>
		typeof part === "string" ? part : h.strong([h.Class("font-semibold text-fg")], [part.bold]),
	)

const text = (value: ConfigValue | undefined): string => (typeof value === "string" ? value.trim() : "")
const isOn = (value: ConfigValue | undefined): boolean => value === true
const list = (value: ConfigValue | undefined): ReadonlyArray<string> => (Array.isArray(value) ? value : [])

/** `1 user`, `3 users`; the typed text as is when it is not a number. */
const counted = (value: ConfigValue | undefined, word: string): string => {
	const typed = text(value)
	return `${typed} ${typed === "1" ? word : `${word}s`}`
}

const orList = (items: ReadonlyArray<string>): string =>
	items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} or ${items.at(-1)}`

/** What the rule looks for, from the config (typed values while editing). */
export const conditionParts = (
	template: Customers.SignalTemplate,
	config: ConfigForm,
	metricName: (key: string) => string,
): ReadonlyArray<Part> => {
	const v = (key: string) => text(config[key])
	switch (template) {
		case "inactive":
			return [
				"No activity for ",
				bold(counted(config.inactiveDays, "day")),
				", after at least ",
				bold(counted(config.minPriorActiveUsers, "active user")),
				" in the prior ",
				bold(counted(config.priorWindowDays, "day")),
			]
		case "usage_drop":
			return [
				bold(metricName(v("metricKey"))),
				`, ${v("recentDays")}-day average down `,
				bold(`${v("dropPct")}%`),
				" or more vs the previous ",
				bold(counted(config.baselineDays, "day")),
			]
		case "payment_failed":
			return [
				"Subscription past due or unpaid, or an invoice open more than ",
				bold(counted(config.overdueDays, "day")),
				" past due",
			]
		case "cancel_scheduled":
			return isOn(config.includeDowngrades)
				? [
						"Set to cancel at period end, or downgraded in the last ",
						bold(counted(config.downgradeWindowDays, "day")),
					]
				: ["Set to cancel at period end"]
		case "trial_ending_low_activation":
			return [
				"Trial ends within ",
				bold(counted(config.daysBeforeEnd, "day")),
				" and fewer than ",
				bold(counted(config.minActiveUsers, "active user")),
				" in the last ",
				bold(counted(config.activeWindowDays, "day")),
			]
		case "onboarding_stalled":
			return [
				"First seen ",
				bold(`${v("minAgeDays")}–${v("maxAgeDays")} days`),
				" ago and fewer than ",
				bold(counted(config.minActiveContacts, "contact")),
				" ever active",
			]
		case "health_drop":
			return [
				"Health fell ",
				bold(`${v("dropPoints")} points`),
				" or more in ",
				bold(counted(config.windowDays, "day")),
				...(isOn(config.onCritical) ? [", or turned ", bold("Critical")] : []),
			]
		case "champion_inactive":
			return [
				"The most active user of the last ",
				bold(counted(config.windowDays, "day")),
				" inactive for ",
				bold(counted(config.inactiveDays, "day")),
			]
		case "near_limit": {
			const keys = list(config.metricKeys)
			return [
				keys.length === 0 ? "A metered feature" : bold(orList(keys.map(metricName))),
				" at ",
				bold(`${v("thresholdPct")}%`),
				" or more of its plan limit",
			]
		}
		case "seat_growth":
			return [
				"Active users up ",
				bold(`${v("growthPct")}%`),
				" or more in ",
				bold(counted(config.windowDays, "day")),
				", from at least ",
				bold(v("minActiveUsers")),
			]
	}
}

/** The list's "Applies to": `Active · $100+ MRR`, `Paying customers`, `All accounts`. */
export const scopeSummary = (scope: Customers.RuleScope, currency: string): string => {
	const parts = [
		...(scope.payingOnly === true ? ["Paying customers"] : []),
		...(scope.lifecycleStages === undefined || scope.lifecycleStages.length === 0
			? []
			: [scope.lifecycleStages.map((stage) => STAGE_LABEL[stage]).join(", ")]),
		...(scope.planNames === undefined || scope.planNames.length === 0
			? []
			: [`${scope.planNames.join(", ")} ${scope.planNames.length === 1 ? "plan" : "plans"}`]),
		...(scope.minMrrMinor === undefined ? [] : [`${formatMoney(scope.minMrrMinor, currency)}+ MRR`]),
		...(scope.tagsAny === undefined || scope.tagsAny.length === 0
			? []
			: [`Tagged ${scope.tagsAny.join(", ")}`]),
	]
	return parts.length === 0 ? "All accounts" : parts.join(" · ")
}

const andList = (items: ReadonlyArray<string>): string =>
	items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`

/** `active and past-due paying customers on Growth or Scale with MRR of $100 or more`. */
const scopeParts = (scope: Customers.RuleScope, currency: string): ReadonlyArray<Part> => {
	const stages = scope.lifecycleStages ?? []
	const plans = scope.planNames ?? []
	const tags = scope.tagsAny ?? []
	return [
		...(stages.length === 0
			? []
			: [bold(andList(stages.map((stage) => STAGE_LABEL[stage].toLowerCase()))), " "]),
		scope.payingOnly === true
			? bold("paying customers")
			: stages.length === 0
				? bold("all accounts")
				: "accounts",
		...(plans.length === 0 ? [] : [" on ", bold(orList(plans))]),
		...(scope.minMrrMinor === undefined
			? []
			: [" with MRR of ", bold(formatMoney(scope.minMrrMinor, currency)), " or more"]),
		...(tags.length === 0 ? [] : [" tagged ", bold(orList(tags))]),
	]
}

const lowerFirst = (parts: ReadonlyArray<Part>): ReadonlyArray<Part> => {
	const [first, ...rest] = parts
	if (first === undefined) return parts
	const lower = (value: string) => value.charAt(0).toLowerCase() + value.slice(1)
	return [typeof first === "string" ? lower(first) : bold(lower(first.bold)), ...rest]
}

/** The editor's "In plain words": who, when, and what a match does. */
export const plainWords = (
	options: Readonly<{
		template: Customers.SignalTemplate
		config: ConfigForm
		scope: Customers.RuleScope
		severity: Customers.SignalSeverity
		currency: string
		metricName: (key: string) => string
	}>,
): ReadonlyArray<Part> => [
	"Flag ",
	...scopeParts(options.scope, options.currency),
	" when: ",
	...lowerFirst(conditionParts(options.template, options.config, options.metricName)),
	". Each match opens a ",
	bold(`${options.severity}-severity ${Customers.TEMPLATES[options.template].kind}`),
	" item in Needs attention.",
]
