import { ChannelId, OrganizationId, SyncChannelLinkId, SyncConnectionId } from "@hazel/schema"
import { Option, Schema } from "effect"
import * as AsyncData from "foldkit/asyncData"
import { defineMessageUnion } from "foldkit/message"
import { defineTaggedUnion } from "foldkit/schema"
import { CommonReason, failureMessage, type UserErrorMessage } from "~/lib/error-messages"
import * as SuggestionPrompt from "../../../customers/suggestion-prompt"
import * as Interaction from "../../../ui/aria/interaction"
import * as Menu from "../../../ui/menu"
import * as Modal from "../../../ui/modal"
import * as ConfirmAction from "../../shared/confirm-action"
import { ToastRequest } from "../../../overlay/toasts"
import {
	type ChatSyncProvider,
	ExternalChannel,
	ExternalChannels,
	PROVIDERS,
	ResourceFailure,
} from "../chat-sync/providers"
import { Connection, DeleteConnectionFailure } from "../chat-sync/model"

export const SyncDirection = Schema.Literals(["both", "hazel_to_external", "external_to_hazel"])
export type SyncDirection = typeof SyncDirection.Type

/** How many of the external channel's latest messages a new link imports (`none`: only new ones). */
export const HistoryImport = Schema.Literals(["none", "100", "500"])
export type HistoryImport = typeof HistoryImport.Type

/** `chatSync.channelLink.create`'s `historyLimit` for a choice; none when nothing flows into Hazel. */
export const historyLimitOf = (history: HistoryImport, direction: SyncDirection): number =>
	history === "none" || direction === "hazel_to_external" ? 0 : Number(history)

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

/** The connection list query: the connection, or `null` when it is not in the list. */
export const ConnectionLookup = AsyncData.Schema(Schema.NullOr(Connection), CommonReason)

export const ListLinksFailure = Schema.Union([Schema.Literal("ConnectionNotFound"), CommonReason])
export type ListLinksFailure = typeof ListLinksFailure.Type

export const ChannelLinks = AsyncData.Schema(Schema.Array(ChannelLink), ListLinksFailure)

export const listLinksFailureMessage = (reason: ListLinksFailure): UserErrorMessage =>
	failureMessage(reason, {
		ConnectionNotFound: {
			title: "Connection not found",
			description: "This sync connection may have been deleted.",
		},
	})

/** Removing, pausing, resuming or redirecting a link. */
export const LinkFailure = Schema.Union([Schema.Literal("LinkNotFound"), CommonReason])
export type LinkFailure = typeof LinkFailure.Type

export const CreateLinkFailure = Schema.Union([
	Schema.Literals(["ConnectionNotFound", "AlreadyLinked"]),
	CommonReason,
])
export type CreateLinkFailure = typeof CreateLinkFailure.Type

/**
 * The link modal's Link Channel: not pressed yet, creating the new Hazel channel, linking, or failed
 * (the modal stays open to retry).
 */
export const Submission = defineTaggedUnion({
	NotSubmitted: {},
	CreatingChannel: {},
	Submitting: {},
	Failed: { reason: CreateLinkFailure },
})
export type Submission = typeof Submission.Type

/** A Hazel channel as `AddChannelLinkModal` lists it. */
export const HazelChannel = Schema.Struct({ id: ChannelId, name: Schema.String })
export type HazelChannel = typeof HazelChannel.Type

/** Link to a channel the org already has, or create a new one for the link. */
export const HazelChannelMode = Schema.Literals(["existing", "new"])
export type HazelChannelMode = typeof HazelChannelMode.Type

export const LinkTarget = Schema.Struct({ id: SyncChannelLinkId, name: Schema.String })
export type LinkTarget = typeof LinkTarget.Type

export const Model = Schema.Struct({
	connectionId: SyncConnectionId,
	requestedOrganizationId: Schema.NullOr(OrganizationId),
	connection: ConnectionLookup.schema,
	links: ChannelLinks.schema,
	/** Bumped per links request (every create / remove / update reloads); an older list is dropped. */
	linksVersion: Schema.Number,
	/** Links with a pause / resume / direction update in flight; a repeat is ignored. */
	updatingLinkIds: Schema.Array(SyncChannelLinkId),
	/** Hazel channel names for the linked channels (the per-row `channelCollection` lookup). */
	channelNames: Schema.Record(Schema.String, Schema.String),
	linkMenus: Schema.Array(Menu.Model),
	/** `AddChannelLinkModal`: open state, its queries (run once the connection is found) and form. */
	addLinkModal: Modal.Model,
	externalChannels: ExternalChannels.schema,
	hazelChannels: Schema.Array(HazelChannel),
	selectedChannel: Schema.NullOr(HazelChannel),
	hazelChannelMode: HazelChannelMode,
	/** The new channel's name; follows the picked external channel's name until it is edited. */
	newChannelName: Schema.String,
	isNewChannelNameEdited: Schema.Boolean,
	selectedExternalChannel: Schema.NullOr(ExternalChannel),
	direction: SyncDirection,
	history: HistoryImport,
	channelSearch: Schema.String,
	externalChannelSearch: Schema.String,
	focusedSearch: Schema.NullOr(Schema.Literals(["hazel", "external"])),
	submission: Submission,
	removeLinkConfirm: ConfirmAction.Model(LinkTarget),
	/** Disconnecting deletes this page's connection. */
	disconnectConfirm: ConfirmAction.Model(SyncConnectionId),
	/** Hover, press and focus of the link modal's Link Channel button. */
	interaction: Interaction.Model,
	/** After a link: who the newly mirrored channel looks like (`customers.channel.suggestions`). */
	suggestion: SuggestionPrompt.Model,
	suggestionChannelName: Schema.NullOr(Schema.String),
	/** A channel linked before the membership row loaded: asked about once it has. */
	pendingSuggestion: Schema.NullOr(Schema.Struct({ channelId: ChannelId, channelName: Schema.String })),
})
export type Model = typeof Model.Type

