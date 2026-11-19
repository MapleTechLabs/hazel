/**
 * Overview layouts (`docs/customers/overview-layouts.md`): the default layout, the assignment of
 * every account's `layoutId` and each layout's `accountCount`, and the dry run of a draft rule.
 *
 * Assignment is server-side because metric conditions read stored values: it runs after a layout
 * is created, changed, deleted or reordered, after a pin, and at the end of each compute (values
 * move). It loads the accounts and the metric windows the rules read in a few aggregate queries
 * (`ruleWindowValues`), resolves each account (`resolveLayout`), and writes only what changed.
 */
import { Database, SQLite, schema } from "@hazel/db"
import {
	DEFAULT_LAYOUT_WIDGETS,
	EMPTY_LAYOUT_RULE,
	type LayoutDryRunResult,
	type LayoutFacts,
	type LayoutRule,
	ruleMatches,
	ruleMetricWindows,
	resolveLayout,
} from "@hazel/domain/customers"
import type { CustomerAccountId, CustomerOverviewLayoutId, OrganizationId } from "@hazel/schema"
import { Effect, Option } from "effect"
import { ruleWindowValues } from "./metric-values"
import { inList } from "./sql"
import { dayOf } from "./time"

/** The default layout sorts after every other: rules are tried first. */
export const DEFAULT_LAYOUT_POSITION = 1_000_000

/** At most this many matching accounts a dry run lists. */
const DRY_RUN_LISTED = 200

export const defaultLayoutRow = (organizationId: OrganizationId) => ({
	organizationId,
	name: "Default",
	position: DEFAULT_LAYOUT_POSITION,
	isDefault: true,
	rule: EMPTY_LAYOUT_RULE,
	widgets: DEFAULT_LAYOUT_WIDGETS,
})

/** The live layouts in the order rules are tried. */
export const liveLayouts = Effect.flatMap(Database.Database, (db) =>
	db.run(
		SQLite.from(schema.customerOverviewLayoutsTable)
			.select()
			.where(($) => [$.deletedAt.isNull()])
			.orderBy(($) => [
				[$.position, "asc"],
				// Positions are unique (create refuses a taken one); a tie still orders one way.
				[$.id, "asc"],
			]),
	),
)

/** Where a new layout goes by default: before every other rule (the default aside). */
export const firstPosition = (layouts: ReadonlyArray<schema.CustomerOverviewLayout>) => {
	const others = layouts.filter((layout) => !layout.isDefault)
	return others.length === 0 ? 0 : Math.min(...others.map((layout) => layout.position)) - 1
}

/** The live accounts, each with what layout rules read (the metric windows `rules` need). */
const layoutInputs = (rules: ReadonlyArray<LayoutRule>, now: Date) =>
	Effect.gen(function* () {
		const db = yield* Database.Database
		const accounts = yield* db.run(
			SQLite.from(schema.customerAccountsTable)
				.select(
					"id",
					"name",
					"lifecycleStage",
					"lifecycleStageOverride",
					"planName",
					"tags",
					"healthStatus",
					"mrrMinor",
					"activeUsers30d",
					"attributes",
					"pinnedLayoutId",
					"layoutId",
				)
				.where(($) => [$.deletedAt.isNull()]),
		)
		const windows = yield* ruleWindowValues(rules.flatMap(ruleMetricWindows), accounts, dayOf(now))
		return accounts.map((account) => ({
			account,
			facts: {
				lifecycleStage: account.lifecycleStageOverride ?? account.lifecycleStage,
				planName: account.planName,
				tags: account.tags,
				healthStatus: account.healthStatus,
				mrrMinor: account.mrrMinor,
				attributes: account.attributes,
				metricWindows: windows.get(account.id) ?? new Map(),
			} satisfies LayoutFacts,
		}))
	})

/** Every live account's layout and every layout's count, written where they changed. */
export const assignLayouts = Effect.fn("Customers.assignLayouts")(function* (now: Date) {
	const db = yield* Database.Database
	const layouts = yield* liveLayouts
	if (layouts.length === 0) return
	const inputs = yield* layoutInputs(
		layouts.map((layout) => layout.rule),
		now,
	)
	const counts = new Map<CustomerOverviewLayoutId, number>()
	const moves = new Map<CustomerOverviewLayoutId | null, Array<CustomerAccountId>>()
	for (const { account, facts } of inputs) {
		const layoutId = resolveLayout(layouts, facts, account.pinnedLayoutId)?.id ?? null
		if (layoutId !== null) counts.set(layoutId, (counts.get(layoutId) ?? 0) + 1)
		if (layoutId === account.layoutId) continue
		const moved = moves.get(layoutId)
		if (moved === undefined) moves.set(layoutId, [account.id])
		else moved.push(account.id)
	}
	for (const [layoutId, accountIds] of moves) {
		yield* db.run(
			SQLite.update(schema.customerAccountsTable)
				.set({ layoutId })
				.where(($) => [inList($.id, accountIds)]),
		)
	}
	for (const layout of layouts) {
		const accountCount = counts.get(layout.id) ?? 0
		if (accountCount === layout.accountCount) continue
		yield* db.run(
			SQLite.update(schema.customerOverviewLayoutsTable)
				.set({ accountCount })
				.where(($) => [$.id.eq(layout.id)]),
		)
	}
	yield* Effect.annotateCurrentSpan({
		"customers.layouts": layouts.length,
		"customers.accounts": inputs.length,
		"customers.layout_moves": [...moves.values()].reduce((sum, ids) => sum + ids.length, 0),
	})
})

