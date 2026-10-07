import {
	ChannelId,
	ChannelSectionId,
	ConnectConversationId,
	OrganizationId,
	OrganizationMemberId,
	UserId,
} from "@hazel/schema"
import { OrganizationMember } from "@hazel/domain/models"
import { Schema } from "effect"
import { getSharedChannelIds } from "~/lib/connect-shared-channels"

/** Schema-typed rows the chat sidebar keeps in its model, projected from the live queries. */

export const SidebarChannel = Schema.Struct({
	id: ChannelId,
	name: Schema.String,
	type: Schema.String,
	icon: Schema.NullOr(Schema.String),
	sectionId: Schema.NullOr(ChannelSectionId),
})
export type SidebarChannel = typeof SidebarChannel.Type

export const SidebarMember = Schema.Struct({
	isMuted: Schema.Boolean,
	isFavorite: Schema.Boolean,
	notificationCount: Schema.Number,
})
export type SidebarMember = typeof SidebarMember.Type

export const ChannelEntry = Schema.Struct({ channel: SidebarChannel, member: SidebarMember })
export type ChannelEntry = typeof ChannelEntry.Type

export const Section = Schema.Struct({ id: ChannelSectionId, name: Schema.String })
export type Section = typeof Section.Type

export const Membership = Schema.Struct({
	id: OrganizationMemberId,
	role: OrganizationMember.OrganizationRole,
})
export type Membership = typeof Membership.Type

export const DmMember = Schema.Struct({
	userId: UserId,
	firstName: Schema.String,
	lastName: Schema.String,
	avatarUrl: Schema.NullOr(Schema.String),
})
export type DmMember = typeof DmMember.Type

/** `useChannelWithCurrentUser`: the channel, every member with its user, and the signed-in member. */
export const DmChannel = Schema.Struct({
	id: ChannelId,
	type: Schema.String,
	members: Schema.Array(DmMember),
	currentUser: SidebarMember,
})
export type DmChannel = typeof DmChannel.Type

export const Presence = Schema.Struct({
	userId: UserId,
	status: Schema.NullOr(Schema.String),
	lastSeenMs: Schema.NullOr(Schema.Number),
	statusEmoji: Schema.NullOr(Schema.String),
})
export type Presence = typeof Presence.Type

export const ConnectMount = Schema.Struct({
	channelId: ChannelId,
	conversationId: ConnectConversationId,
	organizationId: OrganizationId,
	isActive: Schema.Boolean,
	isDeleted: Schema.Boolean,
})
export type ConnectMount = typeof ConnectMount.Type

export const PartnerOrg = Schema.Struct({
	id: OrganizationId,
	name: Schema.String,
	logoUrl: Schema.NullOr(Schema.String),
})
export type PartnerOrg = typeof PartnerOrg.Type

export const DiscoverableChannel = Schema.Struct({
	id: ChannelId,
	name: Schema.String,
	icon: Schema.NullOr(Schema.String),
})
export type DiscoverableChannel = typeof DiscoverableChannel.Type

export const UnreadCount = Schema.Struct({ channelId: ChannelId, count: Schema.Number })
export type UnreadCount = typeof UnreadCount.Type

/** `useSharedChannels`: partner orgs per channel that is mounted in an active Connect conversation. */
export const partnerOrgsByChannel = (
	mounts: ReadonlyArray<ConnectMount>,
	orgs: ReadonlyArray<PartnerOrg>,
	currentOrgId: OrganizationId | null,
): ReadonlyMap<string, ReadonlyArray<PartnerOrg>> => {
	const result = new Map<string, Array<PartnerOrg>>()
	if (currentOrgId === null) return result
	const sharedChannelIds = getSharedChannelIds(
		mounts.map((mount) => ({ ...mount, deletedAt: mount.isDeleted ? new Date(0) : null })),
	)
	const orgById = new Map(orgs.map((org) => [org.id, org]))
	const byConversation = new Map<string, Array<ConnectMount>>()
	for (const mount of mounts) {
		if (!sharedChannelIds.has(mount.channelId)) continue
		byConversation.set(mount.conversationId, [...(byConversation.get(mount.conversationId) ?? []), mount])
	}
	for (const mount of mounts) {
		if (!sharedChannelIds.has(mount.channelId) || mount.organizationId !== currentOrgId) continue
		const partners: Array<PartnerOrg> = []
		for (const other of byConversation.get(mount.conversationId) ?? []) {
			if (other.organizationId === currentOrgId) continue
			const org = orgById.get(other.organizationId)
			if (org && !partners.some((partner) => partner.id === org.id)) partners.push(org)
		}
		if (partners.length > 0) result.set(mount.channelId, partners)
	}
	return result
}
