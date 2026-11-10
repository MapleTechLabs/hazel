import * as Customers from "@hazel/domain/customers"
import { CustomerAccountId, CustomerIgnoreRuleId, CustomerUnmatchedRecordId } from "@hazel/schema"
import { Array, Option, Order, Schema } from "effect"
import * as AsyncData from "foldkit/asyncData"
import { CommonReason } from "~/lib/error-messages"
import { PROVIDER_ORDER } from "../../../../customers/providers"
import { AccountRow, msOf } from "../../../../customers/queries"
import * as Menu from "../../../../ui/menu"
import * as Popover from "../../../../ui/popover"

/**
 * The unmatched records resolver (`docs/customers/spec.md`, Data sources › Unmatched): source records
 * no account claims, grouped by source, linked to a suggested or searched account, made into an
 * account, or ignored (once, or by a pattern for every future sync).
 */

// ROWS

/** A record as the page shows it (`customers.unmatched.list` items, dates as epoch ms). */
export const RecordRow = Schema.Struct({
	id: CustomerUnmatchedRecordId,
	provider: Customers.CustomerProvider,
	entityType: Customers.UnmatchedEntityType,
	externalId: Schema.String,
	label: Schema.String,
	email: Schema.NullOr(Schema.String),
	domain: Schema.NullOr(Schema.String),
	valueMinor: Schema.NullOr(Schema.Int),
	currency: Schema.NullOr(Schema.String),
	eventCount30d: Schema.NullOr(Schema.Int),
	suggestedAccountId: Schema.NullOr(CustomerAccountId),
	confidence: Schema.NullOr(Schema.Number),
	reason: Schema.String,
	updatedAtMs: Schema.Number,
})
export type RecordRow = typeof RecordRow.Type

export const toRecordRow = (record: Customers.UnmatchedRecord): RecordRow => ({
	id: record.id,
	provider: record.provider,
	entityType: record.entityType,
	externalId: record.externalId,
	label: record.label,
	email: record.email,
	domain: record.domain,
	valueMinor: record.valueMinor,
	currency: record.currency,
	eventCount30d: record.eventCount30d,
	suggestedAccountId: record.suggestedAccountId,
	confidence: record.confidence,
	reason: record.reason,
	updatedAtMs: msOf(record.updatedAt),
})

export const IgnoreRuleRow = Schema.Struct({
	id: CustomerIgnoreRuleId,
	provider: Schema.NullOr(Customers.CustomerProvider),
	entityType: Customers.UnmatchedEntityType,
	field: Customers.IgnoreRuleField,
	pattern: Schema.String,
	createdAtMs: Schema.Number,
})
export type IgnoreRuleRow = typeof IgnoreRuleRow.Type

export const toIgnoreRuleRow = (rule: Customers.IgnoreRule): IgnoreRuleRow => ({
	id: rule.id,
	provider: rule.provider,
	entityType: rule.entityType,
	field: rule.field,
	pattern: rule.pattern,
	createdAtMs: msOf(rule.createdAt),
})

// MODEL

export const RecordStatus = Schema.Literals(["open", "ignored"])
export type RecordStatus = typeof RecordStatus.Type

/** All open records, one source's, or the ignored ones. */
export const Tab = Schema.Union([Schema.Literals(["all", "ignored"]), Customers.CustomerProvider])
export type Tab = typeof Tab.Type

export const Sort = Schema.Literals(["confidence", "value", "newest"])
export type Sort = typeof Sort.Type

/** The loaded pages of one status. */
export const RecordList = Schema.Struct({
	items: Schema.Array(RecordRow),
	nextCursor: Schema.NullOr(Schema.String),
})
export type RecordList = typeof RecordList.Type

export const Records = AsyncData.Schema(RecordList, CommonReason)
export type Records = typeof Records.schema.Type
export const Rules = AsyncData.Schema(Schema.Array(IgnoreRuleRow), CommonReason)

/** The row whose `⋯` menu was used last. */
export const RowMenu = Schema.Struct({ recordId: CustomerUnmatchedRecordId, menu: Menu.Model })
/** The row whose "Link to…" search was used last, and its query. */
export const LinkSearch = Schema.Struct({
	recordId: CustomerUnmatchedRecordId,
	popover: Popover.Model,
	query: Schema.String,
})

