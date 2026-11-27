/**
 * The composer's live data over `@hazel/client-data` (today's `web-foldkit/src/composer/data.ts` and
 * the channel page's presence, custom emoji, user group and typing queries): each a stream of one
 * message per change, which `ChannelComposer` runs in a Subscription keyed on its inputs.
 */
import type { ChannelId, ChannelMemberId, MessageId, OrganizationId, UserId } from "@hazel/schema"
import { and, eq, inArray, isNull } from "@tanstack/db"
import { Stream } from "effect"
import { liveQuery, withData } from "../../app/live"
import type { BotCommand, CustomEmoji, MentionBot, MentionGroup, MentionMember, Presence } from "./model"

interface UserRow {
	readonly id: UserId
	readonly email?: string | null
	readonly firstName: string
	readonly lastName: string
	readonly avatarUrl?: string | null
	readonly userType?: string
}

const nameOf = (user: UserRow) => `${user.firstName} ${user.lastName}`.trim()

/** A chat sync shadow user's platform, from their address (today's `shadowProviderOf`). */
const providerOf = (user: UserRow): "slack" | "discord" | null =>
	user.email?.startsWith("discord-user-") === true
		? "discord"
		: user.email?.startsWith("slack-user-") === true
			? "slack"
			: null

const toMember = (user: UserRow, provider: "slack" | "discord" | null): MentionMember => ({
	userId: user.id,
	name: nameOf(user),
	avatarUrl: user.avatarUrl ?? null,
	provider,
})

/**
 * The channel's members, and in a channel synced to Slack or Discord that platform's people too
 * (the shadow users chat sync made, who join no channel), so a message can ping them there.
 */
export const membersStream = <M>(channelId: ChannelId, toMessage: (members: ReadonlyArray<MentionMember>) => M) =>
	withData((data) => {
		const c = data.collections
		const members = data.liveQueryStream<{ user?: UserRow }, ReadonlyArray<UserRow>>(
			(q) =>
				q
					.from({ member: c.channelMemberCollection })
					.innerJoin({ user: c.userCollection }, ({ member, user }) => eq(member.userId, user.id))
					.where(({ member }) => eq(member.channelId, channelId))
					.orderBy(({ member }) => member.joinedAt, "desc")
					.limit(100)
					.select(({ member, user }) => ({ ...member, user })),
			(rows) => rows.flatMap((row) => (row.user === undefined ? [] : [row.user])),
		)
		const providers = data.liveQueryStream<{ provider: string }, ReadonlyArray<string>>(
			(q) =>
				q
					.from({ link: c.chatSyncChannelLinkCollection })
					.innerJoin({ connection: c.chatSyncConnectionCollection }, ({ link, connection }) =>
						eq(link.syncConnectionId, connection.id),
					)
					.where(({ link, connection }) =>
						and(
							eq(link.hazelChannelId, channelId),
							eq(link.isActive, true),
							isNull(link.deletedAt),
							isNull(connection.deletedAt),
							inArray(connection.provider, ["slack", "discord"]),
						),
					)
					.select(({ connection }) => ({ provider: connection.provider })),
			(rows) => rows.map((row) => row.provider),
		)
		const external = data.liveQueryStream<UserRow, ReadonlyArray<UserRow>>(
			(q) =>
				q
					.from({ user: c.userCollection })
					.where(({ user }) => and(eq(user.userType, "machine"), isNull(user.deletedAt))),
			(rows) => rows,
		)
		return Stream.zipLatestAll(members, providers, external).pipe(
			Stream.map(([users, synced, shadows]) => {
				const ids = new Set(users.map((user) => user.id))
				const people = shadows.flatMap((user) => {
					const provider = providerOf(user)
					return provider !== null && synced.includes(provider) && !ids.has(user.id)
						? [toMember(user, provider)]
						: []
				})
				return toMessage([...users.map((user) => toMember(user, null)), ...people])
			}),
		)
	})