export const Message = defineMessageUnion({
	SucceededListConnections: { organizationId: OrganizationId, connections: Schema.Array(Connection) },
	FailedListConnections: { organizationId: OrganizationId, reason: CommonReason },
	ClickedRetryLoadConnection: {},
	SucceededListExternalChannels: { workspaceId: Schema.String, channels: Schema.Array(ExternalChannel) },
	FailedListExternalChannels: { workspaceId: Schema.String, reason: ResourceFailure },
	ClickedRetryListExternalChannels: {},
	SucceededListChannelLinks: { version: Schema.Number, links: Schema.Array(ChannelLink) },
	FailedListChannelLinks: { version: Schema.Number, reason: ListLinksFailure },
	ClickedRetryListChannelLinks: {},
	UpdatedChannelNames: { names: Schema.Record(Schema.String, Schema.String) },
	ClickedBack: {},
	ClickedDisconnect: {},
	ClickedConfirmDisconnect: {},
	SucceededDisconnect: {},
	FailedDisconnect: { reason: DeleteConnectionFailure },
	ClickedLinkChannel: {},
	ClickedConfirmRemoveLink: {},
	SucceededRemoveLink: {},
	SucceededUpdateLink: { linkId: SyncChannelLinkId, successMessage: Schema.String },
	FailedUpdateLink: { linkId: SyncChannelLinkId, reason: LinkFailure },
	FailedRemoveLink: { reason: LinkFailure },
	GotLinkMenuMessage: { linkId: SyncChannelLinkId, message: Menu.Message },
	GotRemoveLinkConfirmMessage: { message: ConfirmAction.Message },
	GotDisconnectConfirmMessage: { message: ConfirmAction.Message },
	GotAddLinkModalMessage: { message: Modal.Message },
	UpdatedHazelChannels: { channels: Schema.Array(HazelChannel) },
	ChangedChannelSearch: { value: Schema.String },
	ChangedExternalChannelSearch: { value: Schema.String },
	FocusedSearch: { search: Schema.Literals(["hazel", "external"]) },
	BlurredSearch: {},
	CompletedFocusChannelSearch: {},
	ClickedHazelChannel: { channel: HazelChannel },
	ClickedChangeHazelChannel: {},
	ClickedHazelChannelMode: { mode: HazelChannelMode },
	ChangedNewChannelName: { value: Schema.String },
	/** The Hazel search's "Create #name" row: a new channel named after the search. */
	ClickedCreateChannelFromSearch: {},
	SucceededCreateHazelChannel: { channel: HazelChannel },
	FailedCreateHazelChannel: { toast: ToastRequest },
	ClickedExternalChannel: { channel: ExternalChannel },
	ClickedChangeExternalChannel: {},
	ClickedDirection: { direction: SyncDirection },
	ClickedHistory: { history: HistoryImport },
	ClickedCreateLink: {},
	SucceededCreateLink: {
		successMessage: Schema.String,
		hazelChannelId: ChannelId,
		hazelChannelName: Schema.String,
	},
	FailedCreateLink: { reason: CreateLinkFailure },
	GotInteractionMessage: { message: Interaction.Message },
	GotSuggestionMessage: { message: SuggestionPrompt.Message },
})
export type Message = typeof Message.Type

/** The connection, once the list has it (also while it refreshes). */
export const foundConnection = (model: Model): Connection | null =>
	Option.getOrNull(AsyncData.getData(model.connection))

/** The listed links, or none while the first list loads or after it failed. */
export const listedLinks = (model: Model): ReadonlyArray<ChannelLink> =>
	Option.getOrElse(AsyncData.getData(model.links), () => [])

/** "Both", "Hazel to Slack", "Slack to Hazel". */
export const directionLabel = (direction: SyncDirection, provider: ChatSyncProvider): string => {
	const { name } = PROVIDERS[provider]
	if (direction === "hazel_to_external") return `Hazel to ${name}`
	if (direction === "external_to_hazel") return `${name} to Hazel`
	return "Both"
}

export const ADD_LINK_MODAL_ID = "chat-sync-add-link"
export const CHANNEL_SEARCH_ID = `${ADD_LINK_MODAL_ID}-search`
export const EXTERNAL_SEARCH_ID = `${ADD_LINK_MODAL_ID}-external-search`
export const NEW_CHANNEL_NAME_ID = `${ADD_LINK_MODAL_ID}-new-name`

/** A Slack or Discord name as a Hazel channel name: trimmed, at most 80 characters. */
export const newChannelNameOf = (name: string): string => name.trim().slice(0, 80)

export const isSubmitting = (model: Model): boolean =>
	model.submission._tag === "Submitting" || model.submission._tag === "CreatingChannel"

/** Both sides are chosen: a picked or named Hazel channel, and a picked external channel. */
export const isLinkReady = (model: Model): boolean =>
	model.selectedExternalChannel !== null &&
	(model.hazelChannelMode === "new"
		? newChannelNameOf(model.newChannelName).length > 0
		: model.selectedChannel !== null)

export const linkMenuId = (linkId: string) => `chat-sync-link-${linkId}`

export const linkMenuEntries: ReadonlyArray<Menu.Entry> = [
	Menu.item("direction", {
		submenu: SyncDirection.literals.map((direction) => Menu.leaf(direction)),
	}),
	Menu.item("toggle"),
	Menu.separator,
	Menu.item("remove", { intent: "Danger" }),
]