export const Model = Schema.Struct({
	tab: Tab,
	search: Schema.String,
	sort: Sort,
	open: Records.schema,
	ignored: Records.schema,
	rules: Rules.schema,
	/** Open records on the server, less the ones resolved here since. */
	openCount: Schema.Int,
	/** The list a "Load more" is fetching. */
	loadingMore: Schema.NullOr(RecordStatus),
	/** Live accounts: suggestions and the link search; null until the query answers. */
	accounts: Schema.NullOr(Schema.Array(AccountRow)),
	selected: Schema.Array(CustomerUnmatchedRecordId),
	/** Records taken off the open list while their action runs; a failure puts them back. */
	inFlight: Schema.Array(RecordRow),
	/** Ignore rules deleted while the delete runs. */
	deletedRules: Schema.Array(IgnoreRuleRow),
	sortMenu: Menu.Model,
	rowMenu: Schema.NullOr(RowMenu),
	linkSearch: Schema.NullOr(LinkSearch),
})
export type Model = typeof Model.Type

/** The list RPC clamps to 100. */
export const PAGE_SIZE = 100
export const SEARCH_ID = "unmatched-search"
export const SORT_MENU_ID = "unmatched-sort"
export const rowMenuId = (recordId: CustomerUnmatchedRecordId) => `unmatched-more-${recordId}`
export const linkPopoverId = (recordId: CustomerUnmatchedRecordId) => `unmatched-link-${recordId}`

// CONFIDENCE

export type Confidence = "high" | "medium" | "low"

/** "Link N high-confidence" links these and only these. */
export const HIGH_CONFIDENCE = 0.8
const MEDIUM_CONFIDENCE = 0.5

/**
 * A suggestion's tier. Ingest scores an ambiguous match `1 / candidates`; a suggestion without a
 * score is the account the record itself names (a user active in a known customer), so it is high.
 */
export const confidenceOf = (record: RecordRow): Confidence | null => {
	if (record.suggestedAccountId === null) return null
	const score = record.confidence ?? 1
	return score >= HIGH_CONFIDENCE ? "high" : score >= MEDIUM_CONFIDENCE ? "medium" : "low"
}

// WHAT IS SHOWN

export const itemsOf = (records: Records): ReadonlyArray<RecordRow> =>
	Option.match(AsyncData.getData(records), { onNone: () => [], onSome: (list) => list.items })

export const openRecords = (model: Model) => itemsOf(model.open)

const matchesSearch = (record: RecordRow, query: string): boolean =>
	query === "" ||
	[record.label, record.email, record.domain, record.externalId].some(
		(value) => value !== null && value.toLowerCase().includes(query),
	)

const byConfidence = Order.mapInput(Order.flip(Order.Number), (record: RecordRow) =>
	record.suggestedAccountId === null ? -1 : (record.confidence ?? 1),
)
const byValue = Order.combine(
	Order.mapInput(Order.flip(Order.Number), (record: RecordRow) => record.valueMinor ?? -1),
	Order.mapInput(Order.flip(Order.Number), (record: RecordRow) => record.eventCount30d ?? -1),
)
const byNewest = Order.mapInput(Order.flip(Order.Number), (record: RecordRow) => record.updatedAtMs)
const SORT_ORDER = { confidence: byConfidence, value: byValue, newest: byNewest } as const

/** The tab's records after the search, in display order. */
export const visibleRecords = (model: Model): ReadonlyArray<RecordRow> => {
	const query = model.search.trim().toLowerCase()
	const records =
		model.tab === "ignored"
			? itemsOf(model.ignored)
			: openRecords(model).filter((record) => model.tab === "all" || record.provider === model.tab)
	return Array.sort(
		records.filter((record) => matchesSearch(record, query)),
		SORT_ORDER[model.sort],
	)
}

/** One tab per source with open records, in the sources' order. */
export const sourceTabs = (
	model: Model,
): ReadonlyArray<Readonly<{ provider: Customers.CustomerProvider; count: number }>> =>
	PROVIDER_ORDER.flatMap((provider) => {
		const count = openRecords(model).filter((record) => record.provider === provider).length
		return count === 0 ? [] : [{ provider, count }]
	})

