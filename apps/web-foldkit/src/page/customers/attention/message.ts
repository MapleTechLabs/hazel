import * as Customers from "@hazel/domain/customers"
import { CustomerAccountId, CustomerSignalId } from "@hazel/schema"
import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import { CommonReason } from "~/lib/error-messages"
import { AccountRow, MemberRow, SignalRow } from "../../../customers/queries"
import * as Menu from "../../../ui/menu"
import * as Modal from "../../../ui/modal"
import { Grouping, QueueKey, Tab } from "./model"

/** A queue action's failure: the signal is gone, or its status no longer allows the action. */
export const SignalActionFailure = Schema.Union([Schema.Literals(["NotFound", "Stale"]), CommonReason])
export type SignalActionFailure = typeof SignalActionFailure.Type

export const SignalAction = Schema.Literals(["assign", "snooze", "done", "dismiss", "reopen"])
export type SignalAction = typeof SignalAction.Type

export const Message = defineMessageUnion({
	UpdatedSignals: { signals: Schema.Array(SignalRow) },
	UpdatedAccounts: { accounts: Schema.Array(AccountRow) },
	UpdatedMembers: { members: Schema.Array(MemberRow) },
	UpdatedLastComputedAt: { lastComputedAtMs: Schema.NullOr(Schema.Number) },

	ClickedTab: { tab: Tab },
	ClickedGrouping: { grouping: Grouping },
	ChangedSearch: { value: Schema.String },
	ClearedSearch: {},
	/** A filter chip's remove button: `owner` resets to anyone, the rest to none. */
	ClearedFilter: { field: Schema.Literals(["owner", "kind", "template", "severity", "plan"]) },
	PressedShowAllOwners: {},

	ClickedRow: { signalId: CustomerSignalId },
	/** A click inside a row's inline actions, stopped there so it does not also open the row. */
	ClickedRowActions: {},
	ClosedPreview: {},
	PressedQueueKey: { key: QueueKey },
	PressedOpenCustomer: { accountId: CustomerAccountId },
	PressedMarkDone: { signalId: CustomerSignalId },
	PressedReopen: { signalId: CustomerSignalId },

	GotAssignMenuMessage: { message: Menu.Message },
	GotSnoozeMenuMessage: { message: Menu.Message },
	GotMoreMenuMessage: { message: Menu.Message },
	GotFilterMenuMessage: { message: Menu.Message },
	GotSortMenuMessage: { message: Menu.Message },

	GotDoneModalMessage: { message: Modal.Message },
	ChangedDoneOutcome: { outcome: Customers.SignalOutcome },
	ChangedDoneNote: { value: Schema.String },
	SubmittedDone: {},

	GotSnoozeDateModalMessage: { message: Modal.Message },
	ChangedSnoozeDate: { value: Schema.String },
	SubmittedSnoozeDate: {},

	SucceededSignalAction: { signalId: CustomerSignalId, action: SignalAction },
	FailedSignalAction: { signalId: CustomerSignalId, action: SignalAction, reason: SignalActionFailure },

	SucceededFetchDetail: { accountId: CustomerAccountId, detail: Customers.AccountDetail },
	FailedFetchDetail: { accountId: CustomerAccountId, reason: CommonReason },

	PressedRetryDetail: {},
	PressedCopyEmail: { email: Schema.String },
	SucceededCopyEmail: { email: Schema.String },
	FailedCopyEmail: {},
	CompletedFocusSearch: {},
	CompletedScrollRow: {},
})
export type Message = typeof Message.Type
