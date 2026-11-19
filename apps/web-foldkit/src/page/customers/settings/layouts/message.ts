import * as Customers from "@hazel/domain/customers"
import { CustomerAccountId, CustomerOverviewLayoutId } from "@hazel/schema"
import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import { CommonReason } from "~/lib/error-messages"
import * as OverviewData from "../../../../customers/overview/data"
import { LayoutRow, MetricDef } from "../../../../customers/overview/rows"
import { AccountRow, MemberRow, SettingsSummary, SignalRow } from "../../../../customers/queries"
import * as Modal from "../../../../ui/modal"
import * as Popover from "../../../../ui/popover"
import { NoteRow } from "../../detail/model"

/** A layout write's failure: the layout is gone, or the store refused the draft or order. */
export const LayoutWriteFailure = Schema.Union([Schema.Literals(["NotFound", "Invalid"]), CommonReason])
export type LayoutWriteFailure = typeof LayoutWriteFailure.Type

export const Message = defineMessageUnion({
	UpdatedLayouts: { layouts: Schema.Array(LayoutRow) },
	UpdatedMetrics: { metrics: Schema.Array(MetricDef) },
	UpdatedAccounts: { accounts: Schema.Array(AccountRow) },
	UpdatedSignals: { signals: Schema.Array(SignalRow) },
	UpdatedMembers: { members: Schema.Array(MemberRow) },
	UpdatedSettings: { settings: Schema.NullOr(SettingsSummary) },
	UpdatedPreviewNotes: { accountId: CustomerAccountId, notes: Schema.Array(NoteRow) },

	// The list
	PressedMoveLayout: { layoutId: CustomerOverviewLayoutId, step: Schema.Literals([-1, 1]) },
	SucceededReorderLayouts: {},
	FailedReorderLayouts: { reason: LayoutWriteFailure },
	PressedDeleteLayout: { layoutId: CustomerOverviewLayoutId },
	GotDeleteModalMessage: { message: Modal.Message },
	PressedConfirmDelete: {},
	SucceededDeleteLayout: { layoutId: CustomerOverviewLayoutId },
	FailedDeleteLayout: { layoutId: CustomerOverviewLayoutId, reason: LayoutWriteFailure },

	// The new layout dialog
	PressedNewLayout: {},
	GotNewModalMessage: { message: Modal.Message },
	ChangedNewName: { value: Schema.String },
	ClickedNewFrom: { from: Schema.String },
	ClickedCopyOf: { layoutId: CustomerOverviewLayoutId },
	PressedCreateAndEdit: {},

	// The editor
	ChangedName: { value: Schema.String },
	PressedDiscard: {},
	PressedSave: {},
	SucceededCreateLayout: {},
	FailedCreateLayout: { reason: LayoutWriteFailure },
	SucceededUpdateLayout: { layoutId: CustomerOverviewLayoutId },
	FailedUpdateLayout: { layoutId: CustomerOverviewLayoutId, reason: LayoutWriteFailure },

	// The canvas and the selected widget
	ClickedWidget: { widgetId: Schema.String },
	ClearedSelection: {},
	PressedMoveWidget: { step: Schema.Literals([-1, 1]) },
	PressedDuplicateWidget: {},
	PressedRemoveWidget: {},
	/** A metric table's rows: a group, or hand-picked metrics (switching keeps what it showed). */
	ClickedTableRows: { kind: Schema.Literals(["group", "metrics"]) },
	/** A settings panel's edit: the selected widget as it is now. */
	EditedWidget: { widget: Customers.OverviewWidget },

	// The library
	PressedAddWidget: { kind: Schema.Literals(["stat", "chart", "metric_table"]) },
	PressedAddBlock: { key: Schema.String },
	PressedAddBuiltIn: { kind: Customers.BuiltInWidgetKind },

	// The metric picker
	GotPickerPopoverMessage: { message: Popover.Message },
	ChangedPickerSearch: { value: Schema.String },
	PickedMetric: { metricKey: Schema.String },

	// The previewed customer
	GotPreviewPopoverMessage: { message: Popover.Message },
	ChangedPreviewSearch: { value: Schema.String },
	PickedPreview: { accountId: CustomerAccountId },
	SucceededFetchPreviewDetail: { accountId: CustomerAccountId, detail: Customers.AccountDetail },
	FailedFetchPreviewDetail: { accountId: CustomerAccountId, reason: CommonReason },
	GotOverviewDataMessage: { message: OverviewData.Message },

	// Who gets this layout
	GotRulePopoverMessage: { message: Popover.Message },
	/** The rule as it is now. */
	EditedRule: { rule: Customers.LayoutRule },
	PressedRuleMetric: { index: Schema.NullOr(Schema.Int) },
	PressedMoveAbove: { layoutId: CustomerOverviewLayoutId },
	ElapsedLayoutDryRunDelay: { version: Schema.Int },
	SucceededFetchLayoutDryRun: { version: Schema.Int, result: Customers.LayoutDryRunResult },
	FailedFetchLayoutDryRun: { version: Schema.Int, reason: CommonReason },
	PressedRetryDryRun: {},
})
export type Message = typeof Message.Type
