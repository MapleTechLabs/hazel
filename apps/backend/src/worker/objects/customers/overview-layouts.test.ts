/**
 * The customer Overview's user metrics and layouts in a `CustomersObject`
 * (`docs/customers/overview-layouts.md`): the default layout, metric create/update/delete and their
 * checks, windows and series over formulas, coverage, preview, layout CRUD, pins, reorder, the dry
 * run, and the assignment every change ends with.
 */
import { DEFAULT_LAYOUT_WIDGETS, type IngestOp, type MetricDraft } from "@hazel/domain/customers"
import { Effect, type Scope } from "effect"
import { describe, expect, it } from "vitest"
import { ensureDefaultLayout } from "./layouts"
import { decodeCursor } from "./maple/pull"
import { type CustomersWorld, makeCustomersWorld, ok, tagOf } from "./test-kit"
import { addDays, dayOf } from "./time"

const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
	Effect.runPromise(Effect.scoped(effect) as Effect.Effect<A, E>)

/** The handlers read the real clock. */
const TODAY = dayOf(new Date())

const SQL = (signal: string) =>
	[
		"SELECT Attributes['org_id'] AS account, sum(Value) AS value",
		"FROM metrics_sum",
		"WHERE $__orgFilter",
		"  AND $__timeFilter(TimeUnix)",
		`  AND Attributes['signal'] = '${signal}'`,
		"GROUP BY account",
	].join("\n")

const draft = (source: MetricDraft["source"], overrides: Partial<MetricDraft> = {}): MetricDraft => ({
	name: "A metric",
	description: null,
	group: "Ingest",
	unit: null,
	format: "number",
	aggregation: "sum",
	source,
	...overrides,
})

const query = (signal: string) => ({ _tag: "maple_query", sql: SQL(signal), builder: null }) as const
const formula = (expression: string) => ({ _tag: "formula", expression }) as const

const tagRule = (tag: string) => ({ match: "all", conditions: [{ _tag: "tag", tags: [tag] }] }) as const

const layoutDraft = (name: string, rule: unknown = { match: "all", conditions: [] }) => ({
	name,
	rule,
	widgets: [{ _tag: "built_in", id: "notes", span: 2, kind: "notes" }],
})

/** Accounts from Clerk, by name → id. */
const accounts = (world: CustomersWorld, names: ReadonlyArray<string>) =>
	Effect.gen(function* () {
		yield* world.ingest(
			"clerk",
			names.map((name): IngestOp => ({
				_tag: "account",
				externalId: `org_${name}`,
				name,
				sameAs: [],
				onNoMatch: "create",
			})),
		)
		return Object.fromEntries(
			world
				.rows<{ id: string; name: string }>(`SELECT id, name FROM customer_accounts`)
				.map((row) => [row.name, row.id]),
		) as Record<string, string>
	})

/** Maple's daily values: `[account name, key, days ago, value]`. */
const values = (world: CustomersWorld, rows: ReadonlyArray<readonly [string, string, number, number]>) =>
	world.ingest(
		"maple",
		rows.map(([name, metricKey, ago, value]): IngestOp => ({
			_tag: "metric",
			account: { provider: "clerk", externalId: `org_${name}` },
			metricKey,
			day: addDays(TODAY, -ago),
			value,
		})),
	)

const layoutOf = (world: CustomersWorld) =>
	Object.fromEntries(
		world
			.rows<{ name: string; layout: string | null }>(
				`SELECT a.name, l.name AS layout FROM customer_accounts a
				 LEFT JOIN customer_overview_layouts l ON l.id = a.layoutId ORDER BY a.name`,
			)
			.map((row) => [row.name, row.layout]),
	)

const counts = (world: CustomersWorld) =>
	Object.fromEntries(
		world
			.rows<{ name: string; accountCount: number }>(
				`SELECT name, accountCount FROM customer_overview_layouts WHERE deletedAt IS NULL ORDER BY name`,
			)
			.map((row) => [row.name, row.accountCount]),
	)

