import * as Customers from "@hazel/domain/customers"
import type {
	AccountOption,
	DurationForm,
	DurationUnit,
	HoursForm,
	PolicyForm,
	PolicyRow,
	SlaClock,
	TargetsForm,
} from "./model"
import { CLOCKS, PRIORITIES } from "./model"

/** The SLA page's pure parts: forms to drafts, validation, and the words the list and editor show. */

const MINUTE_MS = 60_000
const UNIT_MINUTES = { minutes: 1, hours: 60, days: 24 * 60 } as const satisfies Record<DurationUnit, number>
const MAX_MINUTES = 60 * 24 * 90

// DURATIONS

/** `45m`, `4h`, `2h 30m`, `40h`: plain hours and minutes. */
export const formatMinutes = (minutes: number): string => {
	const hours = Math.floor(minutes / 60)
	const rest = minutes % 60
	if (hours === 0) return `${rest}m`
	return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`
}

/** Days only on 24/7 (a business-hours "day" would read as a calendar day); else hours, else minutes. */
export const durationFormOf = (minutes: number, hours: Customers.SlaHours): DurationForm =>
	hours === "always" && minutes % UNIT_MINUTES.days === 0
		? { amount: String(minutes / UNIT_MINUTES.days), unit: "days" }
		: minutes % 60 === 0
			? { amount: String(minutes / 60), unit: "hours" }
			: { amount: String(minutes), unit: "minutes" }

/** The minutes typed (rounded; check `durationError` first). */
export const minutesOf = (form: DurationForm): number =>
	Math.round(Number(form.amount.trim()) * UNIT_MINUTES[form.unit])

/** Why the typed target cannot be saved, if it cannot. */
export const durationError = (form: DurationForm): string | undefined => {
	const text = form.amount.trim()
	if (text === "") return "Required"
	const amount = Number(text)
	if (!Number.isFinite(amount) || amount <= 0) return "Above 0"
	const minutes = amount * UNIT_MINUTES[form.unit]
	if (!Number.isInteger(minutes)) return "Whole minutes"
	return minutes > MAX_MINUTES ? "At most 90 days" : undefined
}

/** Business hours have no "day" unit (24 working hours reads as one calendar day): day targets become hours. */
export const withoutDays = (targets: TargetsForm): TargetsForm => {
	const of = (form: DurationForm): DurationForm =>
		form.unit === "days" && durationError(form) === undefined
			? { amount: String(minutesOf(form) / 60), unit: "hours" }
			: form.unit === "days"
				? { ...form, unit: "hours" }
				: form
	const row = (priority: Customers.SlaPriority) => ({
		firstResponse: of(targets[priority].firstResponse),
		resolution: of(targets[priority].resolution),
	})
	return { urgent: row("urgent"), high: row("high"), normal: row("normal"), low: row("low") }
}

// FORMS

export const targetsFormOf = (targets: Customers.SlaTargets, hours: Customers.SlaHours): TargetsForm => {
	const of = (priority: Customers.SlaPriority) => ({
		firstResponse: durationFormOf(targets[priority].firstResponseMinutes, hours),
		resolution: durationFormOf(targets[priority].resolutionMinutes, hours),
	})
	return { urgent: of("urgent"), high: of("high"), normal: of("normal"), low: of("low") }
}

export const formOfPolicy = (policy: PolicyRow | Customers.SlaPolicyDraft): PolicyForm => ({
	name: policy.name,
	enabled: policy.enabled,
	hours: policy.hours,
	warnBeforePct: policy.warnBeforePct,
	planNames: policy.appliesTo.planNames,
	tags: policy.appliesTo.tagsAny,
	tagInput: "",
	accountIds: policy.appliesTo.accountIds,
	accountSearch: "",
	targets: targetsFormOf(policy.targets, policy.hours),
})

/** A new policy starts from the default's targets, named and scoped by the admin. */
export const newPolicyForm = (): PolicyForm => ({ ...formOfPolicy(Customers.DEFAULT_SLA_POLICY), name: "" })

export const draftOfRow = (policy: PolicyRow): Customers.SlaPolicyDraft => ({
	name: policy.name,
	enabled: policy.enabled,
	appliesTo: policy.appliesTo,
	targets: policy.targets,
	hours: policy.hours,
	warnBeforePct: policy.warnBeforePct,
})

export type TargetErrors = Partial<Record<`${Customers.SlaPriority}.${SlaClock}`, string>>

export interface PolicyErrors {
	readonly name: string | undefined
	readonly targets: TargetErrors
}

export const policyErrors = (form: PolicyForm): PolicyErrors => {
	const targets: TargetErrors = {}
	for (const priority of PRIORITIES)
		for (const clock of CLOCKS) {
			const error = durationError(form.targets[priority][clock])
			if (error !== undefined) targets[`${priority}.${clock}`] = error
		}
	const name = form.name.trim()
	return {
		name: name === "" ? "Name the policy" : name.length > 120 ? "At most 120 characters" : undefined,
		targets,
	}
}

export const hasErrors = (errors: PolicyErrors): boolean =>
	errors.name !== undefined || Object.keys(errors.targets).length > 0

/** The draft to save; undefined while the form has errors. */
export const draftOfForm = (form: PolicyForm): Customers.SlaPolicyDraft | undefined => {
	if (hasErrors(policyErrors(form))) return undefined
	const target = (priority: Customers.SlaPriority): Customers.SlaTarget => ({
		firstResponseMinutes: minutesOf(form.targets[priority].firstResponse),
		resolutionMinutes: minutesOf(form.targets[priority].resolution),
	})
	return {
		name: form.name.trim(),
		enabled: form.enabled,
		appliesTo: { accountIds: form.accountIds, planNames: form.planNames, tagsAny: form.tags },
		targets: {
			urgent: target("urgent"),
			high: target("high"),
			normal: target("normal"),
			low: target("low"),
		},
		hours: form.hours,
		warnBeforePct: form.warnBeforePct,
	}
}

// BUSINESS HOURS

const CLOCK_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/

export interface HoursErrors {
	readonly days: string | undefined
	readonly time: string | undefined
}

const timeError = (form: HoursForm): string | undefined => {
	if (!CLOCK_PATTERN.test(form.start) || !CLOCK_PATTERN.test(form.end)) return "Enter times as HH:MM"
	return form.start < form.end ? undefined : "Hours must end after they start"
}

/** The schema's rules (`BusinessHours`), as inline errors. */
export const hoursErrors = (form: HoursForm): HoursErrors => ({
	days: form.days.length === 0 ? "Pick at least one working day" : undefined,
	time: timeError(form),
})

/** The hours to save; undefined while the form has errors. */
export const businessHoursOfForm = (form: HoursForm): Customers.BusinessHours | undefined => {
	const errors = hoursErrors(form)
	if (errors.days !== undefined || errors.time !== undefined) return undefined
	return {
		timeZone: form.timeZone,
		days: [...form.days].sort((left, right) => left - right),
		start: form.start,
		end: form.end,
	}
}

export const sameHours = (left: HoursForm, right: HoursForm): boolean =>
	left.timeZone === right.timeZone &&
	left.start === right.start &&
	left.end === right.end &&
	[...left.days].sort().join() === [...right.days].sort().join()

// WORDS

const isDefault = (appliesTo: Customers.SlaAppliesTo) =>
	appliesTo.accountIds.length === 0 && appliesTo.planNames.length === 0 && appliesTo.tagsAny.length === 0

/** "Default · any customer", "Plans: Enterprise · Tags: vip", "3 customers". */
export const appliesToSummary = (
	appliesTo: Customers.SlaAppliesTo,
	accounts: ReadonlyArray<AccountOption>,
): string => {
	if (isDefault(appliesTo)) return "Default · any customer"
	const { accountIds, planNames, tagsAny } = appliesTo
	const only =
		accountIds.length === 1 ? accounts.find((account) => account.id === accountIds[0]) : undefined
	return [
		...(planNames.length === 0 ? [] : [`Plans: ${planNames.join(", ")}`]),
		...(tagsAny.length === 0 ? [] : [`Tags: ${tagsAny.join(", ")}`]),
		...(accountIds.length === 0
			? []
			: [only?.name ?? `${accountIds.length} ${accountIds.length === 1 ? "customer" : "customers"}`]),
	].join(" · ")
}

/** "Normal: 4h reply · 24h resolve". */
export const normalTargetHint = (targets: Customers.SlaTargets): string =>
	`Normal: ${formatMinutes(targets.normal.firstResponseMinutes)} reply · ${formatMinutes(targets.normal.resolutionMinutes)} resolve`

export const HOURS_LABEL = {
	business: "Business hours",
	always: "24/7",
} as const satisfies Record<Customers.SlaHours, string>

export const WEEKDAYS: ReadonlyArray<readonly [number, string, string]> = [
	[1, "Mon", "Monday"],
	[2, "Tue", "Tuesday"],
	[3, "Wed", "Wednesday"],
	[4, "Thu", "Thursday"],
	[5, "Fri", "Friday"],
	[6, "Sat", "Saturday"],
	[7, "Sun", "Sunday"],
]

// THE EXAMPLE

/** A Friday at 16:50, read as UTC: the example's wall time in the org's zone. */
const EXAMPLE_LOCAL_MS = Date.UTC(2026, 10, 20, 16, 50)

const wallTime = (at: number, timeZone: string, withDate: boolean): string => {
	const parts = new Intl.DateTimeFormat("en-GB", {
		timeZone,
		weekday: "long",
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
		day: "numeric",
		month: "short",
	}).formatToParts(at)
	const of = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ""
	const day = withDate ? ` ${of("day")} ${of("month")}` : ""
	return `${of("weekday")}${day} ${of("hour")}:${of("minute")}`
}

/** "A normal message on Friday 16:50 is due Monday 12:50."; undefined while the target is invalid. */
export const exampleLine = (form: PolicyForm, businessHours: Customers.BusinessHours): string | undefined => {
	const target = form.targets.normal.firstResponse
	if (durationError(target) !== undefined) return undefined
	const minutes = minutesOf(target)
	const { timeZone } = businessHours
	const from = Customers.instantOf(EXAMPLE_LOCAL_MS, timeZone)
	const due = Customers.addWorkingTime(
		Customers.calendarOf(form.hours, businessHours),
		from,
		minutes * MINUTE_MS,
	)
	const withDate = due - from >= 6 * 24 * 60 * MINUTE_MS
	return `A normal message on ${wallTime(from, timeZone, false)} is due ${wallTime(due, timeZone, withDate)}.`
}
