import { ChannelId, ChannelWebhookId, GitHubSubscriptionId, RssSubscriptionId } from "@hazel/schema"
import { Schema } from "effect"
import * as Menu from "../../../ui/menu"
import * as Modal from "../../../ui/modal"
import { ResolvedTheme } from "../../../theme"

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

/** `useState(true)` loading plus the fetched rows, as each card keeps them. */
const listOf = <S extends Schema.Top>(item: S) =>
	Schema.Struct({ isLoading: Schema.Boolean, items: Schema.Array(item) })

export const Provider = Schema.Literals(["openstatus", "railway"])
export type Provider = typeof Provider.Type

/** `IntegrationCard` local state. */
export const ProviderCard = Schema.Struct({
	isCreating: Schema.Boolean,
	isDeleting: Schema.Boolean,
	confirmDelete: Schema.Boolean,
	/** Bumped per confirm, so only the latest 3 s timeout resets it. */
	confirmVersion: Schema.Number,
	createdToken: Schema.NullOr(Schema.String),
})
export type ProviderCard = typeof ProviderCard.Type

/** `CreateWebhookForm` state. */
export const CreateForm = Schema.Struct({
	isExpanded: Schema.Boolean,
	name: Schema.String,
	description: Schema.String,
	avatarUrl: Schema.String,
	isNameDirty: Schema.Boolean,
	isSubmitting: Schema.Boolean,
	created: Schema.NullOr(Schema.Struct({ token: Schema.String, webhookUrl: Schema.String })),
	isTokenVisible: Schema.Boolean,
})
export type CreateForm = typeof CreateForm.Type

export const RowKind = Schema.Literals(["webhook", "rss", "github"])
export type RowKind = typeof RowKind.Type

/** The row whose delete confirmation is open (each legacy row owns an alertdialog). */
export const ConfirmTarget = Schema.Struct({ kind: RowKind, id: Schema.String })

export const Model = Schema.Struct({
	channelId: ChannelId,
	resolvedTheme: ResolvedTheme,
	isGitHubConnected: Schema.Boolean,
	webhooks: listOf(Webhook),
	rss: listOf(RssFeed),
	github: listOf(GitHubRepo),
	rowMenus: Schema.Array(Menu.Model),
	togglingRowIds: Schema.Array(Schema.String),
	/** Copy buttons showing their check for 2 s: webhook ids, `provider:<name>`, `token`, `url`. */
	copiedIds: Schema.Array(Schema.String),
	confirmTarget: Schema.NullOr(ConfirmTarget),
	confirmModal: Modal.Model,
	isConfirmPending: Schema.Boolean,
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

export const isNameValid = (name: string) => name.length > 1 && name.length < 101