describe("Customer Overview metrics", () => {
	it("creates user metrics, refusing keys, sources and formulas it cannot keep", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				const create = (key: string, metric: MetricDraft, user = world.owner) =>
					world.call("customers.metric.create", { key, metric }, user)
				expect(tagOf(yield* create("spans", draft(query("traces")), world.member))).toBe(
					"UnauthorizedError",
				)
				const spans = ok(yield* create("spans", draft(query("traces"), { name: "Spans" })))
				expect(spans.data).toMatchObject({ key: "spans", provider: "maple", group: "Ingest" })
				expect(spans.data.source).toEqual(query("traces"))
				// A backfill of that metric alone starts on the Maple connection.
				const runs = world.rows<{ cursor: string; trigger: string }>(
					`SELECT cursor, trigger FROM customer_sync_runs WHERE connectionId = ?`,
					world.connection("maple"),
				)
				expect(runs).toHaveLength(1)
				expect(decodeCursor(runs[0]!.cursor)).toMatchObject({
					value: { phase: "queries", query: "spans", only: "spans", until: TODAY },
				})
				ok(yield* create("bytes", draft(query("bytes"))))
				const perSpan = ok(yield* create("bytes_per_span", draft(formula("{bytes} / {spans}"))))
				expect(perSpan.data.provider).toBeNull()

				for (const [key, metric] of [
					["mrr", draft(formula("{spans} * 2"))],
					["spans", draft(query("traces"))],
					["fresh", draft(null)],
					["fresh", draft({ ...query("x"), sql: "SELECT 1 AS account, 2 AS value FROM t" })],
					["fresh", draft({ _tag: "product_event", events: ["has space"] })],
					["fresh", draft(formula("{fresh} + 1"))],
					["fresh", draft(formula("{nope} + 1"))],
					["fresh", draft(formula("{bytes_per_span} * 2"))],
					["fresh", draft(formula("{spans} +"))],
				] as const) {
					expect([key, tagOf(yield* create(key, metric))]).toEqual([
						key,
						"CustomersInvalidRequestError",
					])
				}
			}),
		))

	it("reads windows, previous windows, last-seen days and series, formulas over their operands", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				const ids = yield* accounts(world, ["Acme", "Globex"])
				for (const [key, source] of [
					["spans", query("traces")],
					["bytes", query("bytes")],
					["bytes_per_span", formula("{bytes} / {spans}")],
				] as const)
					ok(
						yield* world.call(
							"customers.metric.create",
							{ key, metric: draft(source) },
							world.owner,
						),
					)
				yield* values(world, [
					["Acme", "spans", 0, 10],
					["Acme", "spans", 1, 30],
					["Acme", "bytes", 0, 1_000],
					["Acme", "bytes", 1, 1_000],
					["Acme", "spans", 8, 5],
					["Acme", "bytes", 8, 500],
					["Acme", "spans", 200, 1],
					["Globex", "spans", 3, 0],
				])
				const windows = ok(
					yield* world.call(
						"customers.account.metricWindows",
						{
							accountId: ids.Acme,
							windows: [
								{ metricKey: "spans", days: 7 },
								{ metricKey: "bytes_per_span", days: 7 },
								{ metricKey: "unknown", days: 7 },
								{ metricKey: "mrr", days: 30 },
							],
						},
						world.member,
					),
				).windows
				expect(windows).toEqual([
					{ metricKey: "spans", days: 7, value: 40, previous: 5, lastSeenDay: TODAY },
					// A ratio of sums (2000 / 40), not a sum of ratios.
					{ metricKey: "bytes_per_span", days: 7, value: 50, previous: 100, lastSeenDay: TODAY },
					{ metricKey: "unknown", days: 7, value: null, previous: null, lastSeenDay: null },
					{ metricKey: "mrr", days: 30, value: 0, previous: 0, lastSeenDay: null },
				])
				const old = ok(
					yield* world.call(
						"customers.account.metricWindows",
						{ accountId: ids.Globex, windows: [{ metricKey: "spans", days: 1 }] },
						world.member,
					),
				).windows
				// A zero is a value, but not a day it was seen.
				expect(old).toEqual([
					{ metricKey: "spans", days: 1, value: null, previous: null, lastSeenDay: null },
				])

				const series = ok(
					yield* world.call(
						"customers.account.series",
						{ accountId: ids.Acme, metricKeys: ["bytes_per_span"], range: "7d" },
						world.member,
					),
				).series[0]
				expect(series.points.slice(-2)).toEqual([
					{ day: addDays(TODAY, -1), value: 1_000 / 30 },
					{ day: TODAY, value: 100 },
				])
				// No spans that day: the division has no value.
				expect(series.points[0]).toEqual({ day: addDays(TODAY, -6), value: 0 })

				const coverage = ok(yield* world.call("customers.metrics.coverage", {}, world.member)).metrics
				expect(coverage).toEqual([
					{ metricKey: "bytes", accountsWithData: 1, lastDay: TODAY },
					{ metricKey: "spans", accountsWithData: 1, lastDay: TODAY },
				])

				const preview = ok(
					yield* world.call(
						"customers.metric.preview",
						{ source: formula("{bytes} / {spans}"), aggregation: "sum", days: 2 },
						world.owner,
					),
				)
				expect(preview).toEqual({
					error: null,
					days: 2,
					accountsWithData: 1,
					totalAccounts: 2,
					unmatchedRows: 0,
					top: [{ accountId: ids.Acme, name: "Acme", value: 50 }],
					sample: {
						accountId: ids.Acme,
						name: "Acme",
						points: [
							{ day: addDays(TODAY, -1), value: 1_000 / 30 },
							{ day: TODAY, value: 100 },
						],
					},
				})
				// The Maple connection has no key: a query cannot be tried, which the result says.
				const maple = ok(
					yield* world.call(
						"customers.metric.preview",
						{ source: query("traces"), aggregation: "sum", days: 2 },
						world.owner,
					),
				)
				expect(maple).toMatchObject({
					error: expect.any(String),
					accountsWithData: 0,
					totalAccounts: 2,
				})
				expect(
					ok(
						yield* world.call(
							"customers.metric.preview",
							{ source: formula("{nope}"), aggregation: "sum", days: 2 },
							world.owner,
						),
					).error,
				).toBe("No metric {nope}")
			}),
		))

	it("updates a user metric's source (refilling it) and only the basics of the others", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				yield* accounts(world, ["Acme"])
				ok(
					yield* world.call(
						"customers.metric.create",
						{ key: "spans", metric: draft(query("a")) },
						world.owner,
					),
				)
				ok(
					yield* world.call(
						"customers.metric.create",
						{ key: "half", metric: draft(formula("{spans} / 2")) },
						world.owner,
					),
				)
				yield* values(world, [["Acme", "spans", 0, 10]])
				const update = (metricKey: string, metric: MetricDraft) =>
					world.call("customers.metric.update", { metricKey, metric }, world.owner)
				const stored = () =>
					world.rows(`SELECT value FROM customer_metric_daily WHERE metricKey = 'spans'`)

				// Same SQL: the days stand.
				ok(yield* update("spans", draft(query("a"), { name: "Spans", format: "number" })))
				expect(stored()).toEqual([{ value: 10 }])
				ok(yield* update("spans", draft(query("b"))))
				expect(stored()).toEqual([])
				// A formula reads it: it cannot become one.
				expect(tagOf(yield* update("spans", draft(formula("{half}"))))).toBe(
					"CustomersInvalidRequestError",
				)
				expect(tagOf(yield* update("spans", draft(null)))).toBe("CustomersInvalidRequestError")
				expect(tagOf(yield* update("nope", draft(null)))).toBe("CustomersNotFoundError")

				// Built-ins and a source's own: the basics, never a source.
				expect(tagOf(yield* update("mrr", draft(formula("{spans}"))))).toBe(
					"CustomersInvalidRequestError",
				)
				const mrr = ok(
					yield* update("mrr", draft(null, { name: "Revenue", group: "Billing", unit: "USD" })),
				)
				expect(mrr.data).toMatchObject({
					name: "Revenue",
					group: "Billing",
					unit: "USD",
					source: null,
				})
				yield* world.ingest("autumn", [
					{
						_tag: "metric_definition",
						key: "autumn.seats",
						name: "Seats",
						unit: "seats",
						aggregation: "max",
						description: null,
					},
				])
				ok(
					yield* update(
						"autumn.seats",
						draft(null, { name: "Seats used", unit: "people", format: "number" }),
					),
				)
				// The source defines it again: the person's name and unit stay.
				yield* world.ingest("autumn", [
					{
						_tag: "metric_definition",
						key: "autumn.seats",
						name: "Seats",
						unit: "seats",
						aggregation: "max",
						description: null,
					},
				])
				expect(
					world.rows(
						`SELECT name, unit, customUnit FROM customer_metric_definitions WHERE key = 'autumn.seats'`,
					),
				).toEqual([{ name: "Seats used", unit: "seats", customUnit: "people" }])
			}),
		))

	it("deletes a user metric and its days, unless a formula reads it", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				yield* accounts(world, ["Acme"])
				ok(
					yield* world.call(
						"customers.metric.create",
						{ key: "spans", metric: draft(query("a")) },
						world.owner,
					),
				)
				ok(
					yield* world.call(
						"customers.metric.create",
						{ key: "half", metric: draft(formula("{spans} / 2")) },
						world.owner,
					),
				)
				yield* values(world, [["Acme", "spans", 0, 10]])
				const remove = (metricKey: string, user = world.owner) =>
					world.call("customers.metric.delete", { metricKey }, user)
				expect(tagOf(yield* remove("spans", world.member))).toBe("UnauthorizedError")
				expect(tagOf(yield* remove("spans"))).toBe("CustomersInvalidRequestError")
				expect(tagOf(yield* remove("mrr"))).toBe("CustomersInvalidRequestError")
				expect(tagOf(yield* remove("nope"))).toBe("CustomersNotFoundError")
				ok(yield* remove("half"))
				ok(yield* remove("spans"))
				expect(world.rows(`SELECT count(*) AS n FROM customer_metric_daily`)).toEqual([{ n: 0 }])
				expect(
					world.rows(`SELECT key FROM customer_metric_definitions WHERE key IN ('spans', 'half')`),
				).toEqual([])
			}),
		))
})

