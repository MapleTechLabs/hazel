/**
 * The channel sidebar's rows, as its live queries project them (`queries.ts`), and the pure rules
 * today's sidebar applies to them (`web-foldkit/src/shell/channels-sidebar/`): which rows show, in
 * which section, muted or unread, and each row's and section's menu entries with today's keys.
 */
import { ChannelId, ChannelMemberId, ChannelSectionId, OrganizationId, UserId } from "@hazel/schema"
import type { Content } from "@hazel/ui/vocabulary/index"
import { Schema } from "effect"

export const NotificationLevel = Schema.Literals(["all", "mentions", "nothing"])
export type NotificationLevel = typeof NotificationLevel.Type

/** A channel the user is a member of (not a thread), with the member's own settings. */
export const Entry = Schema.Struct({
	id: ChannelId,
	name: Schema.String,
	type: Schema.String,
	icon: Schema.NullOr(Schema.String),
	sectionId: Schema.NullOr(ChannelSectionId),
	memberId: ChannelMemberId,
	isMuted: Schema.Boolean,
	mutedUntilMs: Schema.NullOr(Schema.Finite),
	notificationLevel: Schema.NullOr(NotificationLevel),
	isFavorite: Schema.Boolean,
	notificationCount: Schema.Finite,
})
export type Entry = typeof Entry.Type

export const Thread = Schema.Struct({
	id: ChannelId,
	name: Schema.String,
	parentChannelId: ChannelId,
	createdAtMs: Schema.Finite,
	notificationCount: Schema.Finite,
})
export type Thread = typeof Thread.Type

export const Section = Schema.Struct({ id: ChannelSectionId, name: Schema.String })
export type Section = typeof Section.Type

export const Person = Schema.Struct({
	userId: UserId,
	firstName: Schema.String,
	lastName: Schema.String,
	avatarUrl: Schema.NullOr(Schema.String),
})
export type Person = typeof Person.Type

export const Presence = Schema.Struct({
	userId: UserId,
	status: Schema.NullOr(Schema.String),
	statusEmoji: Schema.NullOr(Schema.String),
})
export type Presence = typeof Presence.Type

export const Customer = Schema.Struct({
	channelId: ChannelId,
	accountName: Schema.String,
	accountLogoUrl: Schema.NullOr(Schema.String),
})
export type Customer = typeof Customer.Type

export const Synced = Schema.Struct({ channelId: ChannelId, provider: Schema.Literals(["slack", "discord"]) })
export type Synced = typeof Synced.Type

/** The user's own notification settings for a section, or (with `sectionId` null) the organization. */
export const ScopeSetting = Schema.Struct({
	sectionId: Schema.NullOr(ChannelSectionId),
	isMuted: Schema.Boolean,
	mutedUntilMs: Schema.NullOr(Schema.Finite),
	notificationLevel: Schema.NullOr(NotificationLevel),
})
export type ScopeSetting = typeof ScopeSetting.Type

/** A channel with messages the user has not read; `mutedUntilMs` hides it until then. */
export const Unread = Schema.Struct({ channelId: ChannelId, mutedUntilMs: Schema.NullOr(Schema.Finite) })
export type Unread = typeof Unread.Type

export const Discoverable = Schema.Struct({
	id: ChannelId,
	name: Schema.String,
	icon: Schema.NullOr(Schema.String),
})
export type Discoverable = typeof Discoverable.Type

export const Org = Schema.Struct({
	id: OrganizationId,
	name: Schema.String,
	logoUrl: Schema.NullOr(Schema.String),
})
export type Org = typeof Org.Type

export const Me = Schema.Struct({
	firstName: Schema.String,
	lastName: Schema.String,
	email: Schema.String,
	avatarUrl: Schema.NullOr(Schema.String),
})
export type Me = typeof Me.Type

/** Roles with `channels:write`, which `channel.create` and `channel.delete` need (`role-scopes.ts`). */
export const canManageChannels = (role: string | null) => role === "owner" || role === "admin"
/** Creating channels needs the same role as managing them, today. */
export const canCreateChannels = (role: string | null) => canManageChannels(role)

export const isDmType = (type: string) => type === "direct" || type === "single"

export const isMutedNow = (
	setting: { readonly isMuted: boolean; readonly mutedUntilMs: number | null },
	nowMs: number,
) => setting.isMuted || (setting.mutedUntilMs !== null && setting.mutedUntilMs > nowMs)

const defaultLevelOf = (type: string): NotificationLevel =>
	isDmType(type) || type === "thread" ? "all" : "mentions"

