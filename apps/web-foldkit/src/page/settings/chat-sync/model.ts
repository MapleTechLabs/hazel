import { ChannelId, OrganizationId, SyncConnectionId } from "@hazel/schema"
import { Schema } from "effect"
import * as AsyncData from "foldkit/asyncData"
import { defineMessageUnion } from "foldkit/message"
import { defineTaggedUnion } from "foldkit/schema"
import { CommonReason } from "~/lib/error-messages"
import * as Interaction from "../../../ui/aria/interaction"
import * as Menu from "../../../ui/menu"
import * as Modal from "../../../ui/modal"
import * as ChatMigration from "../../shared/chat-migration"
import * as ConfirmAction from "../../shared/confirm-action"
import { ChatSyncProvider, PROVIDERS, ResourceFailure, Workspace, Workspaces } from "./providers"

export const ConnectionStatus = Schema.Literals(["active", "paused", "error", "disabled"])
export type ConnectionStatus = typeof ConnectionStatus.Type

export const Connection = Schema.Struct({
	id: SyncConnectionId,
	provider: ChatSyncProvider,
	/** `externalWorkspaceName`, or the provider's "Discord Server" / "Slack Workspace" */
	displayName: Schema.String,
	status: ConnectionStatus,
	externalWorkspaceId: Schema.String,
	errorMessage: Schema.NullOr(Schema.String),
	lastSyncedAtMs: Schema.NullOr(Schema.Finite),
})
export type Connection = typeof Connection.Type

/** `chatSync.connection.list`: its only declared errors are the common ones. */
export const Connections = AsyncData.Schema(Schema.Array(Connection), CommonReason)

export const DeleteTarget = Schema.Struct({ id: SyncConnectionId, name: Schema.String })
export type DeleteTarget = typeof DeleteTarget.Type

export const DeleteConnectionFailure = Schema.Union([Schema.Literal("NotFound"), CommonReason])
export type DeleteConnectionFailure = typeof DeleteConnectionFailure.Type

export const CreateConnectionFailure = Schema.Union([
	Schema.Literals(["AlreadyExists", "NotConnected"]),
	CommonReason,
])
export type CreateConnectionFailure = typeof CreateConnectionFailure.Type

/** A Hazel channel as the inbox channel picker lists it (the org's public and private channels). */
export const HazelChannel = Schema.Struct({ id: ChannelId, name: Schema.String })
export type HazelChannel = typeof HazelChannel.Type

/**
 * An email support inbox: a chat-sync connection with `provider: "email"` and its one channel link
 * (`docs/customers/email.md`).
 */
export const EmailInbox = Schema.Struct({
	id: SyncConnectionId,
	/** `externalWorkspaceName`: the name replies are sent as. */
	displayName: Schema.String,
	status: ConnectionStatus,
	errorMessage: Schema.NullOr(Schema.String),
	/** `metadata.inboundAddress`: where the team forwards its support address. */
	inboundAddress: Schema.NullOr(Schema.String),
	/** The link's `settings.email.replyTo`: the team's own support address, if set. */
	supportAddress: Schema.NullOr(Schema.String),
	/** The channel its emails arrive in (null while the link is missing). */
	hazelChannelId: Schema.NullOr(ChannelId),
})
export type EmailInbox = typeof EmailInbox.Type

/** Why creating or editing an inbox failed. */
export const EmailInboxFailure = Schema.Union([
	Schema.Literals(["ChannelNotFound", "ChannelLinked", "NotFound"]),
	CommonReason,
])
export type EmailInboxFailure = typeof EmailInboxFailure.Type

/**
 * The inbox modal's step: a new inbox's form, an inbox's edit form, or an inbox's forwarding setup
 * (`isNew`: shown right after creating it).
 */
export const EmailStep = defineTaggedUnion({
	Create: {},
	Edit: { inbox: EmailInbox },
	Setup: { inbox: EmailInbox, isNew: Schema.Boolean },
})
export type EmailStep = typeof EmailStep.Type

export const EmailSubmission = defineTaggedUnion({
	NotSubmitted: {},
	Submitting: {},
	Failed: { reason: EmailInboxFailure },
})
export type EmailSubmission = typeof EmailSubmission.Type

/** The inbox modal's form. */
export const EmailForm = Schema.Struct({
	step: EmailStep,
	name: Schema.String,
	supportAddress: Schema.String,
	channel: Schema.NullOr(HazelChannel),
	channelSearch: Schema.String,
	isChannelSearchFocused: Schema.Boolean,
	/** Set by the first Create/Save press: the fields show their errors from then on. */
	isValidated: Schema.Boolean,
	submission: EmailSubmission,
})
export type EmailForm = typeof EmailForm.Type

/** The add modal's Connect: not pressed yet, creating, or failed (the modal stays open to retry). */
export const Submission = defineTaggedUnion({
	NotSubmitted: {},
	Submitting: {},
	Failed: { reason: CreateConnectionFailure },
})
export type Submission = typeof Submission.Type

