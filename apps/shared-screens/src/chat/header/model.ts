/**
 * The channel header's data as Schemas (what its live queries send) and the pure rules over them:
 * the title, the DM partner, the bell's label. Split from the components so the queries, the views
 * and the tests share them.
 */
import { ChannelMember } from "@hazel/domain/models"
import { ChannelId, ChannelMemberId, UserId } from "@hazel/schema"
import { Schema } from "effect"
import { isDmType, isMutedNow, levelLabels } from "../../channel-sidebar/model"
import { initialsOf } from "../format"

export type NotificationLevel = ChannelMember.NotificationLevel

export const HeaderChannel = Schema.Struct({
	id: ChannelId,
	name: Schema.String,
	icon: Schema.NullOr(Schema.String),
	type: Schema.String,
	parentChannelId: Schema.NullOr(ChannelId),
})
export type HeaderChannel = typeof HeaderChannel.Type

/** A member of the channel with what the header shows of them. */
export const HeaderMember = Schema.Struct({
	id: ChannelMemberId,
	userId: UserId,
	isHidden: Schema.Boolean,
	isMuted: Schema.Boolean,
	mutedUntilMs: Schema.NullOr(Schema.Finite),
	notificationLevel: Schema.NullOr(ChannelMember.NotificationLevel),
	/** `authorIdentity`: a bot's name, else first and last name. */
	displayName: Schema.String,
	avatarUrl: Schema.NullOr(Schema.String),
	isBot: Schema.Boolean,
})
export type HeaderMember = typeof HeaderMember.Type

/** The avatar's presence options; the app's `dnd` draws as `busy`. */
export const Presence = Schema.Literals(["online", "away", "busy", "offline"])
export type Presence = typeof Presence.Type

/** What the channel icon marks (`channelIcon`): a customer's logo, Connect partners, a sync. */
export const Logo = Schema.Struct({ name: Schema.String, src: Schema.NullOr(Schema.String) })
export type Logo = typeof Logo.Type

export const SyncProvider = Schema.Literals(["none", "slack", "discord"])
export type SyncProvider = typeof SyncProvider.Type

export const ChannelLinks = Schema.Struct({
	customer: Schema.NullOr(Logo),
	sync: SyncProvider,
})
export type ChannelLinks = typeof ChannelLinks.Type

export const NO_LINKS: ChannelLinks = { customer: null, sync: "none" }

/** The signed-in user's row, or none (the fallback header: not a member). */
export const currentMemberOf = (
	members: ReadonlyArray<HeaderMember>,
	userId: UserId,
): HeaderMember | undefined => members.find((member) => member.userId === userId)

/** DM participants other than the signed-in user, in the order they joined. */
export const othersOf = (members: ReadonlyArray<HeaderMember>, userId: UserId) =>
	members.filter((member) => member.userId !== userId)

/** `Ada Lovelace, Grace Hopper +2 more`: the first three, then how many more. */
export const dmTitleOf = (others: ReadonlyArray<HeaderMember>): string => {
	if (others.length === 0) return "Direct message"
	const names = others
		.slice(0, 3)
		.map((member) => member.displayName)
		.join(", ")
	return others.length > 3 ? `${names} +${others.length - 3} more` : names
}

/** The partner of a one-on-one DM with a person, whose presence the header shows. */
export const partnerOf = (
	channel: HeaderChannel,
	others: ReadonlyArray<HeaderMember>,
): HeaderMember | undefined =>
	channel.type === "single" && others.length === 1 && others[0]?.isBot === false ? others[0] : undefined

/**
 * What "Default" is here (`notification-rules.ts`): the section's level, else the organization's,
 * else the type's. DMs and threads always take the type's default.
 */
export const inheritedLevelOf = (
	type: string,
	overrides: {
		readonly sectionLevel: NotificationLevel | null
		readonly organizationLevel: NotificationLevel | null
	},
): NotificationLevel =>
	isDmType(type) || type === "thread"
		? "all"
		: (overrides.sectionLevel ?? overrides.organizationLevel ?? "mentions")

/** "Muted until 14:30" (or "until Tue 14:30"), "Muted" for good, null when not muted. */
export const muteStatusOf = (
	member: { readonly isMuted: boolean; readonly mutedUntilMs: number | null },
	nowMs: number,
): string | null => {
	if (member.isMuted) return "Muted"
	if (member.mutedUntilMs === null || member.mutedUntilMs <= nowMs) return null
	const until = new Date(member.mutedUntilMs)
	const time = until.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
	return until.toDateString() === new Date(nowMs).toDateString()
		? `Muted until ${time}`
		: `Muted until ${until.toLocaleDateString(undefined, { weekday: "short" })} ${time}`
}

/**
 * The bell's name: "Notification settings", then the level when the member chose one (a DM has
 * none), then the mute while it is in force: "Notification settings: Nothing, Muted until 14:30".
 */
export const bellLabelOf = (member: HeaderMember, channelType: string, nowMs: number): string => {
	const level =
		member.notificationLevel === null || isDmType(channelType)
			? "Notification settings"
			: `Notification settings: ${levelLabels[member.notificationLevel]}`
	const mute = muteStatusOf(member, nowMs)
	return mute === null ? level : `${level}, ${mute}`
}

export const isMemberMutedNow = (member: HeaderMember, nowMs: number) => isMutedNow(member, nowMs)

export const logoOf = (logo: Logo) => ({
	name: logo.name,
	initials: initialsOf(logo.name),
	src: logo.src ?? undefined,
})
