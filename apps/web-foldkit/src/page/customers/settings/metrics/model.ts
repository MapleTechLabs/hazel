import * as Customers from "@hazel/domain/customers"
import { CustomerMetricDefinitionId } from "@hazel/schema"
import { Schema } from "effect"
import * as AsyncData from "foldkit/asyncData"
import { CommonReason } from "~/lib/error-messages"
import { LayoutRow } from "../../../../customers/overview/rows"
import { MetricSourceKind } from "../../../../route"
import * as Modal from "../../../../ui/modal"

/**
 * Metrics settings (`docs/customers/overview-layouts.md`, "Metrics"): the catalog of every metric
 * the org has, and the editor for one (new or existing) with a preview over the last days. One
 * page instance per org, so moving between the catalog and the editor keeps the live rows.
 */

// ROWS

/** A metric definition as the page keeps it: the synced row, dates as epoch ms, the shown unit. */
export const MetricRow = Schema.Struct({
	id: CustomerMetricDefinitionId,
	key: Schema.String,
	name: Schema.String,
	description: Schema.NullOr(Schema.String),
	/** The user's unit over the source's. */
	unit: Schema.NullOr(Schema.String),
	provider: Schema.NullOr(Customers.CustomerProvider),
	builtIn: Schema.Boolean,
	group: Schema.NullOr(Schema.String),
	format: Customers.MetricFormat,
	aggregation: Customers.MetricAggregation,
	/** Null: a source's own metric or a built-in, whose data Hazel does not define. */
	source: Schema.NullOr(Customers.MetricSource),
	lastRunAtMs: Schema.NullOr(Schema.Number),
	lastError: Schema.NullOr(Schema.String),
})
export type MetricRow = typeof MetricRow.Type

export const CoverageRow = Schema.Struct({
	metricKey: Schema.String,
	accountsWithData: Schema.Int,
	lastDay: Schema.NullOr(Schema.String),
})
export type CoverageRow = typeof CoverageRow.Type

export const Coverage = AsyncData.Schema(Schema.Array(CoverageRow), CommonReason)
export type Coverage = typeof Coverage.schema.Type

// THE EDITOR'S FORM

/** A builder filter as typed (the field may still be empty). */
export const FilterForm = Schema.Struct({
	field: Schema.String,
	op: Schema.Literals(["eq", "neq", "in"]),
	value: Schema.String,
})
export type FilterForm = typeof FilterForm.Type

export const BuilderForm = Schema.Struct({
	table: Customers.MapleQueryTable,
	filters: Schema.Array(FilterForm),
	value: Schema.Literals(["sum", "count", "uniq"]),
	/** The column `uniq` counts; ignored otherwise. */
	valueField: Schema.String,
	customerField: Schema.String,
})
export type BuilderForm = typeof BuilderForm.Type

/** Every source's fields stay while another tab is open: switching tabs loses nothing. */
export const MetricForm = Schema.Struct({
	name: Schema.String,
	key: Schema.String,
	/** The key was typed: it no longer follows the name. */
	isKeyEdited: Schema.Boolean,
	description: Schema.String,
	group: Schema.String,
	unit: Schema.String,
	format: Customers.MetricFormat,
	aggregation: Customers.MetricAggregation,
	kind: MetricSourceKind,
	/** The Maple query is edited as SQL: the builder is not saved. */
	isSqlMode: Schema.Boolean,
	builder: BuilderForm,
	sql: Schema.String,
	/** SQL the admin wrote: "Edit SQL" brings it back after a visit to the builder. */
	typedSql: Schema.NullOr(Schema.String),
	events: Schema.Array(Schema.String),
	expression: Schema.String,
})
export type MetricForm = typeof MetricForm.Type

/** A preview the store refused (`Invalid`), or could not run. */
export const PreviewFailure = Schema.Union([Schema.Literal("Invalid"), CommonReason])
export type PreviewFailure = typeof PreviewFailure.Type

export const Preview = AsyncData.Schema(Customers.MetricPreviewResult, PreviewFailure)
export type Preview = typeof Preview.schema.Type

export const Editor = Schema.Struct({
	/** A fresh one per opened editor (`Model.lastEditorId`): a create's answer reaches only its own. */
	editorId: Schema.Int,
	/** Null: a new metric. */
	metricKey: Schema.NullOr(Schema.String),
	/** Null until the metric has synced. */
	form: Schema.NullOr(MetricForm),
	preview: Preview.schema,
	/** Tags the preview asked for last (`Model.lastRun`): an older answer is dropped. */
	previewRun: Schema.Int,
	/** The sample chart's hovered day. */
	hoveredDay: Schema.NullOr(Schema.Int),
	isSaving: Schema.Boolean,
	isDeleting: Schema.Boolean,
})
export type Editor = typeof Editor.Type

// MODEL

export const Model = Schema.Struct({
	/** Every metric definition; null until the query answers. */
	metrics: Schema.NullOr(Schema.Array(MetricRow)),
	layouts: Schema.Array(LayoutRow),
	/** Customers with data per stored metric (`customers.metrics.coverage`). */
	coverage: Coverage.schema,
	/** Null: the catalog. */
	editor: Schema.NullOr(Editor),
	/** The last preview run handed out, across editors. */
	lastRun: Schema.Int,
	/** The last editor id handed out. */
	lastEditorId: Schema.Int,
	deleteModal: Modal.Model,
})
export type Model = typeof Model.Type

export const DELETE_MODAL_ID = "metrics-delete-metric"

/** The preview's window. */
export const PREVIEW_DAYS = 7

export const metricByKey = (model: Model, key: string | null): MetricRow | undefined =>
	key === null ? undefined : model.metrics?.find((metric) => metric.key === key)