describe("Customer Overview layouts", () => {
	it("seeds the default layout, also for an organization from before layouts", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				const defaults = world.rows<{ name: string; widgets: string; rule: string }>(
					`SELECT name, widgets, rule FROM customer_overview_layouts WHERE isDefault = 1`,
				)
				expect(defaults).toHaveLength(1)
				expect(defaults[0]!.name).toBe("Default")
				expect(JSON.parse(defaults[0]!.widgets)).toEqual(DEFAULT_LAYOUT_WIDGETS)
				yield* accounts(world, ["Acme"])
				world.object.storage.db.prepare(`DELETE FROM customer_overview_layouts`).run()
				const ensure = ensureDefaultLayout(world.orgId, new Date())
				yield* world.object.run(ensure).pipe(Effect.orDie)
				yield* world.object.run(ensure).pipe(Effect.orDie)
				expect(counts(world)).toEqual({ Default: 1 })
				expect(layoutOf(world)).toEqual({ Acme: "Default" })
			}),
		))

	it("assigns layouts by rule, order and pin, and keeps their counts", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				const ids = yield* accounts(world, ["Acme", "Globex", "Initech"])
				ok(
					yield* world.call(
						"customers.account.update",
						{ accountId: ids.Acme, tags: ["observability"] },
						world.member,
					),
				)
				const create = (name: string, rule?: unknown, user = world.owner) =>
					world.call("customers.layout.create", { layout: layoutDraft(name, rule) }, user)
				expect(tagOf(yield* create("Observability", tagRule("observability"), world.member))).toBe(
					"UnauthorizedError",
				)
				const observability = ok(yield* create("Observability", tagRule("observability"))).data
				expect(observability.accountCount).toBe(1)
				expect(layoutOf(world)).toEqual({
					Acme: "Observability",
					Globex: "Default",
					Initech: "Default",
				})
				expect(counts(world)).toEqual({ Default: 2, Observability: 1 })

				// New layouts go first: this one takes everyone, Acme included.
				const everyone = ok(yield* create("Everyone")).data
				expect(everyone.position).toBeLessThan(observability.position)
				expect(layoutOf(world)).toEqual({ Acme: "Everyone", Globex: "Everyone", Initech: "Everyone" })
				const reorder = (layoutIds: ReadonlyArray<string>) =>
					world.call("customers.layout.reorder", { layoutIds }, world.owner)
				expect(tagOf(yield* reorder([everyone.id]))).toBe("CustomersInvalidRequestError")
				expect(tagOf(yield* reorder([everyone.id, everyone.id]))).toBe("CustomersInvalidRequestError")
				ok(yield* reorder([observability.id, everyone.id]))
				expect(layoutOf(world)).toEqual({
					Acme: "Observability",
					Globex: "Everyone",
					Initech: "Everyone",
				})

				// Where a draft sits decides what it gets: first, it takes Acme from Observability.
				const dryRun = (position?: number) =>
					world.call(
						"customers.layout.dryRun",
						position === undefined
							? { rule: tagRule("observability") }
							: { rule: tagRule("observability"), position },
						world.owner,
					)
				expect(ok(yield* dryRun())).toEqual({
					matchingCount: 1,
					matching: [{ accountId: ids.Acme, name: "Acme" }],
					takenBy: [],
					effectiveCount: 1,
				})
				expect(ok(yield* dryRun(5))).toMatchObject({
					matchingCount: 1,
					takenBy: [{ layoutId: observability.id, name: "Observability", count: 1 }],
					effectiveCount: 0,
				})

				// A pin wins over the rules; any member may set one, to a live layout or none.
				const pin = (accountId: string, layoutId: string | null) =>
					world.call("customers.account.setLayout", { accountId, layoutId }, world.member)
				ok(yield* pin(ids.Initech, observability.id))
				expect(layoutOf(world).Initech).toBe("Observability")
				expect(counts(world)).toEqual({ Default: 0, Everyone: 1, Observability: 2 })
				expect(tagOf(yield* pin(ids.Initech, crypto.randomUUID()))).toBe("CustomersNotFoundError")
				expect(ok(yield* dryRun())).toMatchObject({
					matchingCount: 1,
					effectiveCount: 1,
				})

				// The default's rule is its fallback's: empty, whatever the draft says.
				const fallback = world.rows<{ id: string }>(
					`SELECT id FROM customer_overview_layouts WHERE isDefault = 1`,
				)[0]!
				const updated = ok(
					yield* world.call(
						"customers.layout.update",
						{ layoutId: fallback.id, layout: layoutDraft("Everything else", tagRule("x")) },
						world.owner,
					),
				).data
				expect(updated).toMatchObject({
					name: "Everything else",
					rule: { match: "all", conditions: [] },
				})
				expect(
					tagOf(
						yield* world.call(
							"customers.layout.update",
							{
								layoutId: everyone.id,
								layout: {
									...layoutDraft("Everyone"),
									widgets: [...layoutDraft("x").widgets, ...layoutDraft("x").widgets],
								},
							},
							world.owner,
						),
					),
				).toBe("CustomersInvalidRequestError")

				// Deleting a layout unpins its customers; the default stays.
				const remove = (layoutId: string) =>
					world.call("customers.layout.delete", { layoutId }, world.owner)
				expect(tagOf(yield* remove(fallback.id))).toBe("CustomersInvalidRequestError")
				ok(yield* remove(observability.id))
				expect(
					world.rows(`SELECT pinnedLayoutId FROM customer_accounts WHERE id = ?`, ids.Initech),
				).toEqual([{ pinnedLayoutId: null }])
				expect(layoutOf(world)).toEqual({ Acme: "Everyone", Globex: "Everyone", Initech: "Everyone" })
				expect(counts(world)).toEqual({ "Everything else": 0, Everyone: 3 })
				expect(tagOf(yield* pin(ids.Initech, observability.id))).toBe("CustomersNotFoundError")
			}),
		))

	it("assigns by metric windows, formulas included", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				yield* accounts(world, ["Acme", "Globex"])
				for (const [key, source] of [
					["spans", query("traces")],
					["bytes", query("bytes")],
					["bytes_per_span", formula("{bytes} / {spans}")],
				] as const)
					ok(
						yield* world.call(
							"customers.metric.create",
							{ key, metric: draft(source) },
							world.owner,
						),
					)
				yield* values(world, [
					["Acme", "spans", 0, 10],
					["Acme", "bytes", 0, 5_000],
					["Globex", "spans", 0, 10],
					["Globex", "bytes", 0, 50],
					// Outside the window.
					["Globex", "bytes", 10, 1_000_000],
				])
				const heavy = {
					match: "all",
					conditions: [
						{ _tag: "metric", metricKey: "bytes_per_span", windowDays: 7, op: "gt", value: 100 },
					],
				}
				ok(
					yield* world.call(
						"customers.layout.create",
						{ layout: layoutDraft("Heavy", heavy) },
						world.owner,
					),
				)
				expect(layoutOf(world)).toEqual({ Acme: "Heavy", Globex: "Default" })
				const active = {
					match: "any",
					conditions: [{ _tag: "metric", metricKey: "spans", windowDays: 30, op: "gt", value: 5 }],
				}
				expect(
					ok(
						yield* world.call(
							"customers.layout.dryRun",
							{ rule: active, position: 10 },
							world.owner,
						),
					),
				).toMatchObject({
					matchingCount: 2,
					takenBy: [{ name: "Heavy", count: 1 }],
					effectiveCount: 1,
				})
			}),
		))
})
