import * as Customers from "@hazel/domain/customers"
import {
	ChannelId,
	CustomerAccountId,
	CustomerChannelSuggestionId,
	CustomerContactId,
	CustomerNoteId,
	CustomerSignalId,
	UserId,
} from "@hazel/schema"
import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import { CommonReason } from "~/lib/error-messages"
import { ChannelLinkRow, ChannelOption } from "../../../customers/channels"
import { CustomerAuthorInfo, ChatParticipantRow } from "../../../customers/chat-authors"
import { SuggestionMessage, SuggestionRow } from "../../../customers/suggestions"
import { FeatureFlagFailure } from "../../../customers/feature-flags"
import { IssueRow } from "../../../customers/issues"
import { AccountRow, MemberRow, SignalRow } from "../../../customers/queries"
import { IssueSlaRow } from "../../../customers/sla"
import { CustomerTab } from "../../../route"
import * as Menu from "../../../ui/menu"
import * as Modal from "../../../ui/modal"
import * as Popover from "../../../ui/popover"
import { SignalAction, SignalActionFailure } from "../attention/message"
import {
	ContactFilter,
	DetailFailure,
	ImpersonationFailure,
	MetricRow,
	NoteDrafts,
	NoteRow,
	SignalMenu,
} from "./model"

/** A note or signal action: the row is gone, its status moved on, or a common reason. */
export const ActionFailure = Schema.Union([Schema.Literals(["NotFound", "Stale"]), CommonReason])
export type ActionFailure = typeof ActionFailure.Type

/** Linking a channel to this customer, or unlinking one. */
export const ChannelAction = Schema.Literals(["link", "unlink"])
export type ChannelAction = typeof ChannelAction.Type

/** Linking this customer to another, unlinking an environment, making it primary, naming its environment. */
export const GroupAction = Schema.Literals(["link", "unlink", "set_primary", "set_environment"])
export type GroupAction = typeof GroupAction.Type

export const NoteAction = Schema.Literals(["create", "update", "delete"])
export type NoteAction = typeof NoteAction.Type

