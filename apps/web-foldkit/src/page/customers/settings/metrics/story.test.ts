import { mapleBuilderSql } from "@hazel/domain/customers"
import { OrganizationId, OrganizationMemberId, UserId } from "@hazel/schema"
import { Option, Schema } from "effect"
import { describe, expect, test, vi } from "vitest"
import { AppRoute, type MetricSourceKind } from "../../../../route"
import { COVERAGE, LAYOUTS, METRICS, previewOf } from "../../../../lab/fixtures/customers-metrics"
import type { Shared } from "../../../contract"
import { sharedDefaults } from "../../../test-shared"
import { CreateMetric, DeleteMetric, FetchMetricCoverage, PreviewMetric, UpdateMetric } from "./commands"
import { layoutsUsing } from "./form"
import { Message } from "./message"
import type { Model } from "./model"
import { init, type MetricsRoute, routeChanged, update } from "./update"

// `ui/aria/*` names `document` when its modules load; the update loop never touches it.
vi.hoisted(() => {
	Object.assign(globalThis, { document: globalThis.document ?? {} })
})

/** Update-loop tests for the metrics settings: the catalog, the editor's form and checks, saving, the preview. */

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const organizationId = Schema.decodeSync(OrganizationId)(uuid(1))

const sharedAs = (role: "admin" | "member"): Shared => ({
	auth: "SignedIn",
	orgSlug: "hazel",
	currentUser: {
		id: Schema.decodeSync(UserId)(uuid(4)),
		firstName: "Ada",
		lastName: "Lovelace",
		email: "ada@hazel.test",
		avatarUrl: null,
		isOnboarded: true,
	},
	organization: { id: organizationId, name: "Hazel", slug: "hazel", logoUrl: null },
	member: { id: Schema.decodeSync(OrganizationMemberId)(uuid(5)), role },
	nowMs: Date.UTC(2026, 10, 10, 12),
	...sharedDefaults,
})
const admin = sharedAs("admin")
const member = sharedAs("member")

const catalog = AppRoute.CustomersSettingsMetrics({ orgSlug: "hazel" }) as MetricsRoute
const metricRoute = (metricKey: string) =>
	AppRoute.CustomersSettingsMetric({ orgSlug: "hazel", metricKey }) as MetricsRoute
const newRoute = (key: string | null, source: MetricSourceKind | null = null) =>
	AppRoute.CustomersSettingsMetricNew({
		orgSlug: "hazel",
		key: Option.fromNullishOr(key),
		source: Option.fromNullishOr(source),
	}) as MetricsRoute

const run = (model: Model, messages: ReadonlyArray<Message>, shared = admin): Model =>
	messages.reduce((current, message) => update(current, message, shared).model, model)

const loaded = (): Model =>
	run(init(catalog, admin).model, [
		Message.UpdatedMetrics({ metrics: METRICS }),
		Message.UpdatedLayouts({ layouts: LAYOUTS }),
		Message.SucceededFetchCoverage({ metrics: COVERAGE }),
	])

const open = (route: MetricsRoute, shared = admin): Model => routeChanged(loaded(), route, shared).model
const formOf = (model: Model) => model.editor?.form ?? null
const commandsOf = (model: Model, message: Message, shared = admin) =>
	(update(model, message, shared).commands ?? []).map((command) => [command.name, command.args])

describe("metrics catalog", () => {
	test("asks for coverage on opening, and counts the layouts naming each metric", () => {
		const opened = init(catalog, admin)
		expect(opened.commands?.map((command) => command.name)).toEqual([FetchMetricCoverage.name])
		const model = loaded()
		expect(model.coverage._tag).toBe("Success")
		// Spans by a stat; MCP tool calls through the "Feature usage" group's table; bytes per span by none.
		expect(layoutsUsing(model.layouts, METRICS, "spans_ingested").map((layout) => layout.name)).toEqual([
			"Observability",
		])
		expect(layoutsUsing(model.layouts, METRICS, "mcp_tool_calls")).toHaveLength(1)
		expect(layoutsUsing(model.layouts, METRICS, "bytes_per_span")).toHaveLength(0)
	})
})