const ENTITY_ORDER = Customers.UnmatchedEntityType.literals

export interface RecordGroup {
	readonly provider: Customers.CustomerProvider
	readonly entityType: Customers.UnmatchedEntityType
	readonly records: ReadonlyArray<RecordRow>
}

/** Records by source and kind ("Stripe customers", "Maple groups"), each group keeping their order. */
export const groupsOf = (records: ReadonlyArray<RecordRow>): ReadonlyArray<RecordGroup> =>
	PROVIDER_ORDER.flatMap((provider) =>
		ENTITY_ORDER.flatMap((entityType) => {
			const inGroup = records.filter(
				(record) => record.provider === provider && record.entityType === entityType,
			)
			return inGroup.length === 0 ? [] : [{ provider, entityType, records: inGroup }]
		}),
	)

/** Open records "Link N high-confidence" would link. */
export const highConfidenceRecords = (model: Model): ReadonlyArray<RecordRow> =>
	openRecords(model).filter((record) => confidenceOf(record) === "high")

export const recordById = (model: Model, recordId: CustomerUnmatchedRecordId): RecordRow | undefined =>
	openRecords(model).find((record) => record.id === recordId)

export const accountById = (model: Model, accountId: CustomerAccountId | null): AccountRow | undefined =>
	accountId === null ? undefined : (model.accounts ?? []).find((account) => account.id === accountId)

// IGNORE PATTERNS

export type IgnorePatternKey = "ignore_domain" | "ignore_prefix"

export interface IgnorePattern {
	readonly key: IgnorePatternKey
	readonly field: Customers.IgnoreRuleField
	/** A `*`-glob, matched case-insensitively against the whole value (ingest's `globMatches`). */
	readonly pattern: string
}

/** `staging-acme` → `staging-*`; underscore id prefixes (`cus_`, `org_`) would match every record. */
const PREFIX = /^([^-\s]+)-\S/

/** The patterns offered for a record: its domain, and its external id's `<prefix>-*`. */
export const ignorePatternsOf = (record: RecordRow): ReadonlyArray<IgnorePattern> => {
	const prefix = PREFIX.exec(record.externalId)?.[1]
	return [
		...(record.domain === null
			? []
			: [{ key: "ignore_domain" as const, field: "domain" as const, pattern: record.domain }]),
		...(prefix === undefined
			? []
			: [{ key: "ignore_prefix" as const, field: "external_id" as const, pattern: `${prefix}-*` }]),
	]
}

// MENUS

export const CREATE_KEY = "create"
export const IGNORE_KEY = "ignore"

/** `⋯`: Create new account (account records) · Ignore this record · Ignore all matching a pattern. */
export const rowMenuEntries = (record: RecordRow): ReadonlyArray<Menu.Entry> => [
	...(record.entityType === "account" ? [Menu.item(CREATE_KEY), Menu.separator] : []),
	Menu.item(IGNORE_KEY),
	...ignorePatternsOf(record).map((pattern) => Menu.item(pattern.key)),
]

export const sortEntries: ReadonlyArray<Menu.Entry> = Sort.literals.map((sort) => Menu.item(sort))

// LINK SEARCH

/** Accounts shown in "Link to…" at once. */
const LINK_RESULTS = 6

/** Accounts matching the query by name or domain, the suggested one first. */
export const linkCandidates = (
	accounts: ReadonlyArray<AccountRow>,
	query: string,
	suggestedAccountId: CustomerAccountId | null,
): Readonly<{ matches: ReadonlyArray<AccountRow>; total: number }> => {
	const needle = query.trim().toLowerCase()
	const matching = accounts.filter(
		(account) =>
			needle === "" ||
			account.name.toLowerCase().includes(needle) ||
			(account.domain?.toLowerCase().includes(needle) ?? false),
	)
	const ordered = [
		...matching.filter((account) => account.id === suggestedAccountId),
		...matching.filter((account) => account.id !== suggestedAccountId),
	]
	return { matches: ordered.slice(0, LINK_RESULTS), total: matching.length }
}
