/**
 * The customers list's filters (`docs/customers/spec.md` §3): the builder's fields, what each chip
 * says, which accounts a view's filters keep, and the options the builder offers. Pure; the list
 * page and its controls share it.
 */
import * as Customers from "@hazel/domain/customers"
import type { UserId } from "@hazel/schema"
import { Schema } from "effect"
import {
	countryCodeOf,
	countryNameOf,
	fundingStageLabel,
	fundingStageOf,
	fundingStageRank,
} from "../data/company"
import { formatMoney } from "../data/format"
import { namesLabel, providerOf, usageSources } from "../data/providers"
import type { AccountRow, MemberRow } from "../data/queries"
import { STAGE_LABEL } from "../ui/badges"

/** The filter builder's fields; each chip clears one. */
export const FilterField = Schema.Literals([
	"stage",
	"plan",
	"owner",
	"tag",
	"mrr",
	"last_active",
	"signals",
	"industry",
	"company_size",
	"country",
	"funding",
])
export type FilterField = typeof FilterField.Type

/** The builder edits a copy of the filters; Apply commits it. */
export const Builder = Schema.Struct({ field: FilterField, pending: Customers.ViewFilters })
export type Builder = typeof Builder.Type

/** Who is looking: "Me" filters and "last active" windows depend on it. */
export interface Viewer {
	readonly userId: UserId | null
	readonly nowMs: number
	/** Admins and owners edit shared and built-in views. */
	readonly isAdmin: boolean
}

export const FIELD_LABEL = {
	stage: "Stage",
	plan: "Plan",
	owner: "Owner",
	tag: "Tag",
	mrr: "MRR",
	last_active: "Last active",
	signals: "Open risk signals",
	industry: "Industry",
	company_size: "Company size",
	country: "HQ country",
	funding: "Funding stage",
} satisfies Record<FilterField, string>

/** What kind of value a field takes, beside its name in the builder. */
export const FIELD_KIND = {
	stage: "Select",
	plan: "Select",
	owner: "Person",
	tag: "Select",
	mrr: "Amount",
	last_active: "Date",
	signals: "Yes / no",
	industry: "Select",
	company_size: "Select",
	country: "Select",
	funding: "Select",
} satisfies Record<FilterField, string>

export const FIELD_GROUPS: ReadonlyArray<readonly [string, ReadonlyArray<FilterField>]> = [
	["Account", ["stage", "plan", "owner", "tag"]],
	["Usage", ["last_active"]],
	["Revenue", ["mrr"]],
	["Signals", ["signals"]],
	["Company", ["industry", "company_size", "country", "funding"]],
]

export const FIELD_DESCRIPTION = {
	stage: "Where the account is in its lifecycle, from billing.",
	plan: "The plan of its largest subscription.",
	owner: "Who in your team looks after the account.",
	tag: "Tags your team added.",
	mrr: "Monthly recurring revenue, in your reporting currency.",
	last_active: `Most recent activity from any contact, from ${namesLabel(usageSources.map((source) => [providerOf(source).name, providerOf(source).activityLabel?.noun].filter(Boolean).join(" ")))}.`,
	signals: "Whether the account has an open risk signal now.",
	industry: "The company's industry, from its enriched profile.",
	company_size: "The company's headcount, from its enriched profile.",
	country: "Where the company has its headquarters, from its enriched profile.",
	funding: "The company's latest funding stage, from its enriched profile.",
} satisfies Record<FilterField, string>

const DAY_MS = 86_400_000

// ACCOUNT FIELDS

/** The company fields the list shows and filters by; null when the account has no profile or no value. */
export const industryOf = (account: AccountRow): string | null => account.company?.industry ?? null
export const employeeRangeOf = (account: AccountRow): Customers.EmployeeRange | null =>
	account.company?.employeeRange ?? null
export const countryOf = (account: AccountRow): string | null =>
	account.company === null ? null : countryCodeOf(account.company)
export const fundingOf = (account: AccountRow): string | null =>
	account.company === null ? null : fundingStageOf(account.company)

// MATCHING

const hasRisk = (account: AccountRow) =>
	account.openRiskHigh + account.openRiskMedium + account.openRiskLow > 0

const matchesOwner = (filters: Customers.ViewFilters, account: AccountRow, viewer: Viewer): boolean => {
	const ids = filters.ownerUserIds ?? []
	if (!filters.ownedByMe && ids.length === 0 && !filters.unowned) return true
	const owner = account.ownerUserId
	return owner === null
		? filters.unowned === true
		: (filters.ownedByMe === true && owner === viewer.userId) || ids.includes(owner)
}