/** The text of a failed note save (noteId null) or edit, put back so it is not lost. */
export const NoteDraft = Schema.Struct({ noteId: Schema.NullOr(CustomerNoteId), body: Schema.String })
export type NoteDraft = typeof NoteDraft.Type

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

	/** Every read's answer names its account: one for the previous customer is dropped. */
	SucceededFetchDetail: { accountId: CustomerAccountId, detail: Customers.AccountDetail },
	FailedFetchDetail: { accountId: CustomerAccountId, reason: DetailFailure },

	GotMetricMenuMessage: { message: Menu.Message },
	ClickedUsageRange: { range: Customers.CustomersRange },
	HoveredUsage: { index: Schema.NullOr(Schema.Int) },
	SucceededFetchUsage: {
		accountId: CustomerAccountId,
		metricKey: Schema.String,
		range: Customers.CustomersRange,
		series: Schema.Array(Customers.MetricSeries),
	},
	FailedFetchUsage: {
		accountId: CustomerAccountId,
		metricKey: Schema.String,
		range: Customers.CustomersRange,
		reason: CommonReason,
	},
	SucceededFetchMrrHistory: { accountId: CustomerAccountId, series: Schema.Array(Customers.MetricSeries) },
	FailedFetchMrrHistory: { accountId: CustomerAccountId, reason: CommonReason },
	HoveredMrr: { index: Schema.NullOr(Schema.Int) },

	UpdatedSupportIssues: { issues: Schema.Array(IssueRow) },
	UpdatedSupportSlas: { slas: Schema.Array(IssueSlaRow) },
	SucceededFetchSupport: { accountId: CustomerAccountId, row: Schema.NullOr(Customers.SupportReportRow) },
	FailedFetchSupport: { accountId: CustomerAccountId, reason: CommonReason },
	PressedRetrySupport: {},

	ClickedContactFilter: { filter: ContactFilter },
	ChangedContactSearch: { value: Schema.String },
	ClearedContactSearch: {},
	PressedMoreContacts: {},
	SucceededFetchContacts: { accountId: CustomerAccountId, page: Customers.Page(Customers.ContactRow) },
	FailedFetchContacts: { accountId: CustomerAccountId, reason: CommonReason },

	PressedMoreInvoices: {},
	SucceededFetchInvoices: { accountId: CustomerAccountId, page: Customers.Page(Customers.Invoice.Schema) },
	FailedFetchInvoices: { accountId: CustomerAccountId, reason: CommonReason },

	ClickedEventProvider: { provider: Schema.NullOr(Customers.CustomerSource) },
	GotEventTypeMenuMessage: { message: Menu.Message },
	PressedMoreEvents: {},
	/** `filter` names the filters it was asked for, so an answer for old filters is dropped. */
	SucceededFetchEvents: {
		accountId: CustomerAccountId,
		filter: Schema.String,
		page: Customers.Page(Customers.Event.Schema),
	},
	FailedFetchEvents: { accountId: CustomerAccountId, filter: Schema.String, reason: CommonReason },

	GotOwnerMenuMessage: { message: Menu.Message },
	GotActionsMenuMessage: { message: Menu.Message },
	GotTagPopoverMessage: { message: Popover.Message },
	ChangedTagInput: { value: Schema.String },
	SubmittedTag: {},
	RemovedTag: { tag: Schema.String },
	SucceededAccountUpdate: {},
	FailedAccountUpdate: { reason: ActionFailure },
	GotRawModalMessage: { message: Modal.Message },

	GotEnvironmentMenuMessage: { message: Menu.Message },
	GotLinkModalMessage: { message: Modal.Message },
	ChangedLinkQuery: { value: Schema.String },
	ClearedLinkQuery: {},
	/** Not `accountId`: a message naming another account is dropped (`isForOtherAccount`). */
	PickedLinkPrimary: { pickedId: CustomerAccountId },
	PressedConfirmLink: {},
	GotEnvironmentModalMessage: { message: Modal.Message },
	ChangedEnvironmentDraft: { value: Schema.String },
	SubmittedEnvironment: {},
	/** `accountId` is the account acted on: another customer's page drops the answer. */
	SucceededGroupAction: { accountId: CustomerAccountId, action: GroupAction },
	/** `message` is the store's reason it refused (`CustomerGroupError`), shown as is. */
	FailedGroupAction: {
		accountId: CustomerAccountId,
		action: GroupAction,
		reason: ActionFailure,
		message: Schema.NullOr(Schema.String),
	},

	UpdatedChannelLinks: { links: Schema.Array(ChannelLinkRow) },
	UpdatedChannelOptions: { channels: Schema.Array(ChannelOption) },
	GotChannelPopoverMessage: { message: Popover.Message },
	ChangedChannelSearch: { value: Schema.String },
	PressedLinkChannel: { channelId: ChannelId },
	PressedUnlinkChannel: { channelId: ChannelId },
	SucceededChannelAction: { action: ChannelAction },
	FailedChannelAction: { action: ChannelAction, reason: ActionFailure },
	/** `customer`, not `accountId`: on an environment's page it is the group's primary. */
	SucceededFetchSuggestions: { customer: CustomerAccountId, items: Schema.Array(SuggestionRow) },
	FailedFetchSuggestions: { customer: CustomerAccountId },
	PressedAcceptSuggestion: { suggestionId: CustomerChannelSuggestionId },
	PressedDismissSuggestion: { suggestionId: CustomerChannelSuggestionId },
	/** The shared accept / dismiss Commands' answers (`customers/suggestions.ts`). */
	CompletedSuggestionAction: { message: SuggestionMessage },

	UpdatedChatParticipants: { participants: Schema.Array(ChatParticipantRow) },
	UpdatedChatAuthors: { authors: Schema.Array(CustomerAuthorInfo) },
	PressedChatPersonMenu: { userId: UserId },
	GotChatPersonMenuMessage: { message: Menu.Message },
	SucceededSetChatAuthorSide: {},
	FailedSetChatAuthorSide: { reason: ActionFailure },

	UpdatedCreatedFeatureFlags: { keys: Schema.Array(Schema.String) },
	GotFlagPopoverMessage: { message: Popover.Message },
	ToggledFlagSelection: { key: Schema.String, isSelected: Schema.Boolean },
	PressedAddFlags: {},
	PressedRemoveFlag: { key: Schema.String },
	SucceededFeatureFlags: {},
	FailedFeatureFlags: { failure: FeatureFlagFailure },

	PressedSignalMenu: { signalId: CustomerSignalId, menu: SignalMenu },
	GotSnoozeMenuMessage: { message: Menu.Message },
	GotDoneMenuMessage: { message: Menu.Message },
	GotSignalMoreMenuMessage: { message: Menu.Message },
	/** The queue's Commands answer (`attention/commands.ts`), so these match its Messages. */
	SucceededSignalAction: { signalId: CustomerSignalId, action: SignalAction },
	FailedSignalAction: { signalId: CustomerSignalId, action: SignalAction, reason: SignalActionFailure },

	LoadedNoteDrafts: { drafts: NoteDrafts },
	/** A failed save's text, put back for this customer (`note-drafts.ts`), maybe by an earlier instance. */
	RestoredNoteDraft: { draft: NoteDraft },
	ChangedComposer: { value: Schema.String },
	ToggledComposerPin: { pinned: Schema.Boolean },
	SubmittedNote: {},
	PressedEditNote: { noteId: CustomerNoteId },
	ChangedEditNote: { value: Schema.String },
	CanceledEditNote: {},
	SubmittedEditNote: {},
	PressedPinNote: { noteId: CustomerNoteId, pinned: Schema.Boolean },
	PressedDeleteNote: { noteId: CustomerNoteId },
	GotDeleteNoteModalMessage: { message: Modal.Message },
	PressedConfirmDeleteNote: {},
	SucceededNoteAction: { action: NoteAction },
	FailedNoteAction: { action: NoteAction, reason: ActionFailure, draft: Schema.NullOr(NoteDraft) },

	UpdatedIsImpersonator: { isImpersonator: Schema.Boolean },
	PressedImpersonate: { contactId: CustomerContactId },
	GotImpersonateModalMessage: { message: Modal.Message },
	/** `contactId` names the dialog it was asked from: an answer for one closed since is dropped. */
	SucceededStartImpersonation: { attempt: Schema.Number, url: Schema.String },
	FailedStartImpersonation: { attempt: Schema.Number, reason: ImpersonationFailure },

	PressedCopy: { text: Schema.String, label: Schema.String },
	CompletedCopy: { label: Schema.String, isCopied: Schema.Boolean },
	CompletedFocusComposer: {},
})
export type Message = typeof Message.Type
