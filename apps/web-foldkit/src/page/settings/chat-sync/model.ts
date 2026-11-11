import { OrganizationId, SyncConnectionId } from "@hazel/schema"
import { Schema } from "effect"
import * as AsyncData from "foldkit/asyncData"
import { defineMessageUnion } from "foldkit/message"
import { defineTaggedUnion } from "foldkit/schema"
import { CommonReason } from "~/lib/error-messages"
import * as Interaction from "../../../ui/aria/interaction"
import * as Menu from "../../../ui/menu"
import * as Modal from "../../../ui/modal"
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
	lastSyncedAtMs: Schema.NullOr(Schema.Number),
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
	workspacesVersion: Schema.Number,
	/** The picked Discord server (Slack has its one installed workspace). */
	selectedWorkspace: Schema.NullOr(Workspace),
	workspaceSearch: Schema.String,
	isWorkspaceSearchFocused: Schema.Boolean,
	submission: Submission,
	deleteConfirm: ConfirmAction.Model(DeleteTarget),
	/** Hover, press and focus of the add modal's search Input and Connect button. */
	interaction: Interaction.Model,
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
	SucceededListConnections: { organizationId: OrganizationId, connections: Schema.Array(Connection) },
	FailedListConnections: { organizationId: OrganizationId, reason: CommonReason },
	ClickedRetryListConnections: {},
	SucceededListWorkspaces: {
		organizationId: OrganizationId,
		version: Schema.Number,
		workspaces: Schema.Array(Workspace),
	},
	FailedListWorkspaces: {
		organizationId: OrganizationId,
		version: Schema.Number,
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
