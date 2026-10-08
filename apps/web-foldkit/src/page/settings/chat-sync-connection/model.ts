import { ChannelId, OrganizationId, SyncChannelLinkId, SyncConnectionId } from "@hazel/schema"
import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import * as Interaction from "../../../ui/aria/interaction"
import * as Menu from "../../../ui/menu"
import * as Modal from "../../../ui/modal"
import { DiscordChannel, DiscordResource } from "../chat-sync/discord"
import { Connection } from "../chat-sync/model"

export const SyncDirection = Schema.Literals(["both", "hazel_to_external", "external_to_hazel"])
export type SyncDirection = typeof SyncDirection.Type

export const WebhookPermission = Schema.Literals(["allowed", "denied", "unknown"])
export type WebhookPermission = typeof WebhookPermission.Type

export const ChannelLink = Schema.Struct({
	id: SyncChannelLinkId,
	hazelChannelId: ChannelId,
	/** `externalChannelName || externalChannelId` */
	externalName: Schema.String,
	direction: SyncDirection,
	isActive: Schema.Boolean,
	webhookPermission: WebhookPermission,
})
export type ChannelLink = typeof ChannelLink.Type

/** The connection list query: loading, or the connection (none when it is not in the list). */
export const ConnectionState = Schema.Union([
	Schema.TaggedStruct("Loading", {}),
	Schema.TaggedStruct("Loaded", { connection: Schema.NullOr(Connection) }),
])

export const LinksState = Schema.Union([
	Schema.TaggedStruct("Loading", {}),
	Schema.TaggedStruct("Loaded", { links: Schema.Array(ChannelLink) }),
])

/** A Hazel channel as `AddChannelLinkModal` lists it. */
export const HazelChannel = Schema.Struct({ id: ChannelId, name: Schema.String })
export type HazelChannel = typeof HazelChannel.Type

export const LinkTarget = Schema.Struct({ id: SyncChannelLinkId, name: Schema.String })

export const Model = Schema.Struct({
	connectionId: SyncConnectionId,
	requestedOrganizationId: Schema.NullOr(OrganizationId),
	connection: ConnectionState,
	links: LinksState,
	/** Bumped per links request (every create / remove / update reloads); an older list is dropped. */
	linksVersion: Schema.Number,
	/** Links with a pause / resume / direction update in flight; a repeat is ignored. */
	updatingLinkIds: Schema.Array(SyncChannelLinkId),
	/** Hazel channel names for the linked channels (the per-row `channelCollection` lookup). */
	channelNames: Schema.Record(Schema.String, Schema.String),
	linkMenus: Schema.Array(Menu.Model),
	/** `AddChannelLinkModal`: open state, its queries (run once the connection is found) and form. */
	addLinkModal: Modal.Model,
	discordChannels: DiscordResource(DiscordChannel),
	hazelChannels: Schema.Array(HazelChannel),
	selectedChannel: Schema.NullOr(HazelChannel),
	selectedDiscordChannel: Schema.NullOr(DiscordChannel),
	direction: SyncDirection,
	channelSearch: Schema.String,
	discordChannelSearch: Schema.String,
	focusedSearch: Schema.NullOr(Schema.Literals(["hazel", "discord"])),
	isCreatingLink: Schema.Boolean,
	deleteTarget: Schema.NullOr(LinkTarget),
	deleteLinkModal: Modal.Model,
	isDeletingLink: Schema.Boolean,
	disconnectModal: Modal.Model,
	isDisconnecting: Schema.Boolean,
	/** Hover, press and focus of the link modal's Link Channel button. */
	interaction: Interaction.Model,
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
	SucceededListConnections: { organizationId: OrganizationId, connections: Schema.Array(Connection) },
	FailedListConnections: { organizationId: OrganizationId },
	SucceededListDiscordChannels: { guildId: Schema.String, channels: Schema.Array(DiscordChannel) },
	FailedListDiscordChannels: { guildId: Schema.String },
	SucceededListChannelLinks: { version: Schema.Number, links: Schema.Array(ChannelLink) },
	FailedListChannelLinks: { version: Schema.Number },
	UpdatedChannelNames: { names: Schema.Record(Schema.String, Schema.String) },
	ClickedBack: {},
	ClickedDisconnect: {},
	ClickedConfirmDisconnect: {},
	SucceededDisconnect: {},
	FailedDisconnect: { title: Schema.String, description: Schema.NullOr(Schema.String) },
	ClickedLinkChannel: {},
	ClickedConfirmRemoveLink: {},
	SucceededRemoveLink: {},
	SucceededUpdateLink: { linkId: SyncChannelLinkId, successMessage: Schema.String },
	FailedUpdateLink: {
		linkId: SyncChannelLinkId,
		title: Schema.String,
		description: Schema.NullOr(Schema.String),
	},
	FailedRemoveLink: { title: Schema.String, description: Schema.NullOr(Schema.String) },
	GotLinkMenuMessage: { linkId: SyncChannelLinkId, message: Menu.Message },
	GotDeleteLinkModalMessage: { message: Modal.Message },
	GotDisconnectModalMessage: { message: Modal.Message },
	GotAddLinkModalMessage: { message: Modal.Message },
	UpdatedHazelChannels: { channels: Schema.Array(HazelChannel) },
	ChangedChannelSearch: { value: Schema.String },
	ChangedDiscordChannelSearch: { value: Schema.String },
	FocusedSearch: { search: Schema.Literals(["hazel", "discord"]) },
	BlurredSearch: {},
	CompletedFocusChannelSearch: {},
	ClickedHazelChannel: { channel: HazelChannel },
	ClickedChangeHazelChannel: {},
	ClickedDiscordChannel: { channel: DiscordChannel },
	ClickedChangeDiscordChannel: {},
	ClickedDirection: { direction: SyncDirection },
	ClickedCreateLink: {},
	SucceededCreateLink: { successMessage: Schema.String },
	FailedCreateLink: { title: Schema.String, description: Schema.NullOr(Schema.String) },
	GotInteractionMessage: { message: Interaction.Message },
})
export type Message = typeof Message.Type

export const DIRECTION_LABELS: Readonly<Record<SyncDirection, string>> = {
	both: "Both",
	hazel_to_external: "Hazel to Discord",
	external_to_hazel: "Discord to Hazel",
}

export const ADD_LINK_MODAL_ID = "chat-sync-add-link"
export const CHANNEL_SEARCH_ID = `${ADD_LINK_MODAL_ID}-search`

export const linkMenuId = (linkId: string) => `chat-sync-link-${linkId}`

export const linkMenuEntries: ReadonlyArray<Menu.Entry> = [
	Menu.item("direction", {
		submenu: SyncDirection.literals.map((direction) => Menu.leaf(direction)),
	}),
	Menu.item("toggle"),
	Menu.separator,
	Menu.item("remove", { intent: "Danger" }),
]