describe("metric editor", () => {
	test("a suggested key prefills its draft; `source` picks the tab", () => {
		const suggested = formOf(open(newRoute("spans_ingested")))
		expect(suggested).toMatchObject({
			name: "Spans ingested",
			key: "spans_ingested",
			kind: "maple_query",
			group: "Ingest",
		})
		expect(formOf(open(newRoute("my_metric", "formula")))).toMatchObject({
			key: "my_metric",
			kind: "formula",
			name: "",
		})
	})

	test("the key follows the name until typed, and must be new and well-formed", () => {
		const named = run(open(newRoute(null)), [Message.ChangedName({ value: "Log bytes (EU)" })])
		expect(formOf(named)?.key).toBe("log_bytes_eu")
		const typed = run(named, [
			Message.ChangedKey({ value: "logs.eu" }),
			Message.ChangedName({ value: "Other" }),
		])
		expect(formOf(typed)?.key).toBe("logs.eu")
		const taken = run(open(newRoute("spans_ingested")), [])
		expect(commandsOf(taken, Message.PressedSave())).toEqual([])
		const bad = run(named, [Message.ChangedKey({ value: "9lives" })])
		expect(commandsOf(bad, Message.PressedSave())).toEqual([])
		// `new` is the editor's own path; `health_score` a built-in's key.
		for (const reserved of ["new", "health_score"]) {
			expect(
				commandsOf(run(named, [Message.ChangedKey({ value: reserved })]), Message.PressedSave()),
			).toEqual([])
		}
	})

	test('an "in" filter needs a value besides commas; a trailing comma is fine', () => {
		const named = run(open(newRoute(null)), [Message.ChangedName({ value: "Signals" })])
		const withIn = (value: string) =>
			run(named, [
				Message.ChangedFilter({ index: 0, filter: { field: "Attributes.signal", op: "in", value } }),
			])
		expect(commandsOf(withIn(" , "), Message.PressedSave())).toEqual([])
		expect(commandsOf(withIn("logs, traces,"), Message.PressedSave()).map(([name]) => name)).toEqual([
			CreateMetric.name,
		])
	})

	test("a create's answer reaches only the editor that asked", () => {
		const asked = update(
			run(open(newRoute(null, "product_event")), [
				Message.ChangedName({ value: "Exports" }),
				Message.ChangedEvent({ index: 0, value: "export_started" }),
			]),
			Message.PressedSave(),
			admin,
		)
		expect(asked.commands?.[0]?.name).toBe(CreateMetric.name)
		const editorId = (asked.commands?.[0]?.args as { editorId: number } | undefined)?.editorId ?? -1
		expect(asked.model.editor?.isSaving).toBe(true)

		// Another new-metric editor opened meanwhile: it neither navigates nor stops saving.
		const other = routeChanged(asked.model, newRoute(null), admin).model
		const otherSaving = {
			...other,
			editor: other.editor === null ? null : { ...other.editor, isSaving: true },
		}
		const stray = update(
			otherSaving,
			Message.SucceededCreateMetric({ editorId, metricKey: "exports", backfills: true }),
			admin,
		)
		expect(stray.outMessage).toMatchObject({ _tag: "RequestedToast" })
		expect(stray.model.editor?.isSaving).toBe(true)
		const strayFailure = update(
			otherSaving,
			Message.FailedCreateMetric({ editorId, reason: "Unexpected", detail: null }),
			admin,
		)
		expect(strayFailure.model.editor?.isSaving).toBe(true)

		const own = update(
			asked.model,
			Message.SucceededCreateMetric({ editorId, metricKey: "exports", backfills: true }),
			admin,
		)
		expect(own.outMessage).toMatchObject({
			_tag: "RequestedNavigation",
			route: { _tag: "CustomersSettingsMetric", metricKey: "exports" },
		})
		expect(own.model.editor?.isSaving).toBe(false)
	})

	test("creates a builder query with its SQL, and an SQL-only one without a builder", () => {
		const filled = run(open(newRoute(null)), [
			Message.ChangedName({ value: "Log bytes" }),
			Message.ChangedFilter({ index: 0, filter: { field: "MetricName", op: "eq", value: "logs" } }),
		])
		const [[name, args]] = commandsOf(filled, Message.PressedSave()) as [
			[string, { metric: { source: unknown } }],
		]
		expect(name).toBe(CreateMetric.name)
		const builder = {
			table: "metrics_sum",
			filters: [{ field: "MetricName", op: "eq", value: "logs" }],
			value: "sum",
			customerField: "Attributes.org_id",
		} as const
		expect(args).toMatchObject({
			key: "log_bytes",
			metric: {
				name: "Log bytes",
				source: { _tag: "maple_query", sql: mapleBuilderSql(builder), builder },
			},
		})

		const sql = run(filled, [Message.PressedEditSql()])
		expect(formOf(sql)?.sql).toBe(mapleBuilderSql(builder))
		const ordered = run(sql, [
			Message.ChangedSql({ value: `${mapleBuilderSql(builder)}\nORDER BY value` }),
		])
		expect(commandsOf(ordered, Message.PressedSave())).toEqual([])
		const [[, sqlArgs]] = commandsOf(sql, Message.PressedSave()) as [[string, unknown]]
		expect(sqlArgs).toMatchObject({ metric: { source: { _tag: "maple_query", builder: null } } })
	})

	test("SQL typed by hand survives a visit to the builder; a long description is refused", () => {
		const typed = `${mapleBuilderSql({
			table: "logs",
			filters: [],
			value: "count",
			customerField: "ResourceAttributes.org_id",
		})}`
		const sql = run(open(newRoute(null)), [
			Message.ChangedName({ value: "Log lines" }),
			Message.PressedEditSql(),
			Message.ChangedSql({ value: typed }),
			Message.PressedUseBuilder(),
			Message.PressedEditSql(),
		])
		expect(formOf(sql)?.sql).toBe(typed)

		const long = run(sql, [Message.ChangedDescription({ value: "x".repeat(501) })])
		expect(commandsOf(long, Message.PressedSave())).toEqual([])
	})

	test("saving a metric deleted meanwhile says so instead of doing nothing", () => {
		const editing = open(metricRoute("services_reporting"))
		expect(formOf(editing)).not.toBeNull()
		const gone = run(editing, [
			Message.UpdatedMetrics({
				metrics: METRICS.filter((metric) => metric.key !== "services_reporting"),
			}),
		])
		const result = update(gone, Message.PressedSave(), admin)
		expect(result.commands ?? []).toEqual([])
		expect(result.outMessage?._tag).toBe("RequestedToast")
	})

	test("a product event metric drops blank names; a formula refuses unknown metrics", () => {
		const events = run(open(newRoute(null, "product_event")), [
			Message.ChangedName({ value: "Exports" }),
			Message.ChangedEvent({ index: 0, value: "export_started" }),
			Message.PressedAddEvent(),
		])
		expect(commandsOf(events, Message.PressedSave())[0]?.[1]).toMatchObject({
			metric: { source: { _tag: "product_event", events: ["export_started"] } },
		})
		const formula = run(open(newRoute(null, "formula")), [
			Message.ChangedName({ value: "Ratio" }),
			Message.ChangedExpression({ value: "{logs_ingested_bytes} / {nope}" }),
		])
		expect(commandsOf(formula, Message.PressedSave())).toEqual([])
		const fixed = run(formula, [
			Message.ChangedExpression({ value: "" }),
			Message.PressedInsertMetric({ key: "spans_ingested" }),
		])
		expect(formOf(fixed)?.expression).toBe("{spans_ingested}")
		expect(commandsOf(fixed, Message.PressedSave())[0]?.[1]).toMatchObject({
			metric: { source: { _tag: "formula", expression: "{spans_ingested}" } },
		})
	})

	test("a source's own metric saves its basics only", () => {
		const renamed = run(open(metricRoute("autumn.api_calls")), [
			Message.ChangedName({ value: "API requests" }),
		])
		expect(commandsOf(renamed, Message.PressedSave())).toEqual([
			[
				UpdateMetric.name,
				{
					organizationId,
					metricKey: "autumn.api_calls",
					metric: {
						name: "API requests",
						description: "Metered by Autumn",
						group: null,
						unit: "calls",
						format: "number",
						aggregation: "sum",
						source: null,
					},
					backfills: false,
				},
			],
		])
	})

	test("the editor opened before the metrics synced fills its form when they arrive", () => {
		const early = init(metricRoute("spans_ingested"), admin).model
		expect(formOf(early)).toBeNull()
		expect(formOf(run(early, [Message.UpdatedMetrics({ metrics: METRICS })]))?.name).toBe(
			"Spans ingested",
		)
	})

	test("any edit clears the preview, and an answer for the old source is dropped", () => {
		const result = previewOf({ _tag: "formula", expression: "{a}" }, 7)
		const asked = update(
			open(metricRoute("logs_ingested_bytes")),
			Message.PressedRunPreview(),
			admin,
		).model
		const run = asked.editor?.previewRun ?? 0
		const answered = update(asked, Message.SucceededPreviewMetric({ run, result }), admin).model
		expect(answered.editor?.preview._tag).toBe("Success")
		for (const edit of [
			Message.ClickedTable({ table: "logs" }),
			Message.ClickedAggregation({ aggregation: "max" }),
			Message.ClickedFormat({ format: "number" }),
		]) {
			expect(update(answered, edit, admin).model.editor?.preview._tag).toBe("Idle")
		}
		// Edited while the run was in flight: its answer no longer applies.
		const edited = update(
			asked,
			Message.ChangedFilter({
				index: 1,
				filter: { field: "Attributes.signal", op: "eq", value: "traces" },
			}),
			admin,
		).model
		const late = update(edited, Message.SucceededPreviewMetric({ run, result }), admin).model
		expect(late.editor?.preview._tag).toBe("Idle")
	})

	test("over-long formula, SQL and event names are field errors that block Save", () => {
		const formula = run(open(newRoute(null, "formula")), [
			Message.ChangedName({ value: "Long" }),
			Message.ChangedExpression({ value: `{spans_ingested}${" + 1".repeat(130)}` }),
		])
		expect(commandsOf(formula, Message.PressedSave())).toEqual([])
		const sql = run(open(newRoute("metric_points_ingested")), [
			Message.PressedEditSql(),
			Message.ChangedSql({
				value: mapleBuilderSql({
					table: "logs",
					filters: [],
					value: "count",
					customerField: "Attributes.org_id",
				}).replace("GROUP BY", `AND Body != '${"x".repeat(8000)}'\nGROUP BY`),
			}),
		])
		expect(commandsOf(sql, Message.PressedSave())).toEqual([])
		const events = run(open(newRoute(null, "product_event")), [
			Message.ChangedName({ value: "Events" }),
			Message.ChangedEvent({ index: 0, value: "e".repeat(121) }),
		])
		expect(commandsOf(events, Message.PressedSave())).toEqual([])
		expect(
			commandsOf(
				run(events, [Message.ChangedEvent({ index: 0, value: "e".repeat(120) })]),
				Message.PressedSave(),
			),
		).toHaveLength(1)
	})

	test("the save toast promises a backfill only for a new or changed Maple source", () => {
		const backfillsOf = (model: Model) =>
			(
				update(model, Message.PressedSave(), admin).commands?.[0]?.args as
					| { backfills: boolean }
					| undefined
			)?.backfills
		expect(backfillsOf(open(newRoute("metric_points_ingested")))).toBe(true)
		const logs = open(metricRoute("logs_ingested_bytes"))
		expect(backfillsOf(run(logs, [Message.ChangedName({ value: "Logs" })]))).toBe(false)
		expect(backfillsOf(run(logs, [Message.ClickedTable({ table: "logs" })]))).toBe(true)
		expect(
			backfillsOf(
				run(open(metricRoute("autumn.api_calls")), [Message.ChangedName({ value: "Calls" })]),
			),
		).toBe(false)
		expect(
			backfillsOf(
				run(open(newRoute(null, "formula")), [
					Message.ChangedName({ value: "Ratio" }),
					Message.ChangedExpression({ value: "{spans_ingested} / 2" }),
				]),
			),
		).toBe(false)

		const saved = (backfills: boolean) =>
			update(
				logs,
				Message.SucceededUpdateMetric({ metricKey: "logs_ingested_bytes", backfills }),
				admin,
			).outMessage
		expect(saved(false)).toMatchObject({ toast: { title: "Metric saved", description: null } })
		expect(saved(true)).toMatchObject({ toast: { description: expect.stringContaining("Maple") } })
	})

	test("runs the preview and keeps only the latest answer", () => {
		const opened = open(metricRoute("logs_ingested_bytes"))
		const first = update(opened, Message.PressedRunPreview(), admin)
		expect(first.commands?.[0]).toMatchObject({ name: PreviewMetric.name, args: { aggregation: "sum" } })
		const second = update(first.model, Message.PressedRunPreview(), admin).model
		const stale = run(second, [
			Message.SucceededPreviewMetric({
				run: first.model.editor?.previewRun ?? 0,
				result: previewOf({ _tag: "formula", expression: "{a}" }, 7),
			}),
		])
		expect(stale.editor?.preview._tag).not.toBe("Success")
		const answered = run(second, [
			Message.SucceededPreviewMetric({
				run: second.editor?.previewRun ?? 0,
				result: previewOf({ _tag: "formula", expression: "{a}" }, 7),
			}),
		])
		expect(answered.editor?.preview._tag).toBe("Success")
	})

	test("deletes after the confirmation and returns to the catalog; members change nothing", () => {
		const asked = run(open(metricRoute("dashboards_created")), [Message.PressedDelete()])
		expect(commandsOf(asked, Message.PressedConfirmDelete())).toEqual([
			[DeleteMetric.name, { organizationId, metricKey: "dashboards_created" }],
		])
		const deleting = run(asked, [Message.PressedConfirmDelete()])
		const done = update(
			deleting,
			Message.SucceededDeleteMetric({ metricKey: "dashboards_created" }),
			admin,
		)
		expect(done.outMessage).toMatchObject({
			_tag: "RequestedNavigation",
			route: { _tag: "CustomersSettingsMetrics" },
		})

		// A refusal shows the store's reason.
		const refused = update(
			deleting,
			Message.FailedDeleteMetric({
				metricKey: "dashboards_created",
				reason: "Invalid",
				detail: "Formula Ratio uses it",
			}),
			admin,
		)
		expect(refused.outMessage).toMatchObject({
			_tag: "RequestedToast",
			toast: { description: "Formula Ratio uses it" },
		})
		expect(refused.model.editor?.isDeleting).toBe(false)

		expect(commandsOf(asked, Message.PressedConfirmDelete(), member)).toEqual([])
		const renamed = run(
			open(metricRoute("spans_ingested"), member),
			[Message.ChangedName({ value: "x" })],
			member,
		)
		expect(commandsOf(renamed, Message.PressedSave(), member)).toEqual([])
		expect(commandsOf(renamed, Message.PressedRunPreview(), member)).toEqual([])
	})
})