export const Model = Schema.Struct({
	/** The organization the list was requested for; the query reruns when it changes. */
	requestedOrganizationId: Schema.NullOr(OrganizationId),
	connections: Connections.schema,
	addMenu: Menu.Model,
	emptyAddMenu: Menu.Model,
	/**
	 * `AddConnectionModal`: open state, the provider it connects, its workspace query (run when the first
	 * list mounts it, and again when another provider opens it) and form.
	 */
	addModal: Modal.Model,
	addProvider: ChatSyncProvider,
	workspaces: Workspaces.schema,
	/** Bumped per workspace request; a list for an older request or another organization is dropped. */
	workspacesVersion: Schema.Finite,
	/** The picked Discord server (Slack has its one installed workspace). */
	selectedWorkspace: Schema.NullOr(Workspace),
	workspaceSearch: Schema.String,
	isWorkspaceSearchFocused: Schema.Boolean,
	submission: Submission,
	deleteConfirm: ConfirmAction.Model(DeleteTarget),
	/** Hover, press and focus of the add modal's search Input and Connect button. */
	interaction: Interaction.Model,
	/** "Import from Slack or Discord": the migration wizard in a modal. */
	migrationModal: Modal.Model,
	migration: ChatMigration.Model,
	/** The email support inboxes, listed with the connections. */
	emailInboxes: Schema.Array(EmailInbox),
	/** The org's public and private channels: the inbox channel picker, and each inbox's channel name. */
	hazelChannels: Schema.Array(HazelChannel),
	emailModal: Modal.Model,
	emailForm: EmailForm,
	removeInboxConfirm: ConfirmAction.Model(DeleteTarget),
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
	SucceededListConnections: {
		organizationId: OrganizationId,
		connections: Schema.Array(Connection),
		emailInboxes: Schema.Array(EmailInbox),
	},
	FailedListConnections: { organizationId: OrganizationId, reason: CommonReason },
	ClickedRetryListConnections: {},
	SucceededListWorkspaces: {
		organizationId: OrganizationId,
		version: Schema.Finite,
		workspaces: Schema.Array(Workspace),
	},
	FailedListWorkspaces: {
		organizationId: OrganizationId,
		version: Schema.Finite,
		reason: ResourceFailure,
	},
	ClickedRetryListWorkspaces: {},
	ClickedConnection: { connectionId: SyncConnectionId },
	ClickedDeleteConnection: { target: DeleteTarget },
	ClickedConfirmDelete: {},
	SucceededDeleteConnection: {},
	FailedDeleteConnection: { reason: DeleteConnectionFailure },
	GotAddMenuMessage: { message: Menu.Message },
	GotEmptyAddMenuMessage: { message: Menu.Message },
	GotDeleteConfirmMessage: { message: ConfirmAction.Message },
	GotAddModalMessage: { message: Modal.Message },
	ChangedWorkspaceSearch: { value: Schema.String },
	FocusedWorkspaceSearch: {},
	BlurredWorkspaceSearch: {},
	CompletedFocusWorkspaceSearch: {},
	ClickedWorkspace: { workspace: Workspace },
	ClickedChangeWorkspace: {},
	ClickedOpenIntegration: {},
	ClickedConnect: {},
	SucceededCreateConnection: {},
	FailedCreateConnection: { reason: CreateConnectionFailure },
	GotInteractionMessage: { message: Interaction.Message },
	ClickedImport: {},
	GotMigrationModalMessage: { message: Modal.Message },
	GotMigrationMessage: { message: ChatMigration.Message },
	UpdatedHazelChannels: { channels: Schema.Array(HazelChannel) },
	ClickedAddEmailInbox: {},
	ClickedEditEmailInbox: { inbox: EmailInbox },
	ClickedEmailSetup: { inbox: EmailInbox },
	GotEmailModalMessage: { message: Modal.Message },
	ChangedEmailName: { value: Schema.String },
	ChangedEmailSupportAddress: { value: Schema.String },
	ChangedEmailChannelSearch: { value: Schema.String },
	FocusedEmailChannelSearch: {},
	BlurredEmailChannelSearch: {},
	ClickedEmailChannel: { channel: HazelChannel },
	ClickedChangeEmailChannel: {},
	ClickedSubmitEmailInbox: {},
	SucceededCreateEmailInbox: { inbox: EmailInbox },
	SucceededUpdateEmailInbox: {},
	FailedSaveEmailInbox: { reason: EmailInboxFailure },
	ClickedCopyInboundAddress: { address: Schema.String },
	SucceededCopyInboundAddress: {},
	FailedCopyInboundAddress: {},
	ClickedRemoveEmailInbox: { target: DeleteTarget },
	ClickedConfirmRemoveEmailInbox: {},
	SucceededRemoveEmailInbox: {},
	FailedRemoveEmailInbox: { reason: DeleteConnectionFailure },
	GotRemoveInboxConfirmMessage: { message: ConfirmAction.Message },
})
export type Message = typeof Message.Type

export const STATUS_CONFIG: Readonly<
	Record<
		ConnectionStatus,
		{ readonly label: string; readonly dotClass: string; readonly textClass: string }
	>
> = {
	active: { label: "Active", dotClass: "bg-success", textClass: "text-success" },
	paused: { label: "Paused", dotClass: "bg-warning", textClass: "text-warning" },
	error: { label: "Error", dotClass: "bg-danger", textClass: "text-danger" },
	disabled: { label: "Disabled", dotClass: "bg-secondary", textClass: "text-muted-fg" },
}

/** The add menu: one item per provider, keyed by its id. */
export const addMenuEntries: ReadonlyArray<Menu.Entry> = ChatSyncProvider.literals.map((provider) =>
	Menu.item(provider),
)

/** The workspace Connect creates: the picked Discord server, or Slack's one installed workspace. */
export const chosenWorkspace = (model: Model): Workspace | null => {
	if (PROVIDERS[model.addProvider].picksWorkspace) return model.selectedWorkspace
	return AsyncData.isSuccess(model.workspaces) ? (model.workspaces.data[0] ?? null) : null
}

/** A closed, empty inbox form. */
export const emptyEmailForm: EmailForm = {
	step: EmailStep.Create(),
	name: "",
	supportAddress: "",
	channel: null,
	channelSearch: "",
	isChannelSearchFocused: false,
	isValidated: false,
	submission: EmailSubmission.NotSubmitted(),
}
