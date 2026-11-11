import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import * as Menu from "../../../ui/menu"
import * as ConfirmAction from "../../shared/confirm-action"
import {
	ChannelRequestFailure,
	GitHubRepo,
	Provider,
	RowActionFailure,
	RssFeed,
	RowKind,
	Webhook,
} from "./model"

/** A row menu's identity: the list it sits in and the row id. */
const RowMenuId = Schema.Struct({ kind: RowKind, id: Schema.String })

export const Message = defineMessageUnion({
	UpdatedGitHubConnection: { isConnected: Schema.Boolean },
	SucceededListWebhooks: { version: Schema.Number, webhooks: Schema.Array(Webhook) },
	SucceededListRss: { version: Schema.Number, feeds: Schema.Array(RssFeed) },
	SucceededListGitHub: { version: Schema.Number, repos: Schema.Array(GitHubRepo) },
	/** A list failed: it keeps the rows it had (`Stale`), or shows the failure with a retry. */
	FailedList: { kind: RowKind, version: Schema.Number, reason: ChannelRequestFailure },
	ClickedRetryList: { kind: RowKind },
	ClickedConnectGitHub: {},
	ClickedAddRepo: {},
	ClickedAddFeed: {},
	GotRowMenuMessage: { rowMenuId: RowMenuId, message: Menu.Message },
	SucceededRowAction: { kind: RowKind, id: Schema.String, successMessage: Schema.String },
	FailedRowAction: { kind: RowKind, id: Schema.String, reason: RowActionFailure },
	ClickedConfirmRemove: {},
	GotRemoveConfirmMessage: { message: ConfirmAction.Message },
	/** `navigator.clipboard.writeText` with the button's success and failure toasts. */
	ClickedCopy: {
		id: Schema.String,
		value: Schema.String,
		successMessage: Schema.String,
		failureMessage: Schema.String,
	},
	SucceededCopy: { id: Schema.String, successMessage: Schema.String },
	/** The clipboard refused the write; the copy is the button's own, not error text. */
	FailedCopy: { failureMessage: Schema.String },
	ElapsedCopiedDelay: { id: Schema.String },
	ClickedConnectProvider: { provider: Provider },
	SucceededConnectProvider: { provider: Provider, token: Schema.String },
	FailedConnectProvider: { provider: Provider, reason: ChannelRequestFailure },
	ClickedToggleProvider: { provider: Provider },
	ClickedDeleteProvider: { provider: Provider },
	ElapsedConfirmDelay: { provider: Provider, version: Schema.Number },
	SucceededProviderAction: { provider: Provider, successMessage: Schema.String },
	FailedProviderAction: { provider: Provider, reason: RowActionFailure },
	ClickedProviderUrlInfo: {},
	ClickedDismissProviderToken: { provider: Provider },
	ClickedExpandCreateForm: {},
	ClickedCancelCreateForm: {},
	ChangedCreateField: {
		field: Schema.Literals(["name", "description", "avatarUrl"]),
		value: Schema.String,
	},
	SubmittedCreateForm: {},
	SucceededCreateWebhook: { token: Schema.String, webhookUrl: Schema.String },
	FailedCreateWebhook: { reason: ChannelRequestFailure },
	ClickedToggleTokenVisible: {},
	ClickedDismissToken: {},
})
export type Message = typeof Message.Type
