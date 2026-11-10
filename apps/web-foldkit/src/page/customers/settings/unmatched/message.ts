import { CustomerAccountId, CustomerIgnoreRuleId, CustomerUnmatchedRecordId } from "@hazel/schema"
import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import { CommonReason } from "~/lib/error-messages"
import { AccountRow } from "../../../../customers/queries"
import * as Menu from "../../../../ui/menu"
import * as Popover from "../../../../ui/popover"
import { IgnoreRuleRow, RecordRow, RecordStatus, Tab } from "./model"

export const RecordAction = Schema.Literals(["link", "create", "ignore"])
export type RecordAction = typeof RecordAction.Type

/** A record action's failure: the record or account is gone, or the store refuses (no longer open). */
export const RecordActionFailure = Schema.Union([Schema.Literals(["NotFound", "Invalid"]), CommonReason])
export type RecordActionFailure = typeof RecordActionFailure.Type

export const BulkFailure = Schema.Struct({ recordId: CustomerUnmatchedRecordId, reason: RecordActionFailure })

export const Message = defineMessageUnion({
	UpdatedAccounts: { accounts: Schema.Array(AccountRow) },

	SucceededFetchRecords: {
		status: RecordStatus,
		/** A "Load more" page, appended; otherwise the first page. */
		isMore: Schema.Boolean,
		items: Schema.Array(RecordRow),
		nextCursor: Schema.NullOr(Schema.String),
		openCount: Schema.Int,
	},
	FailedFetchRecords: { status: RecordStatus, isMore: Schema.Boolean, reason: CommonReason },
	SucceededFetchIgnoreRules: { rules: Schema.Array(IgnoreRuleRow) },
	FailedFetchIgnoreRules: { reason: CommonReason },
	PressedRetry: {},
	PressedLoadMore: { status: RecordStatus },

	ClickedTab: { tab: Tab },
	ChangedSearch: { value: Schema.String },
	ClearedSearch: {},
	GotSortMenuMessage: { message: Menu.Message },

	ToggledRecord: { recordId: CustomerUnmatchedRecordId, isSelected: Schema.Boolean },
	ToggledAllRecords: { isSelected: Schema.Boolean },
	ClearedSelection: {},
	PressedLinkHighConfidence: {},
	PressedLinkSelected: {},
	PressedIgnoreSelected: {},

	PressedLinkSuggested: { recordId: CustomerUnmatchedRecordId },
	PressedCreateAccount: { recordId: CustomerUnmatchedRecordId },
	GotRowMenuMessage: { recordId: CustomerUnmatchedRecordId, message: Menu.Message },
	GotLinkPopoverMessage: { recordId: CustomerUnmatchedRecordId, message: Popover.Message },
	ChangedLinkQuery: { value: Schema.String },
	/** Enter in the link search: the first match. */
	SubmittedLinkQuery: { recordId: CustomerUnmatchedRecordId },
	PickedLinkAccount: { recordId: CustomerUnmatchedRecordId, accountId: CustomerAccountId },
	PressedDeleteRule: { ruleId: CustomerIgnoreRuleId },

	SucceededRecordAction: { recordId: CustomerUnmatchedRecordId, action: RecordAction },
	FailedRecordAction: {
		recordId: CustomerUnmatchedRecordId,
		action: RecordAction,
		reason: RecordActionFailure,
	},
	/** A bulk link or ignore: every record settled, some may have failed. */
	CompletedBulkAction: {
		action: RecordAction,
		succeeded: Schema.Array(CustomerUnmatchedRecordId),
		failed: Schema.Array(BulkFailure),
	},
	SucceededDeleteRule: { ruleId: CustomerIgnoreRuleId },
	FailedDeleteRule: { ruleId: CustomerIgnoreRuleId, reason: CommonReason },
})
export type Message = typeof Message.Type
