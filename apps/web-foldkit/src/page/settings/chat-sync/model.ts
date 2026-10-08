import { OrganizationId, SyncConnectionId } from "@hazel/schema"
import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import * as Interaction from "../../../ui/aria/interaction"
import * as Menu from "../../../ui/menu"
import * as Modal from "../../../ui/modal"
import { DiscordGuild, DiscordResource } from "./discord"

export const ConnectionStatus = Schema.Literals(["active", "paused", "error", "disabled"])
export type ConnectionStatus = typeof ConnectionStatus.Type

export const Connection = Schema.Struct({
	id: SyncConnectionId,
	/** `externalWorkspaceName || "Discord Server"` */
	displayName: Schema.String,
	status: ConnectionStatus,
	externalWorkspaceId: Schema.String,
	errorMessage: Schema.NullOr(Schema.String),
	lastSyncedAtMs: Schema.NullOr(Schema.Number),
})
export type Connection = typeof Connection.Type

/** `HazelRpcClient.query("chatSync.connection.list")` as AsyncResult: initial, failure or success. */
export const Connections = Schema.Union([
	Schema.TaggedStruct("Loading", {}),
	Schema.TaggedStruct("Failed", {}),
	Schema.TaggedStruct("Loaded", { connections: Schema.Array(Connection) }),
])
export type Connections = typeof Connections.Type

export const DeleteTarget = Schema.Struct({ id: SyncConnectionId, name: Schema.String })

export const Model = Schema.Struct({
	/** The organization the list was requested for; the query reruns when it changes. */
	requestedOrganizationId: Schema.NullOr(OrganizationId),
	connections: Connections,
	addMenu: Menu.Model,
	emptyAddMenu: Menu.Model,
	/** `AddConnectionModal`: open state, its guild query (run whenever the modal mounts) and form. */
	addModal: Modal.Model,
	discordGuilds: DiscordResource(DiscordGuild),
	/** Bumped per guild request; a list for an older request or another organization is dropped. */
	guildsVersion: Schema.Number,
	selectedGuild: Schema.NullOr(DiscordGuild),
	guildSearch: Schema.String,
	isGuildSearchFocused: Schema.Boolean,
	isCreating: Schema.Boolean,
	deleteTarget: Schema.NullOr(DeleteTarget),
	deleteModal: Modal.Model,
	isDeleting: Schema.Boolean,
	/** Hover, press and focus of the add modal's search Input and Connect button. */
	interaction: Interaction.Model,
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
	SucceededListConnections: { organizationId: OrganizationId, connections: Schema.Array(Connection) },
	FailedListConnections: { organizationId: OrganizationId },
	SucceededListDiscordGuilds: {
		organizationId: OrganizationId,
		version: Schema.Number,
		guilds: Schema.Array(DiscordGuild),
	},
	FailedListDiscordGuilds: { organizationId: OrganizationId, version: Schema.Number },
	ClickedConnection: { connectionId: SyncConnectionId },
	ClickedDeleteConnection: { target: DeleteTarget },
	ClickedConfirmDelete: {},
	SucceededDeleteConnection: {},
	FailedDeleteConnection: { title: Schema.String, description: Schema.NullOr(Schema.String) },
	GotAddMenuMessage: { message: Menu.Message },
	GotEmptyAddMenuMessage: { message: Menu.Message },
	GotDeleteModalMessage: { message: Modal.Message },
	GotAddModalMessage: { message: Modal.Message },
	ChangedGuildSearch: { value: Schema.String },
	FocusedGuildSearch: {},
	BlurredGuildSearch: {},
	CompletedFocusGuildSearch: {},
	ClickedGuild: { guild: DiscordGuild },
	ClickedChangeGuild: {},
	ClickedOpenDiscordIntegration: {},
	ClickedConnect: {},
	SucceededCreateConnection: {},
	FailedCreateConnection: { title: Schema.String, description: Schema.NullOr(Schema.String) },
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

export const addMenuEntries: ReadonlyArray<Menu.Entry> = [
	Menu.item("discord"),
	Menu.separator,
	Menu.item("slack", { isDisabled: true }),
]
