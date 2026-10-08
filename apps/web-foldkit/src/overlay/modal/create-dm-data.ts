import { type ChannelId, type OrganizationId, UserId } from "@hazel/schema"
import { createLiveQueryCollection, eq, or } from "@tanstack/db"
import { Effect, Schema } from "effect"
import {
	channelCollection,
	channelMemberCollection,
	organizationMemberCollection,
	userCollection,
	userPresenceStatusCollection,
} from "~/db/collections"
import { liveQueryStream } from "../../data/live-query"

/** The create DM modal's data: org users with presence, and `findExistingDmChannel` (`lib/channels.ts`). */

export const OrgUser = Schema.Struct({
	id: UserId,
	firstName: Schema.String,
	lastName: Schema.String,
	avatarUrl: Schema.NullOr(Schema.String),
	presenceStatus: Schema.NullOr(Schema.String),
	customMessage: Schema.NullOr(Schema.String),
})
export type OrgUser = typeof OrgUser.Type

interface OrgUserRow {
	readonly id: UserId
	readonly firstName?: string | null
	readonly lastName?: string | null
	readonly avatarUrl?: string | null
	readonly presence?: { readonly status?: string | null; readonly customMessage?: string | null } | null
}

/** `organizationUsers`: the org's human users joined with their presence row. */
export const organizationUsersStream = <M>(organizationId: OrganizationId, toMessage: (users: Array<OrgUser>) => M) =>
	liveQueryStream<OrgUserRow, M>(
		(q) =>
			q
				.from({ member: organizationMemberCollection })
				.innerJoin({ user: userCollection }, ({ member, user }) => eq(member.userId, user.id))
				.leftJoin({ presence: userPresenceStatusCollection }, ({ user, presence }) => eq(user.id, presence.userId))
				.where(({ member }) => eq(member.organizationId, organizationId))
				.where(({ user }) => eq(user.userType, "user"))
				.select(({ user, presence }) => ({ ...user, presence })),
		(rows) =>
			toMessage(
				rows.map((row) => ({
					id: row.id,
					firstName: row.firstName ?? "",
					lastName: row.lastName ?? "",
					avatarUrl: row.avatarUrl ?? null,
					presenceStatus: row.presence?.status ?? null,
					customMessage: row.presence?.customMessage ?? null,
				})),
			),
	)

interface DmRow {
	readonly channel: { readonly id: ChannelId; readonly type: string; readonly organizationId: OrganizationId }
	readonly member: { readonly userId: UserId }
}

/** The DM channels query could not be read (a failed sync). */
export class DmLookupError extends Schema.TaggedError<DmLookupError>()("DmLookupError", {
	message: Schema.String,
}) {}

/** `dmChannelsCollection` read once, then the legacy exact-participants match. */
export const findExistingDmChannel = (
	currentUserId: UserId,
	targetUserIds: ReadonlyArray<UserId>,
	organizationId: OrganizationId,
): Effect.Effect<ChannelId | null, DmLookupError> =>
	Effect.acquireUseRelease(
		Effect.sync(() =>
			createLiveQueryCollection({
				startSync: true,
				query: (q) =>
					q
						.from({ channel: channelCollection })
						.innerJoin({ member: channelMemberCollection }, ({ channel, member }) => eq(member.channelId, channel.id))
						.where(({ channel }) => or(eq(channel.type, "single"), eq(channel.type, "direct"))),
			}),
		),
		(collection) =>
			Effect.tryPromise({
				try: () => collection.toArrayWhenReady(),
				catch: (error) => new DmLookupError({ message: String(error) }),
			}).pipe(
				Effect.map((rows: ReadonlyArray<DmRow>) => {
					const byChannel = new Map<string, { channel: DmRow["channel"]; memberIds: Array<string> }>()
					for (const row of rows) {
						if (row.channel.organizationId !== organizationId) continue
						const entry = byChannel.get(row.channel.id) ?? { channel: row.channel, memberIds: [] }
						entry.memberIds.push(row.member.userId)
						byChannel.set(row.channel.id, entry)
					}
					const participants = [currentUserId, ...targetUserIds].sort()
					const found = [...byChannel.values()].find(({ channel, memberIds }) =>
						channel.type === "single" && targetUserIds.length === 1
							? memberIds.length === 2 && memberIds.includes(currentUserId) && memberIds.includes(targetUserIds[0] ?? "")
							: channel.type === "direct" &&
								targetUserIds.length > 1 &&
								memberIds.length === participants.length &&
								[...memberIds].sort().every((id, index) => id === participants[index]),
					)
					return found?.channel.id ?? null
				}),
			),
		(collection) => Effect.tryPromise(() => collection.cleanup()).pipe(Effect.ignore),
	)
