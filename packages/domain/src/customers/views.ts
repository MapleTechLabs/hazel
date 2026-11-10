/**
 * Saved views of the customers list: filters, sort and columns, applied client-side to the synced
 * `customer_accounts` (`docs/customers/tech-design.md` §6).
 */
import { UserId } from "@hazel/schema"
import { Schema } from "effect"
import { HealthStatus, LifecycleStage } from "./enums"

export const ListColumn = Schema.Literals([
	"name",
	"owner",
	"stage",
	"plan",
	"mrr",
	"health",
	"active_users_30d",
	"usage_trend",
	"last_active",
	"open_signals",
	"customer_since",
	"tags",
])
export type ListColumn = typeof ListColumn.Type

export const DEFAULT_LIST_COLUMNS: ReadonlyArray<ListColumn> = [
	"name",
	"owner",
	"stage",
	"plan",
	"mrr",
	"health",
	"active_users_30d",
	"usage_trend",
	"last_active",
	"open_signals",
	"customer_since",
]

/** Every field narrows; an empty object matches every non-deleted account. */
export const ViewFilters = Schema.Struct({
	search: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(200))),
	/** The viewer's own accounts ("My customers"). */
	ownedByMe: Schema.optionalKey(Schema.Boolean),
	ownerUserIds: Schema.optionalKey(Schema.Array(UserId).check(Schema.isMaxLength(100))),
	/** Accounts with no owner. */
	unowned: Schema.optionalKey(Schema.Boolean),
	lifecycleStages: Schema.optionalKey(Schema.Array(LifecycleStage)),
	healthStatuses: Schema.optionalKey(Schema.Array(HealthStatus)),
	planNames: Schema.optionalKey(
		Schema.Array(Schema.String.check(Schema.isMaxLength(100))).check(Schema.isMaxLength(50)),
	),
	tagsAny: Schema.optionalKey(
		Schema.Array(Schema.String.check(Schema.isMaxLength(50))).check(Schema.isMaxLength(50)),
	),
	minMrrMinor: Schema.optionalKey(Schema.Int),
	maxMrrMinor: Schema.optionalKey(Schema.Int),
	/** MRR > 0. */
	payingOnly: Schema.optionalKey(Schema.Boolean),
	hasOpenRiskSignals: Schema.optionalKey(Schema.Boolean),
	lastActiveWithinDays: Schema.optionalKey(Schema.Int),
	inactiveForDays: Schema.optionalKey(Schema.Int),
})
export type ViewFilters = typeof ViewFilters.Type

export const ViewSort = Schema.Struct({
	column: ListColumn,
	direction: Schema.Literals(["asc", "desc"]),
})
export type ViewSort = typeof ViewSort.Type

export const ViewDraft = Schema.Struct({
	name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(80)),
	filters: ViewFilters,
	sort: ViewSort,
	columns: Schema.Array(ListColumn),
})
export type ViewDraft = typeof ViewDraft.Type
