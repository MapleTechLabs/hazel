import { OrganizationId, SyncConnectionId } from "@hazel/schema"
import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
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
	/** `AddConnectionModal isOpen` (the modal itself is not ported yet). */
	isAddModalOpen: Schema.Boolean,
	/** The modal's guild query, which runs whenever the modal mounts (the list has loaded). */
	discordGuilds: DiscordResource(DiscordGuild),
	deleteTarget: Schema.NullOr(DeleteTarget),
	deleteModal: Modal.Model,
	isDeleting: Schema.Boolean,
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
	SucceededListConnections: { organizationId: OrganizationId, connections: Schema.Array(Connection) },
	FailedListConnections: { organizationId: OrganizationId },
	SucceededListDiscordGuilds: { guilds: Schema.Array(DiscordGuild) },
	FailedListDiscordGuilds: {},
	ClickedConnection: { connectionId: SyncConnectionId },
	ClickedDeleteConnection: { target: DeleteTarget },
	ClickedConfirmDelete: {},
	SucceededDeleteConnection: {},
	FailedDeleteConnection: { title: Schema.String, description: Schema.NullOr(Schema.String) },
	GotAddMenuMessage: { message: Menu.Message },
	GotEmptyAddMenuMessage: { message: Menu.Message },
	GotDeleteModalMessage: { message: Modal.Message },
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
