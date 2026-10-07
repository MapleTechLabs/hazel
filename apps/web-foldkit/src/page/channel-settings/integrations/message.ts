import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import * as Menu from "../../../ui/menu"
import * as Modal from "../../../ui/modal"
import { ResolvedTheme } from "../../../theme"
import { GitHubRepo, Provider, RssFeed, RowKind, Webhook } from "./model"

const Failure = { title: Schema.String, description: Schema.NullOr(Schema.String) }

export const Message = defineMessageUnion({
	ChangedSystemTheme: { theme: ResolvedTheme },
	UpdatedGitHubConnection: { isConnected: Schema.Boolean },
	SucceededListWebhooks: { webhooks: Schema.Array(Webhook) },
	SucceededListRss: { feeds: Schema.Array(RssFeed) },
	SucceededListGitHub: { repos: Schema.Array(GitHubRepo) },
	/** A list failed: legacy keeps the rows it had, stops loading, and toasts. */
	FailedList: { list: Schema.Literals(["webhooks", "rss", "github"]), ...Failure },
	ClickedConnectGitHub: {},
	ClickedAddRepo: {},
	ClickedAddFeed: {},
	GotRowMenuMessage: { kind: RowKind, id: Schema.String, message: Menu.Message },
	SucceededRowAction: { kind: RowKind, id: Schema.String, successMessage: Schema.String },
	FailedRowAction: { kind: RowKind, id: Schema.String, ...Failure },
	ClickedConfirmRemove: {},
	GotConfirmModalMessage: { message: Modal.Message },
	/** `navigator.clipboard.writeText` with the button's success and failure toasts. */
	ClickedCopy: {
		id: Schema.String,
		value: Schema.String,
		successMessage: Schema.String,
		failureMessage: Schema.String,
	},
	CompletedCopy: { id: Schema.String, isCopied: Schema.Boolean, toastTitle: Schema.String },
	ElapsedCopiedDelay: { id: Schema.String },
	ClickedConnectProvider: { provider: Provider },
	SucceededConnectProvider: { provider: Provider, token: Schema.String },
	FailedConnectProvider: { provider: Provider, ...Failure },
	ClickedToggleProvider: { provider: Provider },
	ClickedDeleteProvider: { provider: Provider },
	ElapsedConfirmDelay: { provider: Provider, version: Schema.Number },
	SucceededProviderAction: { provider: Provider, successMessage: Schema.String, isDelete: Schema.Boolean },
	FailedProviderAction: { provider: Provider, ...Failure },
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
	FailedCreateWebhook: Failure,
	ClickedToggleTokenVisible: {},
	ClickedDismissToken: {},
})
export type Message = typeof Message.Type
