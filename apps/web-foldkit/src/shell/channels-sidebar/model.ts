import { ChannelId, OrganizationId, UserId } from "@hazel/schema"
import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import { ToastRequest } from "../../overlay/toasts"
import * as Menu from "../../ui/menu"
import {
	ChannelEntry,
	ConnectMount,
	DiscoverableChannel,
	DmChannel,
	Membership,
	PartnerOrg,
	Presence,
	Section,
	UnreadCount,
} from "./rows"

// MODEL

export const Model = Schema.Struct({
	organizationId: Schema.NullOr(OrganizationId),
	currentUserId: Schema.NullOr(UserId),
	/** `presenceNowSignal`: wall clock for deriving stale presence. */
	nowMs: Schema.Number,
	membership: Schema.NullOr(Membership),
	sections: Schema.Array(Section),
	/** Keyed by section id, `"default"` for channels without a section. */
	sectionChannels: Schema.Record(Schema.String, Schema.Array(ChannelEntry)),
	favorites: Schema.Array(ChannelEntry),
	dmChannelIds: Schema.Array(ChannelId),
	dmChannels: Schema.Record(Schema.String, Schema.NullOr(DmChannel)),
	presence: Schema.Array(Presence),
	unreadCounts: Schema.Array(UnreadCount),
	connectMounts: Schema.Array(ConnectMount),
	organizations: Schema.Array(PartnerOrg),
	memberChannelIds: Schema.NullOr(Schema.Array(ChannelId)),
	discoverableChannels: Schema.Array(DiscoverableChannel),
	/** `useFeatureHint("create-channel")`, persisted across organizations. */
	isCreateChannelHintDismissed: Schema.Boolean,
	/** The one open row or section menu (`channel:<id>` or `section:<key>`); closed menus are not kept. */
	openMenu: Schema.NullOr(
		Schema.Struct({ target: Schema.String, orgSlug: Schema.String, menu: Menu.Model }),
	),
})
export type Model = typeof Model.Type

// MESSAGE

export const SectionAction = Schema.Literals(["create-channel", "join-channel", "create-dm"])
export type SectionAction = typeof SectionAction.Type

export const Message = defineMessageUnion({
	CompletedScrollActiveIntoView: {},
	TickedPresenceClock: { nowMs: Schema.Number },
	UpdatedMembership: { membership: Schema.NullOr(Membership) },
	UpdatedSections: { sections: Schema.Array(Section) },
	UpdatedSectionChannels: { sectionKey: Schema.String, channels: Schema.Array(ChannelEntry) },
	UpdatedFavorites: { channels: Schema.Array(ChannelEntry) },
	UpdatedDmChannelIds: { channelIds: Schema.Array(ChannelId) },
	UpdatedDmChannel: { channelId: ChannelId, channel: Schema.NullOr(DmChannel) },
	UpdatedPresence: { presence: Schema.Array(Presence) },
	UpdatedUnreadCounts: { counts: Schema.Array(UnreadCount) },
	UpdatedConnectMounts: { mounts: Schema.Array(ConnectMount) },
	UpdatedOrganizations: { organizations: Schema.Array(PartnerOrg) },
	UpdatedMemberChannelIds: { channelIds: Schema.Array(ChannelId) },
	UpdatedDiscoverableChannels: { channels: Schema.Array(DiscoverableChannel) },
	/** "Browse channels"; the sidebar answers with `RequestedCommandPalette`. */
	ClickedBrowseChannels: {},
	LoadedDismissedHints: { isCreateChannelHintDismissed: Schema.Boolean },
	ClickedDismissCreateChannelHint: {},
	CompletedPersistDismissedHint: {},
	// The row menu's items link into the org; update has no shell context, so the view passes the slug along.
	// oxlint-disable-next-line foldkit/got-wrapper-carries-only-routing
	GotRowMenuMessage: { channelId: ChannelId, orgSlug: Schema.String, message: Menu.Message },
	GotSectionMenuMessage: { sectionId: Schema.String, message: Menu.Message },
	ClickedSectionAction: { action: SectionAction },
	SucceededSidebarAction: { toast: ToastRequest },
	FailedSidebarAction: { toast: ToastRequest },
})
export type Message = typeof Message.Type

export const emptyData = {
	membership: null,
	sections: [],
	sectionChannels: {},
	favorites: [],
	dmChannelIds: [],
	dmChannels: {},
	presence: [],
	unreadCounts: [],
	connectMounts: [],
	organizations: [],
	memberChannelIds: null,
	discoverableChannels: [],
	openMenu: null,
} satisfies Omit<Model, "organizationId" | "currentUserId" | "nowMs" | "isCreateChannelHintDismissed">