export const levelLabels = {
	all: "All messages",
	mentions: "Only @mentions",
	nothing: "Nothing",
} as const satisfies { readonly [L in NotificationLevel]: string }

/** Today's mute lengths (`notification-settings.ts`); keys `mute:<minutes>` and `mute:forever`. */
export const muteDurations: ReadonlyArray<{ readonly key: string; readonly label: string }> = [
	{ key: "mute:15", label: "For 15 minutes" },
	{ key: "mute:60", label: "For 1 hour" },
	{ key: "mute:480", label: "For 8 hours" },
	{ key: "mute:1440", label: "For 24 hours" },
	{ key: "mute:forever", label: "Until I turn it back on" },
]

const LEVELS: ReadonlyArray<NotificationLevel | null> = [null, "all", "mentions", "nothing"]
export const levelKeyOf = (level: NotificationLevel | null) => `level:${level ?? "default"}`

/** "Unmute" while muted, else "Mute" with how long. */
const muteEntry = (isMuted: boolean): Content.MenuEntry =>
	isMuted
		? { id: "mute", label: "Unmute", icon: "bell" }
		: {
				id: "mute",
				label: "Mute",
				icon: "volume-mute",
				entries: muteDurations.map(({ key, label }) => ({ id: key, label })),
			}

/** The mute item, and Notifications with its levels (`chat/notification-menu.ts`). */
const notificationEntries = (
	isMuted: boolean,
	level: NotificationLevel | null,
	inheritedLevel: NotificationLevel,
): ReadonlyArray<Content.MenuEntry> => [
	muteEntry(isMuted),
	{
		id: "notifications",
		label: "Notifications",
		icon: "bell",
		entries: LEVELS.map((candidate) => ({
			id: levelKeyOf(candidate),
			label: candidate === null ? `Default (${levelLabels[inheritedLevel]})` : levelLabels[candidate],
			checked: candidate === level,
		})),
	},
]

export const DEFAULT_SECTION_KEY = "section:default"
export const sectionKeyOf = (sectionId: ChannelSectionId | null) =>
	sectionId === null ? DEFAULT_SECTION_KEY : `section:${sectionId}`

/** A channel row's menu (`rowMenuEntries`): the same keys, so a host can act on them as today. */
export const channelMenu = (
	entry: Entry,
	options: {
		readonly isMuted: boolean
		readonly inheritedLevel: NotificationLevel
		readonly sections: ReadonlyArray<Section>
		readonly canDelete: boolean
		/** A Customers row: the customer link, not a section, places it. */
		readonly isCustomerRow: boolean
	},
): Content.MenuGroups => [
	{
		entries: [
			...notificationEntries(options.isMuted, entry.notificationLevel, options.inheritedLevel),
			{ id: "favorite", label: entry.isFavorite ? "Unfavorite" : "Favorite", icon: "star" },
			...(options.sections.length > 0 && !options.isCustomerRow
				? [
						{
							// HAZEL-GAP(icon-folder): today's "Move to section" shows a folder icon; IconName has none.
							id: "move",
							label: "Move to section",
							entries: [
								{
									id: DEFAULT_SECTION_KEY,
									label: "Channels (Default)",
									checked: entry.sectionId === null,
								},
								...options.sections.map((section) => ({
									id: sectionKeyOf(section.id),
									label: section.name,
									checked: entry.sectionId === section.id,
								})),
							],
						},
					]
				: []),
		],
	},
	{
		entries: [
			{ id: "settings", label: "Settings", icon: "gear" },
			...(options.canDelete
				? [{ id: "delete", label: "Delete", icon: "trash" as const, destructive: true }]
				: []),
		],
	},
	{ entries: [{ id: "leave", label: "Leave", icon: "leave", destructive: true }] },
]

/** A DM row's menu (`dmMenuEntries`). */
export const dmMenu = (entry: Entry, isMuted: boolean): Content.MenuGroups => [
	{
		entries: [
			muteEntry(isMuted),
			{ id: "favorite", label: entry.isFavorite ? "Unfavorite" : "Favorite", icon: "star" },
		],
	},
	{ entries: [{ id: "hide", label: "Hide conversation", icon: "close", destructive: true }] },
]

export const SectionAction = Schema.Literals(["create-channel", "join-channel", "create-dm"])
export type SectionAction = typeof SectionAction.Type

export const sectionActionLabel = (action: SectionAction): string =>
	action === "create-channel"
		? "Create new channel"
		: action === "join-channel"
			? "Join existing channel"
			: "Start a conversation"