/** A company filter: an account without the value (or without a profile) matches none. */
const inKnownList = <A>(list: ReadonlyArray<A> | undefined, value: A | null) =>
	list === undefined || list.length === 0 || (value !== null && list.includes(value))

/** One account against a view's filters (`ViewFilters`: every field narrows). */
export const matchesFilters = (
	filters: Customers.ViewFilters,
	account: AccountRow,
	viewer: Viewer,
): boolean => {
	const query = (filters.search ?? "").trim().toLowerCase()
	const inList = <A>(list: ReadonlyArray<A> | undefined, value: A) =>
		list === undefined || list.length === 0 || list.includes(value)
	return (
		matchesOwner(filters, account, viewer) &&
		inKnownList(filters.industries, industryOf(account)) &&
		inKnownList(filters.employeeRanges, employeeRangeOf(account)) &&
		inKnownList(filters.countryCodes, countryOf(account)) &&
		inKnownList(filters.fundingStages, fundingOf(account)) &&
		inList(filters.lifecycleStages, account.lifecycleStage) &&
		inList(filters.planNames, account.planName ?? "") &&
		(filters.tagsAny === undefined ||
			filters.tagsAny.length === 0 ||
			account.tags.some((tag) => filters.tagsAny?.includes(tag))) &&
		(filters.minMrrMinor === undefined || account.mrrMinor >= filters.minMrrMinor) &&
		(filters.maxMrrMinor === undefined || account.mrrMinor <= filters.maxMrrMinor) &&
		(!filters.payingOnly || account.mrrMinor > 0) &&
		(filters.hasOpenRiskSignals === undefined || hasRisk(account) === filters.hasOpenRiskSignals) &&
		(filters.lastActiveWithinDays === undefined ||
			(account.lastActiveAtMs !== null &&
				account.lastActiveAtMs >= viewer.nowMs - filters.lastActiveWithinDays * DAY_MS)) &&
		(filters.inactiveForDays === undefined ||
			account.lastActiveAtMs === null ||
			account.lastActiveAtMs < viewer.nowMs - filters.inactiveForDays * DAY_MS) &&
		(query === "" ||
			account.name.toLowerCase().includes(query) ||
			(account.environment ?? "").toLowerCase().includes(query) ||
			(account.domain ?? "").toLowerCase().includes(query))
	)
}

export const countMatching = (
	accounts: ReadonlyArray<AccountRow>,
	filters: Customers.ViewFilters,
	viewer: Viewer,
): number => accounts.filter((account) => matchesFilters(filters, account, viewer)).length

/** The filters plus the search box's text (which is not part of a view). */
export const withSearch = (filters: Customers.ViewFilters, search: string): Customers.ViewFilters =>
	search.trim() === "" ? filters : { ...filters, search }

// FIELDS

/** Filters compared as JSON: absent, empty lists and key order do not count. */
export const canonicalFilters = (filters: Customers.ViewFilters): string =>
	JSON.stringify(
		Object.entries(filters)
			.filter(([, value]) => value !== undefined && !(Array.isArray(value) && value.length === 0))
			.sort(([left], [right]) => left.localeCompare(right)),
	)

const FIELD_KEYS = {
	owner: ["ownedByMe", "ownerUserIds", "unowned"],
	stage: ["lifecycleStages"],
	plan: ["planNames"],
	tag: ["tagsAny"],
	mrr: ["minMrrMinor", "maxMrrMinor", "payingOnly"],
	last_active: ["lastActiveWithinDays", "inactiveForDays"],
	signals: ["hasOpenRiskSignals"],
	industry: ["industries"],
	company_size: ["employeeRanges"],
	country: ["countryCodes"],
	funding: ["fundingStages"],
} as const satisfies Record<FilterField, ReadonlyArray<keyof Customers.ViewFilters>>

/** The filters without one field's keys. */
export const clearField = (filters: Customers.ViewFilters, field: FilterField): Customers.ViewFilters =>
	Object.fromEntries(
		Object.entries(filters).filter(
			([key]) => !(FIELD_KEYS[field] as ReadonlyArray<string>).includes(key),
		),
	) as Customers.ViewFilters

export const isFieldActive = (filters: Customers.ViewFilters, field: FilterField): boolean =>
	canonicalFilters(clearField(filters, field)) !== canonicalFilters(filters)

