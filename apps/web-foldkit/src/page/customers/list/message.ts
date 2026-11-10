import * as Customers from "@hazel/domain/customers"
import { CustomerAccountId, CustomerSavedViewId } from "@hazel/schema"
import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import { CommonReason } from "~/lib/error-messages"
import { AccountRow, MemberRow, SignalRow } from "../../../customers/queries"
import * as Menu from "../../../ui/menu"
import * as Modal from "../../../ui/modal"
import * as Popover from "../../../ui/popover"
import { FilterField, ListKey, ViewRow } from "./model"

/** Saving, renaming or deleting a view: it is gone, the store refuses it (a built-in), or a common reason. */
export const ViewFailure = Schema.Union([Schema.Literals(["NotFound", "Refused"]), CommonReason])
export type ViewFailure = typeof ViewFailure.Type

export const ViewAction = Schema.Literals(["create", "update", "delete"])
export type ViewAction = typeof ViewAction.Type

export const BulkAction = Schema.Literals(["owner", "tag"])
export type BulkAction = typeof BulkAction.Type

export const Message = defineMessageUnion({
	UpdatedAccounts: { accounts: Schema.Array(AccountRow) },
	UpdatedSignals: { signals: Schema.Array(SignalRow) },
	UpdatedViews: { views: Schema.Array(ViewRow) },
	UpdatedMembers: { members: Schema.Array(MemberRow) },
	UpdatedConnectedProviders: { providers: Schema.Array(Customers.CustomerProvider) },
	UpdatedSettings: { lastComputedAtMs: Schema.NullOr(Schema.Number), reportingCurrency: Schema.String },

	ClickedViewTab: { key: Schema.NullOr(Schema.String) },
	ChangedSearch: { value: Schema.String },
	ClearedSearch: {},
	ClickedSortHeader: { column: Customers.ListColumn },
	ClearedFilter: { field: FilterField },
	ClearedFilters: {},

	PressedEditFilter: { field: FilterField },
	ClickedBuilderField: { field: FilterField },
	ChangedPendingFilters: { filters: Customers.ViewFilters },
	AppliedFilter: {},
	GotFilterPopoverMessage: { message: Popover.Message },

	GotColumnsPopoverMessage: { message: Popover.Message },
	ToggledColumn: { column: Customers.ListColumn, isShown: Schema.Boolean },
	MovedColumn: { column: Customers.ListColumn, step: Schema.Literals([-1, 1]) },
	ResetColumns: {},

	GotSortMenuMessage: { message: Menu.Message },
	GotViewMenuMessage: { message: Menu.Message },
	PressedSaveView: {},
	GotSaveModalMessage: { message: Modal.Message },
	ChangedSaveName: { value: Schema.String },
	ToggledSaveShared: { isShared: Schema.Boolean },
	SubmittedSave: {},
	SucceededViewAction: { action: ViewAction, viewId: CustomerSavedViewId },
	FailedViewAction: { action: ViewAction, reason: ViewFailure },

	ToggledRow: { accountId: CustomerAccountId, isSelected: Schema.Boolean },
	ToggledAllRows: { isSelected: Schema.Boolean },
	PressedSelectAll: {},
	ClearedSelection: {},
	GotOwnerMenuMessage: { message: Menu.Message },
	GotTagPopoverMessage: { message: Popover.Message },
	ChangedTagInput: { value: Schema.String },
	SubmittedTag: { tag: Schema.String },
	SucceededBulkUpdate: { action: BulkAction, count: Schema.Int, label: Schema.String },
	/** `isBatched`: over one call's limit, so the batches before the failing one are already saved. */
	FailedBulkUpdate: { action: BulkAction, reason: CommonReason, isBatched: Schema.Boolean },
	PressedExport: { scope: Schema.Literals(["all", "selected"]) },
	CompletedExport: {},

	PressedShowMoreRows: {},
	ClickedRow: { accountId: CustomerAccountId },
	PressedListKey: { key: ListKey },
	HoveredRow: { accountId: CustomerAccountId },
	UnhoveredRow: {},
	ElapsedHoverDelay: { accountId: CustomerAccountId },

	PressedConnect: { provider: Customers.CustomerProvider },

	SucceededFetchSparklines: { sparklines: Schema.Array(Customers.Sparkline) },
	FailedFetchSparklines: { reason: CommonReason },

	CompletedFocusSearch: {},
	CompletedScrollRow: {},
	CompletedPositionHoverCard: {},
	CompletedLetModifierClicksThrough: {},
})
export type Message = typeof Message.Type
