/**
 * The customer Overview's user metrics and layouts in a `CustomersObject`
 * (`docs/customers/overview-layouts.md`): the default layout, metric create/update/delete and their
 * checks, windows and series over formulas, coverage, preview, layout CRUD, pins, reorder, the dry
 * run, and the assignment every change ends with.
 */
import {
	DEFAULT_CONNECTION_CONFIG,
	DEFAULT_LAYOUT_WIDGETS,
	type IngestOp,
	type MetricDraft,
} from "@hazel/domain/customers"
import { Cause, ConfigProvider, Effect, type Exit, Layer, Option, type Scope } from "effect"
import { HttpClient } from "effect/http"
import { CustomerOverviewLayoutId, type CustomerAccountId } from "@hazel/schema"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { IntegrationEncryption } from "../../../services/integration-encryption"
import { encryptSecrets, storeSecrets } from "./credentials"
import { ensureBuiltInFormats } from "./defaults"
import { CustomerIngest } from "./ingest"
import { runDuePullsWith } from "./jobs"
import { ensureDefaultLayout } from "./layouts"
import { fakeMapleHttpClient, makeFakeMaple } from "./maple/testing"
import { previewMetric } from "./metric-preview"
import { loadDefinitions } from "./metric-values"
import { decodeCursor } from "./maple/pull"
import { type CustomerProviderAdapter, CustomerProviders, type PullPage, type UserMetric } from "./providers"
import { type CustomersWorld, makeCustomersWorld, NOW, ok, tagOf, TODAY } from "./test-kit"
import { addDays } from "./time"

const run = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>) =>
	Effect.runPromise(Effect.scoped(effect) as Effect.Effect<A, E>)

/**
 * One clock for the fixtures and the RPCs: `Date` (what Effect's clock reads) is fixed at `NOW` in
 * every test, so no day boundary passes between a fixture and the handler reading it.
 */
beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"], now: NOW })
})
afterEach(() => {
	vi.useRealTimers()
})

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
		) as Record<string, CustomerAccountId>
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
					partial: false,
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
				const ensure = ensureDefaultLayout(world.orgId, NOW)
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
				const reorder = (layoutIds: ReadonlyArray<CustomerOverviewLayoutId>) =>
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
					pinnedElsewhere: 0,
					effectiveCount: 1,
				})
				expect(ok(yield* dryRun(5))).toMatchObject({
					matchingCount: 1,
					takenBy: [{ layoutId: observability.id, name: "Observability", count: 1 }],
					effectiveCount: 0,
				})

				// A pin wins over the rules; any member may set one, to a live layout or none.
				const pin = (accountId: CustomerAccountId, layoutId: CustomerOverviewLayoutId | null) =>
					world.call("customers.account.setLayout", { accountId, layoutId }, world.member)
				ok(yield* pin(ids.Initech, observability.id))
				expect(layoutOf(world).Initech).toBe("Observability")
				expect(counts(world)).toEqual({ Default: 0, Everyone: 1, Observability: 2 })
				expect(
					tagOf(yield* pin(ids.Initech, CustomerOverviewLayoutId.make(crypto.randomUUID()))),
				).toBe("CustomersNotFoundError")
				expect(ok(yield* dryRun())).toMatchObject({
					matchingCount: 1,
					effectiveCount: 1,
				})
				// Pins aside from the rules: one to another layout is counted on its own, one to this
				// layout comes with it whether it matches or not.
				ok(yield* pin(ids.Acme, everyone.id))
				expect(ok(yield* dryRun())).toMatchObject({
					matchingCount: 1,
					takenBy: [],
					pinnedElsewhere: 1,
					effectiveCount: 0,
				})
				expect(
					ok(
						yield* world.call(
							"customers.layout.dryRun",
							{ layoutId: observability.id, rule: tagRule("observability") },
							world.owner,
						),
					),
				).toMatchObject({ matchingCount: 1, pinnedElsewhere: 1, effectiveCount: 1 })
				ok(yield* pin(ids.Acme, null))

				// The default's rule is its fallback's: empty, whatever the draft says.
				const fallback = world.rows<{ id: CustomerOverviewLayoutId }>(
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
				const remove = (layoutId: CustomerOverviewLayoutId) =>
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

/** The credentials' encryption with a test key. */
const encryption = IntegrationEncryption.layer.pipe(
	Layer.provide(
		ConfigProvider.layer(
			ConfigProvider.fromUnknown({ INTEGRATION_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64") }),
		),
	),
)

/** A stored timestamp (`YYYY-MM-DD HH:MM:SS.sss` or ISO) as a `Date`. */
const instant = (value: string) => new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`)

describe("Customer Overview metrics: sources and their data", () => {
	it("reserves Hazel's keys and gives the built-ins their format, also for older organizations", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				for (const key of ["new", "mrr"])
					expect(
						tagOf(
							yield* world.call(
								"customers.metric.create",
								{ key, metric: draft(query("a")) },
								world.owner,
							),
						),
					).toBe("CustomersInvalidRequestError")
				const format = () =>
					world.rows(`SELECT format FROM customer_metric_definitions WHERE key = 'mrr'`)
				expect(format()).toEqual([{ format: "money" }])
				// An organization from before formats: its built-ins take theirs, once.
				world.object.storage.db.prepare(`DELETE FROM _object_meta WHERE key = 'builtInFormats'`).run()
				world.object.storage.db
					.prepare(`UPDATE customer_metric_definitions SET format = 'number'`)
					.run()
				yield* world.object.run(ensureBuiltInFormats()).pipe(Effect.orDie)
				expect(format()).toEqual([{ format: "money" }])
				// An admin's choice afterwards stays, activation after activation.
				ok(
					yield* world.call(
						"customers.metric.update",
						{ metricKey: "mrr", metric: draft(null, { name: "MRR", format: "number" }) },
						world.owner,
					),
				)
				yield* world.object.run(ensureBuiltInFormats()).pipe(Effect.orDie)
				expect(format()).toEqual([{ format: "number" }])
			}),
		))

	it("counts each product event toward one metric only", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				world.object.storage.db
					.prepare(
						`UPDATE customer_connections SET config = json_set(config, '$.metricMappings', json(?)) WHERE provider = 'maple'`,
					)
					.run(JSON.stringify([{ event: "alert_rule_created", metricKey: "alerts" }]))
				const events = (...names: Array<string>) => draft({ _tag: "product_event", events: names })
				const create = (key: string, metric: MetricDraft) =>
					world.call("customers.metric.create", { key, metric }, world.owner)
				ok(yield* create("dashboards", events("dashboard_created")))
				expect(tagOf(yield* create("made", events("dashboard_created")))).toBe(
					"CustomersInvalidRequestError",
				)
				const mapped = yield* create("alerts_made", events("api_key_created", "alert_rule_created"))
				expect(tagOf(mapped)).toBe("CustomersInvalidRequestError")
				// A mapping on the connection may not take a metric's event either.
				const refused = yield* world.call(
					"customers.connection.update",
					{
						connectionId: world.connection("maple"),
						config: {
							...DEFAULT_CONNECTION_CONFIG.maple,
							metricMappings: [{ event: "dashboard_created", metricKey: "made" }],
						},
					},
					world.owner,
				)
				expect(tagOf(refused)).toBe("CustomersInvalidRequestError")
				expect(String(Cause.squash((refused as Exit.Failure<unknown, unknown>).cause))).toContain(
					"dashboard_created (counted by the metric A metric)",
				)
				// Its own events are its own.
				ok(
					yield* world.call(
						"customers.metric.update",
						{ metricKey: "dashboards", metric: events("dashboard_created", "dashboard_shared") },
						world.owner,
					),
				)
			}),
		))

	it("skips Maple values for an unknown customer or a deleted metric instead of parking or redefining them", () =>
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
				const report = yield* world.ingest("maple", [
					{
						_tag: "metric",
						account: { provider: "clerk", externalId: "org_Acme" },
						metricKey: "spans",
						day: TODAY,
						value: 5,
					},
					{
						_tag: "metric",
						account: { provider: "clerk", externalId: "org_nobody" },
						metricKey: "spans",
						day: TODAY,
						value: 5,
					},
					{
						_tag: "metric",
						account: { provider: "clerk", externalId: "org_Acme" },
						metricKey: "deleted",
						day: TODAY,
						value: 5,
					},
				])
				expect(report.outcomes.map((outcome: { _tag: string }) => outcome._tag)).toEqual([
					"Created",
					"Rejected",
					"Rejected",
				])
				expect(world.rows(`SELECT count(*) AS n FROM customer_unmatched_records`)).toEqual([{ n: 0 }])
				expect(
					world.rows(`SELECT key FROM customer_metric_definitions WHERE key = 'deleted'`),
				).toEqual([])
			}),
		))

	it("backfills a metric alone: a newer backfill or a delete ends the older, and the schedule stays", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				const maple = world.connection("maple")
				const runs = () =>
					world.rows<{ status: string; cursor: string | null; error: string | null }>(
						`SELECT status, cursor, error FROM customer_sync_runs WHERE connectionId = ? ORDER BY startedAt, rowid`,
						maple,
					)
				ok(
					yield* world.call(
						"customers.metric.create",
						{ key: "spans", metric: draft(query("a")) },
						world.owner,
					),
				)
				ok(
					yield* world.call(
						"customers.metric.update",
						{ metricKey: "spans", metric: draft(query("b")) },
						world.owner,
					),
				)
				expect(runs().map((row) => row.status)).toEqual(["failed", "running"])
				expect(runs()[0]!.error).toContain("spans was changed or deleted")
				ok(
					yield* world.call(
						"customers.metric.create",
						{ key: "logs", metric: draft(query("logs")) },
						world.owner,
					),
				)
				ok(yield* world.call("customers.metric.delete", { metricKey: "logs" }, world.owner))
				expect(runs().map((row) => row.status)).toEqual(["failed", "running", "failed"])

				// The pull runs the backfill: the connection's own watermark and schedule do not move.
				const lastSuccessAt = new Date(NOW.getTime() - 10 * 60_000)
				world.object.storage.db
					.prepare(`UPDATE customer_connections SET lastSuccessAt = ? WHERE id = ?`)
					.run(lastSuccessAt.toISOString(), maple)
				yield* world.object
					.run(
						Effect.gen(function* () {
							yield* storeSecrets(maple, yield* encryptSecrets("maple_ak_test", null))
						}).pipe(Effect.provide(encryption)),
					)
					.pipe(Effect.orDie)
				const asked: Array<{ cursor: string | null; metrics: ReadonlyArray<UserMetric> }> = []
				const adapter: CustomerProviderAdapter = {
					provider: "maple",
					validate: () =>
						Effect.succeed({ externalAccountId: "org:us", externalAccountName: null }),
					webhook: () => Effect.succeed([]),
					pull: ({ cursor, metrics }) => {
						asked.push({ cursor, metrics })
						return Effect.succeed({
							ops: [],
							nextCursor: null,
							progress: { step: "queries", done: 0, total: null },
							metricRuns: [{ key: "spans", error: null }],
						})
					},
					pullIntervalMs: 60 * 60_000,
				}
				const services = Layer.mergeAll(
					CustomerIngest.layer,
					encryption,
					Layer.succeed(
						CustomerProviders,
						CustomerProviders.of({
							get: (provider) => (provider === "maple" ? Option.some(adapter) : Option.none()),
						}),
					),
				)
				yield* world.object.run(runDuePullsWith(services)(NOW)).pipe(Effect.orDie)
				expect(asked).toHaveLength(1)
				expect(decodeCursor(asked[0]!.cursor ?? "")).toMatchObject({ value: { only: "spans" } })
				expect(asked[0]!.metrics.map((metric) => metric.key)).toEqual(["spans"])
				expect(runs().map((row) => row.status)).toEqual(["failed", "succeeded", "failed"])
				const connection = world.rows<{ lastSuccessAt: string; nextSyncAt: string }>(
					`SELECT lastSuccessAt, nextSyncAt FROM customer_connections WHERE id = ?`,
					maple,
				)[0]!
				expect(instant(connection.lastSuccessAt).getTime()).toBe(lastSuccessAt.getTime())
				expect(instant(connection.nextSyncAt).getTime()).toBe(lastSuccessAt.getTime() + 60 * 60_000)
				expect(
					world.rows<{ lastRunAt: string | null }>(
						`SELECT lastRunAt FROM customer_metric_definitions WHERE key = 'spans'`,
					)[0]!.lastRunAt,
				).not.toBeNull()
			}),
		))
})

/** An account ref Maple's metrics resolve through (`provider` × `externalId` → the account). */
const addRef = (world: CustomersWorld, provider: "clerk" | "maple", externalId: string, accountId: string) =>
	world.object.storage.db
		.prepare(
			`INSERT INTO customer_external_refs (id, connectionId, provider, entityType, entityId, accountId, externalId, matchMethod)
			 VALUES (?, ?, ?, 'account', ?, ?, ?, 'manual')`,
		)
		.run(crypto.randomUUID(), world.connection(provider), provider, accountId, accountId, externalId)

/** The Maple connection with a key and a validated account, as a pull needs it. */
const withMapleKey = (world: CustomersWorld) =>
	Effect.gen(function* () {
		const maple = world.connection("maple")
		world.object.storage.db
			.prepare(`UPDATE customer_connections SET externalAccountId = 'org:us' WHERE id = ?`)
			.run(maple)
		yield* world.object
			.run(
				Effect.gen(function* () {
					yield* storeSecrets(maple, yield* encryptSecrets("maple_ak_test", null))
				}).pipe(Effect.provide(encryption)),
			)
			.pipe(Effect.orDie)
	})

/** Run the due pulls now, the Maple connection's pages answered by `page`. */
const pullMaple = (world: CustomersWorld, page: () => PullPage) =>
	Effect.gen(function* () {
		world.object.storage.db
			.prepare(`UPDATE customer_connections SET nextSyncAt = '2000-01-01 00:00:00.000' WHERE id = ?`)
			.run(world.connection("maple"))
		const adapter: CustomerProviderAdapter = {
			provider: "maple",
			validate: () => Effect.succeed({ externalAccountId: "org:us", externalAccountName: null }),
			webhook: () => Effect.succeed([]),
			pull: () => Effect.sync(page),
			pullIntervalMs: 60 * 60_000,
		}
		const services = Layer.mergeAll(
			CustomerIngest.layer,
			encryption,
			Layer.succeed(
				CustomerProviders,
				CustomerProviders.of({
					get: (provider) => (provider === "maple" ? Option.some(adapter) : Option.none()),
				}),
			),
		)
		yield* world.object.run(runDuePullsWith(services)(new Date())).pipe(Effect.orDie)
	})

/** Maple's value of `spans` today for the customer with this Clerk id. */
const spansOf = (externalId: string, value: number): IngestOp => ({
	_tag: "metric",
	account: { provider: "clerk", externalId },
	metricKey: "spans",
	day: TODAY,
	value,
})

describe("Customer Overview: reads, writes and pulls agree", () => {
	it("drops a page's values when its metric's data changed while the page was out, not on a reformat", () =>
		run(
			Effect.gen(function* () {
				for (const [edit, landed] of [
					[query("b"), 0],
					// Only whitespace: the same data, as the save path also treats it (no backfill restart).
					[{ ...query("a"), sql: `  ${SQL("a").replace(/\n/g, "\n\t")}  ` }, 1],
				] as const) {
					const world = yield* makeCustomersWorld
					yield* accounts(world, ["Acme"])
					ok(
						yield* world.call(
							"customers.metric.create",
							{ key: "spans", metric: draft(query("a")) },
							world.owner,
						),
					)
					yield* withMapleKey(world)
					yield* pullMaple(world, () => {
						// Someone saves the metric while Maple answers the old query.
						world.object.storage.db
							.prepare(`UPDATE customer_metric_definitions SET source = ? WHERE key = 'spans'`)
							.run(JSON.stringify(edit))
						return {
							ops: [spansOf("org_Acme", 5)],
							nextCursor: null,
							progress: { step: "queries", done: 1, total: null },
						}
					})
					expect(world.rows(`SELECT count(*) AS n FROM customer_metric_daily`)).toEqual([
						{ n: landed },
					])
				}
			}),
		))

	it("keeps a run's first refused day on the metric until a later run reads it", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				ok(
					yield* world.call(
						"customers.metric.create",
						{ key: "spans", metric: draft(query("a")) },
						world.owner,
					),
				)
				// The metric's own backfill run is not the one this test walks.
				world.object.storage.db.prepare(`DELETE FROM customer_sync_runs`).run()
				yield* withMapleKey(world)
				const lastError = () =>
					world.rows<{ lastError: string | null }>(
						`SELECT lastError FROM customer_metric_definitions WHERE key = 'spans'`,
					)[0]!.lastError
				const pages: Array<string | null> = ["Maple could not run this query", null]
				yield* pullMaple(world, () => {
					const error = pages.shift() ?? null
					return {
						ops: [],
						nextCursor: pages.length > 0 ? "next" : null,
						progress: { step: "queries", done: 0, total: null },
						metricRuns: [{ key: "spans", error }],
					}
				})
				expect(lastError()).toBe("Maple could not run this query")
				// The next run reads it cleanly: the failure was an earlier run's.
				vi.setSystemTime(NOW.getTime() + 2 * 60 * 60_000)
				yield* pullMaple(world, () => ({
					ops: [],
					nextCursor: null,
					progress: { step: "queries", done: 0, total: null },
					metricRuns: [{ key: "spans", error: null }],
				}))
				expect(lastError()).toBeNull()
			}),
		))

	it("resolves a query's customer through its Clerk ref, else the Maple ref of the same id", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				const ids = yield* accounts(world, ["Acme", "Globex"])
				ok(
					yield* world.call(
						"customers.metric.create",
						{ key: "spans", metric: draft(query("a")) },
						world.owner,
					),
				)
				addRef(world, "maple", "grp_globex", ids.Globex)
				const report = yield* world.ingest("maple", [
					{
						_tag: "metric",
						account: { provider: "clerk", externalId: "grp_globex" },
						metricKey: "spans",
						day: TODAY,
						value: 7,
					},
				])
				expect(report.outcomes.map((outcome: { _tag: string }) => outcome._tag)).toEqual(["Created"])
				expect(world.rows(`SELECT accountId, value FROM customer_metric_daily`)).toEqual([
					{ accountId: ids.Globex, value: 7 },
				])
			}),
		))

	it("previews a Maple query through the connection's key: ids resolved as ingest does, a cut day marked partial", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				const ids = yield* accounts(world, ["Acme", "Globex"])
				const maple = world.connection("maple")
				world.object.storage.db
					.prepare(
						`UPDATE customer_connections SET externalAccountId = 'org_maple:us' WHERE id = ?`,
					)
					.run(maple)
				yield* world.object
					.run(
						Effect.gen(function* () {
							yield* storeSecrets(
								maple,
								yield* encryptSecrets("maple_ak_fake0000000000000000", null),
							)
						}).pipe(Effect.provide(encryption)),
					)
					.pipe(Effect.orDie)
				// A Maple ref of Acme's Clerk id names Globex: the query's id is Clerk's, so Acme.
				addRef(world, "maple", "org_Acme", ids.Globex)
				addRef(world, "maple", "grp_globex", ids.Globex)
				const fake = makeFakeMaple({
					renderedRows: 2,
					metricDays: [
						{ day: TODAY, account: "org_Acme", value: 10 },
						{ day: TODAY, account: "grp_globex", value: 5 },
						{ day: TODAY, account: "org_none", value: 1 },
					],
				})
				const preview = yield* world.object
					.run(
						Effect.gen(function* () {
							return yield* previewMetric(
								{ source: query("a"), aggregation: "sum", days: 1 },
								yield* loadDefinitions,
								yield* HttpClient.HttpClient,
								NOW,
							)
						}).pipe(Effect.provide(fakeMapleHttpClient(fake)), Effect.provide(encryption)),
					)
					.pipe(Effect.orDie)
				expect(preview).toMatchObject({
					error: null,
					partial: true,
					accountsWithData: 2,
					unmatchedRows: 0,
					top: [
						{ accountId: ids.Acme, value: 10 },
						{ accountId: ids.Globex, value: 5 },
					],
				})
			}),
		))

	it("ranks a formula preview by its ratio over the days, even with no day holding both operands", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				const ids = yield* accounts(world, ["Acme"])
				for (const [key, source] of [
					["spans", query("a")],
					["bytes", query("b")],
				] as const)
					ok(
						yield* world.call(
							"customers.metric.create",
							{ key, metric: draft(source) },
							world.owner,
						),
					)
				yield* values(world, [
					["Acme", "bytes", 0, 100],
					["Acme", "spans", 1, 4],
				])
				const preview = ok(
					yield* world.call(
						"customers.metric.preview",
						{ source: formula("{bytes} / {spans}"), aggregation: "sum", days: 2 },
						world.owner,
					),
				)
				expect(preview).toMatchObject({
					accountsWithData: 0,
					top: [{ accountId: ids.Acme, value: 25 }],
					partial: false,
				})
			}),
		))

	it("reads a health score rule from the scored days, as the Overview does", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				const ids = yield* accounts(world, ["Acme", "Globex"])
				const score = world.object.storage.db.prepare(
					`INSERT INTO customer_health_daily (accountId, day, score, status, breakdown) VALUES (?, ?, ?, 'healthy', '{}')`,
				)
				score.run(ids.Acme, addDays(TODAY, -3), 80)
				score.run(ids.Globex, addDays(TODAY, -2), 90)
				score.run(ids.Globex, addDays(TODAY, -1), 40)
				// Health stays on the account's own column too; the rule reads the days.
				world.object.storage.db.prepare(`UPDATE customer_accounts SET healthScore = 99`).run()
				const healthy = {
					match: "all",
					conditions: [
						{ _tag: "metric", metricKey: "health_score", windowDays: 7, op: "gt", value: 50 },
					],
				}
				ok(
					yield* world.call(
						"customers.layout.create",
						{ layout: layoutDraft("Healthy", healthy) },
						world.owner,
					),
				)
				expect(layoutOf(world)).toEqual({ Acme: "Healthy", Globex: "Default" })
			}),
		))

	it("keeps layout positions apart and at most 100 layouts besides the default", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				const create = (name: string, position?: number) =>
					world.call(
						"customers.layout.create",
						position === undefined
							? { layout: layoutDraft(name) }
							: { layout: layoutDraft(name), position },
						world.owner,
					)
				ok(yield* create("First", 5))
				expect(tagOf(yield* create("Same", 5))).toBe("CustomersInvalidRequestError")
				const insert = world.object.storage.db.prepare(
					`INSERT INTO customer_overview_layouts (id, organizationId, name, position) VALUES (?, ?, ?, ?)`,
				)
				for (let index = 0; index < 99; index++)
					insert.run(crypto.randomUUID(), world.orgId, `L${index}`, 10 + index)
				expect(tagOf(yield* create("One too many"))).toBe("CustomersInvalidRequestError")
			}),
		))

	it("asks for a compute when tags change, so layouts follow", () =>
		run(
			Effect.gen(function* () {
				const world = yield* makeCustomersWorld
				const ids = yield* accounts(world, ["Acme"])
				const due = () =>
					Number(
						world.rows<{ value: string }>(
							`SELECT value FROM _object_meta WHERE key = 'computeDueAt'`,
						)[0]?.value,
					)
				const later = () =>
					world.object.storage.db
						.prepare(
							`INSERT OR REPLACE INTO _object_meta (key, value) VALUES ('computeDueAt', ?)`,
						)
						.run(String(NOW.getTime() + 86_400_000))
				later()
				ok(
					yield* world.call(
						"customers.account.update",
						{ accountId: ids.Acme, tags: ["observability"] },
						world.member,
					),
				)
				expect(due()).toBeLessThanOrEqual(NOW.getTime() + 2 * 60_000)
				later()
				ok(
					yield* world.call(
						"customers.account.bulkUpdate",
						{ accountIds: [ids.Acme], removeTags: ["observability"] },
						world.member,
					),
				)
				expect(due()).toBeLessThanOrEqual(NOW.getTime() + 2 * 60_000)
			}),
		))
})
