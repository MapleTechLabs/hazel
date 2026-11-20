import { CustomerIssueId } from "@hazel/schema"
import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import { CommonReason } from "~/lib/error-messages"
import { ChannelOption } from "../../../customers/channels"
import { IssueRow } from "../../../customers/issues"
import { AccountRow, MemberRow } from "../../../customers/queries"
import { IssueSlaRow } from "../../../customers/sla"
import * as Menu from "../../../ui/menu"
import { InboxKey, Tab } from "./model"

/** An issue action's failure: the issue is gone, the assignee left, or a common reason. */
export const IssueActionFailure = Schema.Union([Schema.Literals(["NotFound", "Stale"]), CommonReason])
export type IssueActionFailure = typeof IssueActionFailure.Type

export const IssueAction = Schema.Literals(["assign", "status", "priority"])
export type IssueAction = typeof IssueAction.Type

export const Message = defineMessageUnion({
	UpdatedIssues: { issues: Schema.Array(IssueRow) },
	UpdatedAccounts: { accounts: Schema.Array(AccountRow) },
	UpdatedSlas: { slas: Schema.Array(IssueSlaRow) },
	UpdatedChannels: { channels: Schema.Array(ChannelOption) },
	UpdatedMembers: { members: Schema.Array(MemberRow) },

	ClickedTab: { tab: Tab },
	ChangedSearch: { value: Schema.String },
	ClearedSearch: {},
	ClearedFilter: {
		field: Schema.Literals(["assignee", "waitingOnUs", "overdue", "accountId", "priority", "status"]),
	},
	PressedClearNarrowing: {},
	PressedShowAllAssignees: {},

	ClickedRow: { issueId: CustomerIssueId },
	/** A click inside a row's inline actions, stopped there so it does not also select the row. */
	ClickedRowActions: {},
	PressedInboxKey: { key: InboxKey },

	GotAssignMenuMessage: { message: Menu.Message },
	GotStatusMenuMessage: { message: Menu.Message },
	GotPriorityMenuMessage: { message: Menu.Message },
	GotFilterMenuMessage: { message: Menu.Message },

	SucceededIssueAction: { issueId: CustomerIssueId, action: IssueAction },
	FailedIssueAction: { issueId: CustomerIssueId, action: IssueAction, reason: IssueActionFailure },
	CompletedFocusSearch: {},
	CompletedScrollRow: {},
})
export type Message = typeof Message.Type