/** The active fields, in builder order. */
export const activeFields = (filters: Customers.ViewFilters): ReadonlyArray<FilterField> =>
	FilterField.literals.filter((field) => isFieldActive(filters, field))

/** Adds or removes `value` from a list filter; an empty list drops the key. */
export const toggleIn = <A>(list: ReadonlyArray<A> | undefined, value: A): ReadonlyArray<A> | undefined => {
	const next = (list ?? []).includes(value)
		? (list ?? []).filter((entry) => entry !== value)
		: [...(list ?? []), value]
	return next.length === 0 ? undefined : next
}

/** Sets a key, or removes it when `value` is undefined (the schema has optional keys, not undefined). */
export const withFilter = <K extends keyof Customers.ViewFilters>(
	filters: Customers.ViewFilters,
	key: K,
	value: Customers.ViewFilters[K] | undefined,
): Customers.ViewFilters => {
	const { [key]: _removed, ...rest } = filters
	return value === undefined ? rest : { ...rest, [key]: value }
}

// OPTIONS

/** Distinct plans and tags of the accounts, for the builder's options. */
export const plansOf = (accounts: ReadonlyArray<AccountRow>): ReadonlyArray<string> =>
	[...new Set(accounts.flatMap((account) => (account.planName === null ? [] : [account.planName])))].sort()

export const tagsOf = (accounts: ReadonlyArray<AccountRow>): ReadonlyArray<string> =>
	[...new Set(accounts.flatMap((account) => account.tags))].sort()

const distinct = (values: ReadonlyArray<string | null>): ReadonlyArray<string> => [
	...new Set(values.filter((value) => value !== null)),
]

/** The company filters' options: the values the accounts have, plus any the filter already holds. */
export const industriesOf = (
	accounts: ReadonlyArray<AccountRow>,
	selected: ReadonlyArray<string> = [],
): ReadonlyArray<string> =>
	[...distinct([...accounts.map(industryOf), ...selected])].sort((a, b) => a.localeCompare(b))

/** Countries by name: `{ code: "DE", name: "Germany" }`. */
export const countriesOf = (
	accounts: ReadonlyArray<AccountRow>,
	selected: ReadonlyArray<string> = [],
): ReadonlyArray<Readonly<{ code: string; name: string }>> =>
	distinct([...accounts.map(countryOf), ...selected])
		.map((code) => ({ code, name: countryNameOf(code) }))
		.sort((a, b) => a.name.localeCompare(b.name))

/** Funding stages as the source names them, ordered by their label. */
export const fundingStagesOf = (
	accounts: ReadonlyArray<AccountRow>,
	selected: ReadonlyArray<string> = [],
): ReadonlyArray<string> =>
	[...distinct([...accounts.map(fundingOf), ...selected])].sort(
		(a, b) => fundingStageRank(a) - fundingStageRank(b) || a.localeCompare(b),
	)

// CHIPS

export type Chip = Readonly<{ field: string; operator: string; value: string }>

/** A chip's `field operator value`, or none when the field is not set. */
export const chipOf = (
	field: FilterField,
	filters: Customers.ViewFilters,
	members: ReadonlyArray<MemberRow>,
	currency: string,
): Chip | null => {
	const anyOf = (values: ReadonlyArray<string> | undefined): Chip | null =>
		values === undefined || values.length === 0
			? null
			: {
					field: FIELD_LABEL[field],
					operator: values.length === 1 ? "is" : "is any of",
					value: values.join(", "),
				}
	switch (field) {
		case "stage":
			return anyOf(filters.lifecycleStages?.map((stage) => STAGE_LABEL[stage]))
		case "plan":
			return anyOf(filters.planNames)
		case "tag":
			return anyOf(filters.tagsAny)
		case "industry":
			return anyOf(filters.industries)
		case "company_size":
			return anyOf(filters.employeeRanges?.map((range) => Customers.EMPLOYEE_RANGE_LABEL[range]))
		case "country":
			return anyOf(filters.countryCodes?.map(countryNameOf))
		case "funding":
			return anyOf(filters.fundingStages?.map(fundingStageLabel))
		case "owner":
			return anyOf([
				...(filters.ownedByMe ? ["Me"] : []),
				...(filters.ownerUserIds ?? []).map(
					(id) => members.find((member) => member.id === id)?.name ?? "Someone",
				),
				...(filters.unowned ? ["Unassigned"] : []),
			])
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