/** The mentionable bots installed in the organization. */
export const botsStream = <M>(organizationId: OrganizationId, toMessage: (bots: ReadonlyArray<MentionBot>) => M) =>
	liveQuery<
		{ userId: UserId; name: string; description?: string | null; user?: { avatarUrl?: string | null } },
		M
	>(
		(data) => (q) =>
			q
				.from({ installation: data.collections.botInstallationCollection })
				.innerJoin({ bot: data.collections.botCollection }, ({ installation, bot }) =>
					eq(installation.botId, bot.id),
				)
				.innerJoin({ user: data.collections.userCollection }, ({ bot, user }) => eq(bot.userId, user.id))
				.where(({ installation, bot }) =>
					and(
						eq(installation.organizationId, organizationId),
						eq(bot.mentionable, true),
						isNull(bot.deletedAt),
					),
				)
				.select(({ bot, user }) => ({ ...bot, user })),
		(rows) =>
			toMessage(
				rows.map((row) => ({
					userId: row.userId,
					name: row.name,
					description: row.description ?? null,
					avatarUrl: row.user?.avatarUrl ?? null,
				})),
			),
	)

interface CommandRow {
	readonly id: BotCommand["id"]
	readonly name: string
	readonly description: string
	readonly arguments: ReadonlyArray<{
		readonly name: string
		readonly description?: string | null
		readonly required: boolean
		readonly placeholder?: string | null
	}> | null
	readonly botId: BotCommand["botId"]
	readonly botName: string
	readonly avatarUrl?: string | null
}

/** `useBotCommands`: the enabled commands of the organization's installed bots. */
export const commandsStream = <M>(
	organizationId: OrganizationId,
	toMessage: (commands: ReadonlyArray<BotCommand>) => M,
) =>
	liveQuery<CommandRow, M>(
		(data) => (q) =>
			q
				.from({ command: data.collections.botCommandCollection })
				.innerJoin({ bot: data.collections.botCollection }, ({ command, bot }) => eq(command.botId, bot.id))
				.innerJoin({ installation: data.collections.botInstallationCollection }, ({ bot, installation }) =>
					eq(bot.id, installation.botId),
				)
				.innerJoin({ user: data.collections.userCollection }, ({ bot, user }) => eq(bot.userId, user.id))
				.where(({ command, installation, bot }) =>
					and(
						eq(installation.organizationId, organizationId),
						eq(command.isEnabled, true),
						isNull(bot.deletedAt),
					),
				)
				.select(({ command, bot, user }) => ({
					id: command.id,
					name: command.name,
					description: command.description,
					arguments: command.arguments,
					botId: bot.id,
					botName: bot.name,
					avatarUrl: user.avatarUrl,
				})),
		(rows) =>
			toMessage(
				rows.map((row) => ({
					id: row.id,
					name: row.name,
					description: row.description,
					botId: row.botId,
					botName: row.botName,
					botAvatarUrl: row.avatarUrl ?? null,
					arguments: (row.arguments ?? []).map((arg) => ({
						name: arg.name,
						description: arg.description ?? null,
						required: arg.required,
						placeholder: arg.placeholder ?? null,
					})),
				})),
			),
	)

/** The organization's user groups (`@handle`) with how many current members each has. */
export const groupsStream = <M>(organizationId: OrganizationId, toMessage: (groups: ReadonlyArray<MentionGroup>) => M) =>
	withData((data) => {
		const c = data.collections
		const groups = data.liveQueryStream<
			{ id: string; handle: string; name: string },
			ReadonlyArray<{ id: string; handle: string; name: string }>
		>(
			(q) =>
				q
					.from({ group: c.userGroupCollection })
					.where(({ group }) => and(eq(group.organizationId, organizationId), isNull(group.deletedAt))),
			(rows) => rows,
		)
		const members = data.liveQueryStream<
			{ groupId: string; userId: UserId },
			ReadonlyArray<{ groupId: string; userId: UserId }>
		>(
			(q) => q.from({ member: c.userGroupMemberCollection }),
			(rows) => rows,
		)
		const current = data.liveQueryStream<{ userId: UserId }, ReadonlySet<UserId>>(
			(q) =>
				q
					.from({ member: c.organizationMemberCollection })
					.where(({ member }) => and(eq(member.organizationId, organizationId), isNull(member.deletedAt)))
					.select(({ member }) => ({ userId: member.userId })),
			(rows) => new Set(rows.map((row) => row.userId)),
		)
		return Stream.zipLatestAll(groups, members, current).pipe(
			Stream.map(([rows, links, present]) =>
				toMessage(
					[...rows]
						.sort((a, b) => a.handle.localeCompare(b.handle))
						.map((group) => ({
							id: group.id,
							handle: group.handle,
							name: group.name,
							memberCount: links.filter(
								(link) => link.groupId === group.id && present.has(link.userId),
							).length,
						})),
				),
			),
		)
	})

