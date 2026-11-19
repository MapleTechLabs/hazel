import * as Customers from "@hazel/domain/customers"
import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import { CommonReason } from "~/lib/error-messages"
import { MetricSourceKind } from "../../../../route"
import * as Modal from "../../../../ui/modal"
import { CoverageRow, FilterForm, LayoutRow, MetricRow, PreviewFailure } from "./model"

/** A metric write's failure: the metric is gone, or the store refused the draft. */
export const MetricWriteFailure = Schema.Union([Schema.Literals(["NotFound", "Invalid"]), CommonReason])
export type MetricWriteFailure = typeof MetricWriteFailure.Type

/** A Maple query builder field typed into. */
export const BuilderTextField = Schema.Literals(["valueField", "customerField"])
export type BuilderTextField = typeof BuilderTextField.Type

export const Message = defineMessageUnion({
	UpdatedMetrics: { metrics: Schema.Array(MetricRow) },
	UpdatedLayouts: { layouts: Schema.Array(LayoutRow) },
	SucceededFetchCoverage: { metrics: Schema.Array(CoverageRow) },
	FailedFetchCoverage: { reason: CommonReason },
	PressedNewMetric: {},

	// Basics
	ChangedName: { value: Schema.String },
	ChangedKey: { value: Schema.String },
	ChangedDescription: { value: Schema.String },
	ChangedGroup: { value: Schema.String },
	ChangedUnit: { value: Schema.String },
	ClickedFormat: { format: Customers.MetricFormat },
	ClickedAggregation: { aggregation: Customers.MetricAggregation },

	// Source
	ClickedSourceKind: { kind: MetricSourceKind },
	ClickedTable: { table: Customers.MapleQueryTable },
	ClickedValue: { value: Schema.Literals(["sum", "count", "uniq"]) },
	ChangedBuilderText: { field: BuilderTextField, value: Schema.String },
	PressedAddFilter: {},
	ChangedFilter: { index: Schema.Int, filter: FilterForm },
	PressedRemoveFilter: { index: Schema.Int },
	PressedEditSql: {},
	PressedUseBuilder: {},
	ChangedSql: { value: Schema.String },
	PressedAddEvent: {},
	ChangedEvent: { index: Schema.Int, value: Schema.String },
	PressedRemoveEvent: { index: Schema.Int },
	ChangedExpression: { value: Schema.String },
	PressedInsertMetric: { key: Schema.String },

	// Preview
	PressedRunPreview: {},
	SucceededPreviewMetric: { run: Schema.Int, result: Customers.MetricPreviewResult },
	FailedPreviewMetric: { run: Schema.Int, reason: PreviewFailure },
	HoveredSampleDay: { index: Schema.NullOr(Schema.Int) },

	// Actions
	PressedSave: {},
	SucceededCreateMetric: { metricKey: Schema.String },
	FailedCreateMetric: { reason: MetricWriteFailure },
	SucceededUpdateMetric: { metricKey: Schema.String },
	FailedUpdateMetric: { metricKey: Schema.String, reason: MetricWriteFailure },
	PressedCancel: {},
	PressedDelete: {},
	GotDeleteModalMessage: { message: Modal.Message },
	PressedConfirmDelete: {},
	SucceededDeleteMetric: { metricKey: Schema.String },
	FailedDeleteMetric: { metricKey: Schema.String, reason: MetricWriteFailure },
})
export type Message = typeof Message.Type