/** `sectionActionsOf`: DMs start a conversation; channel sections create (if allowed) and join. */
export const sectionActionsOf = (
	sectionKey: string,
	role: string | null,
): { readonly actions: ReadonlyArray<SectionAction>; readonly isEditable: boolean } =>
	sectionKey === "dms"
		? { actions: ["create-dm"], isEditable: false }
		: {
				actions: [...(canCreateChannels(role) ? ["create-channel" as const] : []), "join-channel"],
				isEditable: sectionKey !== "default",
			}

/** A section's "+" menu (`sectionMenuEntries`): its actions, its notifications, "Delete section". */
export const sectionMenu = (
	actions: ReadonlyArray<SectionAction>,
	isEditable: boolean,
	notifications: {
		readonly isMuted: boolean
		readonly level: NotificationLevel | null
		readonly inherited: NotificationLevel
	} | null,
): Content.MenuGroups => [
	{
		entries: actions.map((action) => ({
			id: action,
			label: sectionActionLabel(action),
			icon: action === "join-channel" ? ("hashtag" as const) : ("plus" as const),
		})),
	},
	...(notifications === null
		? []
		: [
				{
					entries: notificationEntries(
						notifications.isMuted,
						notifications.level,
						notifications.inherited,
					),
				},
			]),
	...(isEditable
		? [
				{
					entries: [
						{
							id: "delete-section",
							label: "Delete section",
							icon: "trash" as const,
							destructive: true,
						},
					],
				},
			]
		: []),
]

/** `inheritedLevelOf`: the section's level, else the organization's, else the type's default. */
export const inheritedLevelOf = (
	type: string,
	sectionLevel: NotificationLevel | null | undefined,
	organizationLevel: NotificationLevel | null | undefined,
): NotificationLevel =>
	isDmType(type) || type === "thread"
		? defaultLevelOf(type)
		: (sectionLevel ?? organizationLevel ?? defaultLevelOf(type))

const RECENT_THREAD_MS = 7 * 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000

/** Listed threads: recent (by the hour), unread, or the one the route shows (`threadsByParentOf`). */
export const listedThreads = (
	threads: ReadonlyArray<Thread>,
	activeChannelId: ChannelId | null,
	nowMs: number,
	unread: ReadonlySet<string>,
): ReadonlyMap<string, ReadonlyArray<Thread>> => {
	const cutoffMs = Math.floor(nowMs / HOUR_MS) * HOUR_MS - RECENT_THREAD_MS
	const result = new Map<string, Array<Thread>>()
	for (const thread of threads) {
		const isListed =
			thread.id === activeChannelId ||
			thread.notificationCount > 0 ||
			unread.has(thread.id) ||
			thread.createdAtMs >= cutoffMs
		if (!isListed) continue
		const siblings = result.get(thread.parentChannelId)
		if (siblings === undefined) result.set(thread.parentChannelId, [thread])
		else siblings.push(thread)
	}
	return result
}

/** The unread channels, less the ones muted until later. */
export const unreadSetOf = (unread: ReadonlyArray<Unread>, nowMs: number): ReadonlySet<string> =>
	new Set(
		unread.flatMap(({ channelId, mutedUntilMs }) =>
			mutedUntilMs !== null && mutedUntilMs > nowMs ? [] : [channelId],
		),
	)

/** `dmDisplayName`: a single DM's partner's full name, else the partners' first names. */
export const dmTitleOf = (type: string, partners: ReadonlyArray<Person>, fallback: string): string => {
	const only = partners[0]
	if (type === "single" && partners.length === 1 && only !== undefined)
		return `${only.firstName} ${only.lastName}`.trim()
	return partners.length === 0 ? fallback : partners.map((person) => person.firstName).join(", ")
}

export const initialsOf = (name: string) =>
	name
		.split(/\s+/)
		.map((part) => part[0] ?? "")
		.join("")
		.slice(0, 2)
		.toUpperCase()

/** `getEffectivePresenceStatus`, onto the avatar's closed set (`dnd` draws as `busy`). */
export const presenceOf = (status: string | null | undefined): "online" | "away" | "busy" | "offline" =>
	status === "online" || status === "away" || status === "busy"
		? status
		: status === "dnd"
			? "busy"
			: "offline"

/** `MAX_DISCOVERABLE`, and the membership count under which Discover shows. */
export const MAX_DISCOVERABLE = 5
export const DISCOVER_BELOW = 3