/** Everyone's presence, for the mention rows' dots (`dnd` draws as busy). */
export const presenceStream = <M>(toMessage: (presence: ReadonlyArray<Presence>) => M) =>
	liveQuery<{ userId: UserId; status: string }, M>(
		(data) => (q) => q.from({ presence: data.collections.userPresenceStatusCollection }),
		(rows) =>
			toMessage(
				rows.map((row) => ({
					userId: row.userId,
					status:
						row.status === "online" || row.status === "away" || row.status === "offline"
							? row.status
							: row.status === "busy" || row.status === "dnd"
								? "busy"
								: "offline",
				})),
			),
	)

export const customEmojisStream = <M>(
	organizationId: OrganizationId,
	toMessage: (emojis: ReadonlyArray<CustomEmoji>) => M,
) =>
	liveQuery<{ name: string; imageUrl: string }, M>(
		(data) => (q) =>
			q
				.from({ emoji: data.collections.customEmojiCollection })
				.where(({ emoji }) => and(eq(emoji.organizationId, organizationId), isNull(emoji.deletedAt))),
		(rows) => toMessage(rows.map((row) => ({ name: row.name, imageUrl: row.imageUrl }))),
	)

/** The signed-in user's membership of the channel: the typing heartbeat is sent as it. */
export const membershipStream = <M>(
	channelId: ChannelId,
	userId: UserId,
	toMessage: (memberId: ChannelMemberId | null) => M,
) =>
	liveQuery<{ id: ChannelMemberId }, M>(
		(data) => (q) =>
			q
				.from({ member: data.collections.channelMemberCollection })
				.where(({ member }) =>
					and(eq(member.channelId, channelId), eq(member.userId, userId), isNull(member.deletedAt)),
				)
				.orderBy(({ member }) => member.createdAt, "desc")
				.findOne(),
		(rows) => toMessage(rows[0]?.id ?? null),
	)

/** The user's newest message in the channel, which Up in an empty composer edits. */
export const lastOwnStream = <M>(
	channelId: ChannelId,
	userId: UserId,
	toMessage: (last: { readonly id: MessageId; readonly content: string } | null) => M,
) =>
	liveQuery<{ id: MessageId; content: string }, M>(
		(data) => (q) =>
			q
				.from({ message: data.collections.messageCollection })
				.where(({ message }) => and(eq(message.channelId, channelId), eq(message.authorId, userId)))
				.orderBy(({ message }) => message.createdAt, "desc")
				.limit(1)
				.select(({ message }) => ({ id: message.id, content: message.content })),
		(rows) => {
			const row = rows[0]
			return toMessage(row === undefined ? null : { id: row.id, content: row.content })
		},
	)

/** Who else is typing in the channel: their first names and when they last typed. */
export const typingStream = <M>(
	channelId: ChannelId,
	userId: UserId,
	toMessage: (
		typing: ReadonlyArray<{ readonly name: string; readonly isSelf: boolean; readonly lastTypedMs: number }>,
	) => M,
) =>
	liveQuery<{ lastTyped: number; member?: { userId: UserId }; user?: { firstName: string } }, M>(
		(data) => (q) =>
			q
				.from({ typing: data.collections.typingIndicatorCollection })
				.innerJoin({ member: data.collections.channelMemberCollection }, ({ typing, member }) =>
					eq(typing.memberId, member.id),
				)
				.innerJoin({ user: data.collections.userCollection }, ({ member, user }) => eq(member.userId, user.id))
				.where(({ typing }) => eq(typing.channelId, channelId))
				.orderBy(({ typing }) => typing.lastTyped, "desc")
				.limit(10)
				.select(({ typing, member, user }) => ({ lastTyped: typing.lastTyped, member, user })),
		(rows) =>
			toMessage(
				rows.flatMap((row) =>
					row.member === undefined || row.user === undefined
						? []
						: [
								{
									name: row.user.firstName,
									isSelf: row.member.userId === userId,
									lastTypedMs: Number(row.lastTyped),
								},
							],
				),
			),
	)
