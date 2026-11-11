import { ChannelId, ChannelWebhookId, GitHubSubscriptionId, RssSubscriptionId } from "@hazel/schema"
import { Schema } from "effect"
import * as AsyncData from "foldkit/asyncData"
import { Field, NotValidated } from "foldkit/fieldValidation"
import { defineTaggedUnion } from "foldkit/schema"
import { CommonReason, failureMessage } from "~/lib/error-messages"
import * as Menu from "../../../ui/menu"
import * as ConfirmAction from "../../shared/confirm-action"

export const Webhook = Schema.Struct({
	id: ChannelWebhookId,
	name: Schema.String,
	avatarUrl: Schema.NullOr(Schema.String),
	tokenSuffix: Schema.String,
	isEnabled: Schema.Boolean,
	lastUsedAtMs: Schema.NullOr(Schema.Number),
})
export type Webhook = typeof Webhook.Type

export const RssFeed = Schema.Struct({
	id: RssSubscriptionId,
	feedUrl: Schema.String,
	feedTitle: Schema.NullOr(Schema.String),
	feedIconUrl: Schema.NullOr(Schema.String),
	consecutiveErrors: Schema.Number,
	isEnabled: Schema.Boolean,
	pollingIntervalMinutes: Schema.Number,
})
export type RssFeed = typeof RssFeed.Type

export const GitHubRepo = Schema.Struct({
	id: GitHubSubscriptionId,
	repositoryFullName: Schema.String,
	enabledEvents: Schema.Array(Schema.String),
	branchFilter: Schema.NullOr(Schema.String),
	isEnabled: Schema.Boolean,
})
export type GitHubRepo = typeof GitHubRepo.Type

/** What can go wrong with a request scoped to the channel (the lists, creating a webhook). */
export const ChannelRequestFailure = Schema.Union([Schema.Literals(["ChannelNotFound"]), CommonReason])
export type ChannelRequestFailure = typeof ChannelRequestFailure.Type

/** The copy for a failed channel request: a list load (rendered with a retry) or a create (a toast). */
export const channelRequestMessage = (reason: ChannelRequestFailure) =>
	failureMessage(reason, {
		ChannelNotFound: { title: "Channel not found", description: "This channel may have been deleted." },
	})

/** What can go wrong toggling or deleting a row (or a provider's webhook). */
export const RowActionFailure = Schema.Union([Schema.Literals(["NotFound"]), CommonReason])
export type RowActionFailure = typeof RowActionFailure.Type

export const Webhooks = AsyncData.Schema(Schema.Array(Webhook), ChannelRequestFailure)
export const RssFeeds = AsyncData.Schema(Schema.Array(RssFeed), ChannelRequestFailure)
export const GitHubRepos = AsyncData.Schema(Schema.Array(GitHubRepo), ChannelRequestFailure)

/** A fetched list; `version` names the latest request, so older results drop. */
const listOf = <A, I>(data: Schema.Codec<A, I>) => Schema.Struct({ version: Schema.Number, data })

export const Provider = Schema.Literals(["openstatus", "railway"])
export type Provider = typeof Provider.Type

/**
 * The provider card's action: connecting, toggling, the 3 s "Confirm?" before a delete, or deleting.
 * Legacy keeps Enable/Disable enabled while it runs, so update ignores repeats.
 */
export const CardAction = defineTaggedUnion({
	Idle: {},
	Connecting: {},
	Toggling: {},
	ConfirmingDelete: {},
	Deleting: {},
})
export type CardAction = typeof CardAction.Type

/** `IntegrationCard` local state. */
export const ProviderCard = Schema.Struct({
	action: CardAction,
	/** Bumped per "Confirm?", so only the latest 3 s timeout disarms it. */
	confirmVersion: Schema.Number,
	createdToken: Schema.NullOr(Schema.String),
})
export type ProviderCard = typeof ProviderCard.Type

/** `CreateWebhookForm` state. */
export const CreateForm = Schema.Struct({
	isExpanded: Schema.Boolean,
	/** `NotValidated` until the user edits the name or submits. */
	name: Field(Schema.String),
	description: Schema.String,
	avatarUrl: Schema.String,
	isSubmitting: Schema.Boolean,
	created: Schema.NullOr(Schema.Struct({ token: Schema.String, webhookUrl: Schema.String })),
	isTokenVisible: Schema.Boolean,
})
export type CreateForm = typeof CreateForm.Type

export const emptyCreateForm: CreateForm = {
	isExpanded: false,
	name: NotValidated({ value: "" }),
	description: "",
	avatarUrl: "",
	isSubmitting: false,
	created: null,
	isTokenVisible: false,
}

export const RowKind = Schema.Literals(["webhook", "rss", "github"])
export type RowKind = typeof RowKind.Type

/** The row a delete confirmation is about (each legacy row owns an alertdialog). */
export const ConfirmTarget = Schema.Struct({ kind: RowKind, id: Schema.String })
export type ConfirmTarget = typeof ConfirmTarget.Type

export const Model = Schema.Struct({
	channelId: ChannelId,
	isGitHubConnected: Schema.Boolean,
	webhooks: listOf(Webhooks.schema),
	rss: listOf(RssFeeds.schema),
	github: listOf(GitHubRepos.schema),
	rowMenus: Schema.Array(Menu.Model),
	togglingRowIds: Schema.Array(Schema.String),
	/** Copy buttons showing their check for 2 s: webhook ids, `provider:<name>`, `token`, `url`. */
	copiedIds: Schema.Array(Schema.String),
	remove: ConfirmAction.Model(ConfirmTarget),
	providers: Schema.Struct({ openstatus: ProviderCard, railway: ProviderCard }),
	createForm: CreateForm,
})
export type Model = typeof Model.Type

export const rowMenuId = (kind: RowKind, id: string) => `${kind}-${id}`

export const INTEGRATION_CONFIG: Readonly<
	Record<
		Provider,
		{
			readonly name: string
			readonly description: string
			readonly webhookDescription: string
			readonly urlSuffix: string
			readonly docsUrl: string
		}
	>
> = {
	openstatus: {
		name: "OpenStatus",
		description: "Receive monitor alerts in this channel",
		webhookDescription: "OpenStatus monitor alerts",
		urlSuffix: "openstatus",
		docsUrl: "https://docs.openstatus.dev/alerting/providers/webhook/",
	},
	railway: {
		name: "Railway",
		description: "Receive deployment alerts in this channel",
		webhookDescription: "Railway deployment alerts",
		urlSuffix: "railway",
		docsUrl: "https://docs.railway.com/guides/webhooks",
	},
}

/** A list's rows, or none while it has no data. */
export const itemsOf = <A, E>(list: {
	readonly data: AsyncData.AsyncData<ReadonlyArray<A>, E>
}): ReadonlyArray<A> => AsyncData.getOrElse(list.data, () => [])
