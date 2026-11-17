import { ChannelId, OrganizationId, UserId } from "@hazel/schema"
import { Schema } from "effect"
import { defineMessageUnion } from "foldkit/message"
import { defineTaggedUnion } from "foldkit/schema"
import { CommonReason } from "~/lib/error-messages"
import * as Menu from "../../ui/menu"
import {
	ChannelEntry,
	ConnectMount,
	DiscoverableChannel,
	DmChannel,
	Membership,
	PartnerOrg,
	SyncedChannel,
	Presence,
	Section,
	SidebarThread,
	UnreadCount,
} from "./rows"

// MODEL

/** The one open menu: a channel row's dots menu or a section's "+" menu. Closed menus are not kept. */
export const OpenMenu = defineTaggedUnion({
	// The row menu's items link into the org, so the slug the view passed along stays with it.
	Row: { channelId: ChannelId, orgSlug: Schema.String, menu: Menu.Model },
	Section: { sectionKey: Schema.String, menu: Menu.Model },
})
export type OpenMenu = typeof OpenMenu.Type

export const Model = Schema.Struct({
	organizationId: Schema.NullOr(OrganizationId),
	currentUserId: Schema.NullOr(UserId),
	membership: Schema.NullOr(Membership),
	sections: Schema.Array(Section),
	/** Keyed by section id, `"default"` for channels without a section. */
	sectionChannels: Schema.Record(Schema.String, Schema.Array(ChannelEntry)),
	favorites: Schema.Array(ChannelEntry),
	/** Joined threads, nested under their parent channel's row. */
	threads: Schema.Array(SidebarThread),
	dmChannelIds: Schema.Array(ChannelId),
	dmChannels: Schema.Record(Schema.String, Schema.NullOr(DmChannel)),
	presence: Schema.Array(Presence),
	unreadCounts: Schema.Array(UnreadCount),
	connectMounts: Schema.Array(ConnectMount),
	organizations: Schema.Array(PartnerOrg),
	syncedChannels: Schema.Array(SyncedChannel),
	memberChannelIds: Schema.NullOr(Schema.Array(ChannelId)),
	discoverableChannels: Schema.Array(DiscoverableChannel),
	/** Which of the lists that start empty have arrived; an empty one is "none" only then. */
	loaded: Schema.Struct({
		sections: Schema.Boolean,
		favorites: Schema.Boolean,
		dmChannelIds: Schema.Boolean,
	}),
	/** `useFeatureHint("create-channel")`, persisted across organizations. */
	isCreateChannelHintDismissed: Schema.Boolean,
	openMenu: Schema.NullOr(OpenMenu),
})
export type Model = typeof Model.Type

// MESSAGE

export const SectionAction = Schema.Literals(["create-channel", "join-channel", "create-dm"])
export type SectionAction = typeof SectionAction.Type

/** What a sidebar menu write did; `update` turns it into the success toast. */
export const SidebarOutcome = Schema.Literals([
	"Muted",
	"Unmuted",
	"Favorited",
	"Unfavorited",
	"Hidden",
	"Unhidden",
	"Left",
	"MovedToSection",
	"MovedToDefault",
	"SectionDeleted",
])
export type SidebarOutcome = typeof SidebarOutcome.Type

/** What can go wrong in a sidebar menu write, beyond the shared reasons. */
export const SidebarFailure = Schema.Union([
	Schema.Literals(["MemberNotFound", "ChannelNotFound", "SectionNotFound", "SectionAlreadyDeleted"]),
	CommonReason,
])
export type SidebarFailure = typeof SidebarFailure.Type

export const Message = defineMessageUnion({
	CompletedScrollActiveIntoView: {},
	UpdatedMembership: { membership: Schema.NullOr(Membership) },
	UpdatedSections: { sections: Schema.Array(Section) },
	UpdatedSectionChannels: { sectionKey: Schema.String, channels: Schema.Array(ChannelEntry) },
	UpdatedFavorites: { channels: Schema.Array(ChannelEntry) },
	UpdatedThreads: { threads: Schema.Array(SidebarThread) },
	UpdatedDmChannelIds: { channelIds: Schema.Array(ChannelId) },
	UpdatedDmChannel: { channelId: ChannelId, channel: Schema.NullOr(DmChannel) },
	UpdatedPresence: { presence: Schema.Array(Presence) },
	UpdatedUnreadCounts: { counts: Schema.Array(UnreadCount) },
	UpdatedConnectMounts: { mounts: Schema.Array(ConnectMount) },
	UpdatedOrganizations: { organizations: Schema.Array(PartnerOrg) },
	UpdatedSyncedChannels: { synced: Schema.Array(SyncedChannel) },
	UpdatedMemberChannelIds: { channelIds: Schema.Array(ChannelId) },
	UpdatedDiscoverableChannels: { channels: Schema.Array(DiscoverableChannel) },
	/** "Browse channels"; the sidebar answers with `RequestedCommandPalette`. */
	ClickedBrowseChannels: {},
	ClickedDismissCreateChannelHint: {},
	CompletedPersistDismissedHint: {},
	FailedPersistDismissedHint: {},
	// The row menu's items link into the org; update has no shell context, so the view passes the slug along.
	// oxlint-disable-next-line foldkit/got-wrapper-carries-only-routing
	GotRowMenuMessage: { channelId: ChannelId, orgSlug: Schema.String, message: Menu.Message },
	GotSectionMenuMessage: { sectionId: Schema.String, message: Menu.Message },
	ClickedSectionAction: { action: SectionAction },
	SucceededSidebarAction: { outcome: SidebarOutcome },
	FailedSidebarAction: { reason: SidebarFailure },
})
export type Message = typeof Message.Type

export const emptyData = {
	membership: null,
	sections: [],
	sectionChannels: {},
	favorites: [],
	threads: [],
	dmChannelIds: [],
	dmChannels: {},
	presence: [],
	unreadCounts: [],
	connectMounts: [],
	organizations: [],
	syncedChannels: [],
	memberChannelIds: null,
	discoverableChannels: [],
	loaded: { sections: false, favorites: false, dmChannelIds: false },
	openMenu: null,
} satisfies Omit<Model, "organizationId" | "currentUserId" | "isCreateChannelHintDismissed">

/**
 * Whether a list the sidebar draws has not arrived yet. Each comes from its own query, so the
 * sidebar draws them one by one; until the last one is in, it must not count as the screen (the
 * last screen's paint stays up, `app/paint.ts`), or it shows empty sections that then fill in.
 */
export const isLoading = (model: Model): boolean =>
	model.memberChannelIds === null ||
	!model.loaded.sections ||
	!model.loaded.favorites ||
	!model.loaded.dmChannelIds ||
	!("default" in model.sectionChannels) ||
	model.sections.some((section) => !(section.id in model.sectionChannels)) ||
	model.dmChannelIds.some((channelId) => !(channelId in model.dmChannels))
