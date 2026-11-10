import * as Customers from "@hazel/domain/customers"
import { CustomerNoteId, CustomerSignalId } from "@hazel/schema"
import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import { CommonReason } from "~/lib/error-messages"
import { AccountRow, MemberRow, SignalRow } from "../../../customers/queries"
import { CustomerTab } from "../../../route"
import * as Menu from "../../../ui/menu"
import * as Modal from "../../../ui/modal"
import * as Popover from "../../../ui/popover"
import { ContactFilter, DetailFailure, MetricRow, NoteRow, SignalMenu } from "./model"

/** A note or signal action: the row is gone, its status moved on, or a common reason. */
export const ActionFailure = Schema.Union([Schema.Literals(["NotFound", "Stale"]), CommonReason])
export type ActionFailure = typeof ActionFailure.Type

export const NoteAction = Schema.Literals(["create", "update", "delete"])
export type NoteAction = typeof NoteAction.Type

export const SignalAction = Schema.Literals(["assign", "snooze", "done", "dismiss"])
export type SignalAction = typeof SignalAction.Type

export const Message = defineMessageUnion({
	UpdatedAccounts: { accounts: Schema.Array(AccountRow) },
	UpdatedSignals: { signals: Schema.Array(SignalRow) },
	UpdatedNotes: { notes: Schema.Array(NoteRow) },
	UpdatedMembers: { members: Schema.Array(MemberRow) },
	UpdatedMetrics: { metrics: Schema.Array(MetricRow) },
	UpdatedConnectedProviders: { providers: Schema.Array(Customers.CustomerProvider) },
	UpdatedBands: { bands: Customers.HealthBands },

	ClickedTab: { tab: CustomerTab },
	PressedNeighbour: { step: Schema.Literals([-1, 1]) },
	ToggledSidebar: {},
	PressedAddNote: {},
	PressedRetryDetail: {},

	SucceededFetchDetail: { detail: Customers.AccountDetail },
	FailedFetchDetail: { reason: DetailFailure },

	GotMetricMenuMessage: { message: Menu.Message },
	ClickedUsageRange: { range: Customers.CustomersRange },
	HoveredUsage: { index: Schema.NullOr(Schema.Int) },
	SucceededFetchUsage: {
		metricKey: Schema.String,
		range: Customers.CustomersRange,
		series: Schema.Array(Customers.MetricSeries),
	},
	FailedFetchUsage: { metricKey: Schema.String, range: Customers.CustomersRange, reason: CommonReason },
	SucceededFetchMrrHistory: { series: Schema.Array(Customers.MetricSeries) },
	FailedFetchMrrHistory: { reason: CommonReason },
	HoveredMrr: { index: Schema.NullOr(Schema.Int) },

	ClickedContactFilter: { filter: ContactFilter },
	ChangedContactSearch: { value: Schema.String },
	ClearedContactSearch: {},
	PressedMoreContacts: {},
	SucceededFetchContacts: { page: Customers.Page(Customers.ContactRow) },
	FailedFetchContacts: { reason: CommonReason },

	PressedMoreInvoices: {},
	SucceededFetchInvoices: { page: Customers.Page(Customers.Invoice.Schema) },
	FailedFetchInvoices: { reason: CommonReason },

	ClickedEventProvider: { provider: Schema.NullOr(Customers.CustomerSource) },
	GotEventTypeMenuMessage: { message: Menu.Message },
	PressedMoreEvents: {},
	/** `filter` names the filters it was asked for, so an answer for old filters is dropped. */
	SucceededFetchEvents: { filter: Schema.String, page: Customers.Page(Customers.Event.Schema) },
	FailedFetchEvents: { filter: Schema.String, reason: CommonReason },

	GotOwnerMenuMessage: { message: Menu.Message },
	GotActionsMenuMessage: { message: Menu.Message },
	GotTagPopoverMessage: { message: Popover.Message },
	ChangedTagInput: { value: Schema.String },
	SubmittedTag: {},
	RemovedTag: { tag: Schema.String },
	SucceededAccountUpdate: {},
	FailedAccountUpdate: { reason: ActionFailure },
	GotRawModalMessage: { message: Modal.Message },

	PressedSignalMenu: { signalId: CustomerSignalId, menu: SignalMenu },
	GotSnoozeMenuMessage: { message: Menu.Message },
	GotDoneMenuMessage: { message: Menu.Message },
	GotSignalMoreMenuMessage: { message: Menu.Message },
	SucceededSignalAction: { action: SignalAction },
	FailedSignalAction: { action: SignalAction, reason: ActionFailure },

	ChangedComposer: { value: Schema.String },
	ToggledComposerPin: { pinned: Schema.Boolean },
	SubmittedNote: {},
	PressedEditNote: { noteId: CustomerNoteId },
	ChangedEditNote: { value: Schema.String },
	CanceledEditNote: {},
	SubmittedEditNote: {},
	PressedPinNote: { noteId: CustomerNoteId, pinned: Schema.Boolean },
	PressedDeleteNote: { noteId: CustomerNoteId },
	SucceededNoteAction: { action: NoteAction },
	FailedNoteAction: { action: NoteAction, reason: ActionFailure },

	PressedCopy: { text: Schema.String, label: Schema.String },
	CompletedCopy: { label: Schema.String, isCopied: Schema.Boolean },
	CompletedFocusComposer: {},
})
export type Message = typeof Message.Type
