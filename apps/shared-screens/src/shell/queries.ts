/**
 * The shell chrome's live queries over `ClientData` (`web-foldkit/src/shell/subscription.ts`): the
 * user's organizations for the switcher, their status for the account card, and the channel a
 * channel settings page is about.
 */
import type { ChannelId, OrganizationId, UserId } from "@hazel/schema"
import { eq } from "@tanstack/db"
import { Schema } from "effect"
import { liveQuery } from "../app/live"

export const SwitcherOrg = Schema.Struct({
	id: Schema.String,
	name: Schema.String,
	slug: Schema.NullOr(Schema.String),
	logoUrl: Schema.NullOr(Schema.String),
})
export type SwitcherOrg = typeof SwitcherOrg.Type

/** An organization with the user's role in it (the organization picker's badge). */
export const UserOrganization = Schema.Struct({
	...SwitcherOrg.fields,
	role: Schema.Literals(["owner", "admin", "member"]),
})
export type UserOrganization = typeof UserOrganization.Type

export const UserStatus = Schema.Struct({
	emoji: Schema.NullOr(Schema.String),
	message: Schema.NullOr(Schema.String),
	expiresAtMs: Schema.NullOr(Schema.Finite),
})
export type UserStatus = typeof UserStatus.Type

export const ChannelSummary = Schema.Struct({
	name: Schema.String,
	type: Schema.String,
	icon: Schema.NullOr(Schema.String),
})
export type ChannelSummary = typeof ChannelSummary.Type

interface OrgRow {
	readonly member: { readonly role: UserOrganization["role"] }
	readonly org: {
		readonly id: OrganizationId
		readonly name: string
		readonly slug?: string | null
		readonly logoUrl?: string | null
	}
}

/** `SwitchServerMenu`: every organization the user belongs to, oldest membership first, with their role. */
export const organizationsStream = <M>(userId: UserId, to: (orgs: Array<UserOrganization>) => M) =>
	liveQuery<OrgRow, M>(
		(data) => (q) =>
			q
				.from({ member: data.collections.organizationMemberCollection })
				.innerJoin({ org: data.collections.organizationCollection }, ({ member, org }) =>
					eq(member.organizationId, org.id),
				)
				.where(({ member }) => eq(member.userId, userId))
				.orderBy(({ member }) => member.createdAt, "asc"),
		(rows) =>
			to(
				rows.map(({ member, org }) => ({
					id: org.id,
					name: org.name,
					slug: org.slug ?? null,
					logoUrl: org.logoUrl ?? null,
					role: member.role,
				})),
			),
	)

interface PresenceRow {
	readonly statusEmoji?: string | null
	readonly customMessage?: string | null
	readonly statusExpiresAt?: Date | null
}

/** `useCurrentUserStatus`: the user's newest presence row. */
export const statusStream = <M>(userId: UserId, to: (status: UserStatus | null) => M) =>
	liveQuery<PresenceRow, M>(
		(data) => (q) =>
			q
				.from({ presence: data.collections.userPresenceStatusCollection })
				.where(({ presence }) => eq(presence.userId, userId))
				.orderBy(({ presence }) => presence.updatedAt, "desc")
				.findOne(),
		(rows) => {
			const row = rows[0]
			return to(
				row === undefined
					? null
					: {
							emoji: row.statusEmoji ?? null,
							message: row.customMessage ?? null,
							expiresAtMs: row.statusExpiresAt ? new Date(row.statusExpiresAt).getTime() : null,
						},
			)
		},
	)

interface ChannelRow {
	readonly name: string
	readonly type: string
	readonly icon?: string | null
}

/** The channel a settings page is about, or null while it loads or once it is gone. */
export const channelStream = <M>(channelId: ChannelId, to: (channel: ChannelSummary | null) => M) =>
	liveQuery<ChannelRow, M>(
		(data) => (q) =>
			q
				.from({ channel: data.collections.channelCollection })
				.where(({ channel }) => eq(channel.id, channelId))
				.findOne(),
		(rows) => {
			const row = rows[0]
			return to(row === undefined ? null : { name: row.name, type: row.type, icon: row.icon ?? null })
		},
	)