/**
 * An organization whose defaults predate layouts gets its default layout (and its accounts their
 * layout) on the first activation after the change. Idempotent.
 */
export const ensureDefaultLayout = Effect.fn("Customers.ensureDefaultLayout")(function* (
	organizationId: OrganizationId,
	now: Date,
) {
	const db = yield* Database.Database
	const existing = yield* db.first(
		SQLite.from(schema.customerOverviewLayoutsTable)
			.select("id")
			.where(($) => [$.isDefault.eq(true), $.deletedAt.isNull()])
			.limit(1),
	)
	if (Option.isSome(existing)) return
	yield* db.run(
		SQLite.insertInto(schema.customerOverviewLayoutsTable).values(defaultLayoutRow(organizationId)),
	)
	yield* assignLayouts(now)
})

/**
 * Who `rule` gives a layout to at `position` (absent: where `layoutId` sits, else first): the
 * accounts it matches, those a layout earlier in the order takes, those pinned to another layout,
 * and what it gets: the rest, plus every account pinned to it (a pin wins over every rule).
 */
export const layoutDryRun = Effect.fn("Customers.layoutDryRun")(function* (
	input: {
		readonly layoutId?: CustomerOverviewLayoutId
		readonly rule: LayoutRule
		readonly position?: number
	},
	now: Date,
) {
	const layouts = yield* liveLayouts
	const position =
		input.position ??
		layouts.find((layout) => layout.id === input.layoutId)?.position ??
		Number.NEGATIVE_INFINITY
	// Before it in the order assignment uses: position, then id (a new draft goes after a tie).
	const earlier = layouts.filter(
		(layout) =>
			!layout.isDefault &&
			layout.id !== input.layoutId &&
			(layout.position < position ||
				(layout.position === position && layout.id < (input.layoutId ?? "\uffff"))),
	)
	const inputs = yield* layoutInputs([input.rule, ...earlier.map((layout) => layout.rule)], now)
	const names = new Map(layouts.map((layout) => [layout.id, layout.name]))
	/** A pin to a live layout: it wins over every rule. */
	const pinOf = (account: (typeof inputs)[number]["account"]) =>
		account.pinnedLayoutId !== null && names.has(account.pinnedLayoutId) ? account.pinnedLayoutId : null
	const pinnedHere = (account: (typeof inputs)[number]["account"]) =>
		input.layoutId !== undefined && pinOf(account) === input.layoutId
	const matching = inputs.filter(({ facts }) => ruleMatches(input.rule, facts))
	const taken = new Map<CustomerOverviewLayoutId, number>()
	let pinnedElsewhere = 0
	for (const { account, facts } of matching) {
		if (pinnedHere(account)) continue
		if (pinOf(account) !== null) {
			pinnedElsewhere += 1
			continue
		}
		const by = earlier.find((layout) => ruleMatches(layout.rule, facts))?.id
		if (by !== undefined) taken.set(by, (taken.get(by) ?? 0) + 1)
	}
	const takenCount = [...taken.values()].reduce((sum, count) => sum + count, 0)
	// Pinned to it without matching: it gets them all the same (the matching ones are counted already).
	const pinnedOnly = inputs.filter(
		({ account, facts }) => pinnedHere(account) && !ruleMatches(input.rule, facts),
	).length
	return {
		matchingCount: matching.length,
		matching: matching
			.map(({ account }) => ({ accountId: account.id, name: account.name }))
			.sort((a, b) => a.name.localeCompare(b.name))
			.slice(0, DRY_RUN_LISTED),
		takenBy: [...taken]
			.map(([layoutId, count]) => ({ layoutId, name: names.get(layoutId) ?? "", count }))
			.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
		pinnedElsewhere,
		effectiveCount: matching.length - takenCount - pinnedElsewhere + pinnedOnly,
	} satisfies LayoutDryRunResult
})
