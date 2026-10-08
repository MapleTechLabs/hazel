import { and, eq, isNull } from "@tanstack/db"
import {
	botCollection,
	botCommandCollection,
	botInstallationCollection,
	channelMemberCollection,
	userCollection,
	userPresenceStatusCollection,
} from "~/db/collections"
import type { ChannelMemberId } from "@hazel/schema"
import { liveQueryStream } from "../data/live-query"
import type { BotCommand, MentionableBot, MentionMember, PresenceStatus } from "./composer"

/** Channel members for mention autocomplete: the exact query `useMentionOptions` runs. */
export const mentionMembersStream = <Message>(
	channelId: string,
	toMessage: (members: ReadonlyArray<MentionMember>) => Message,
) =>
	liveQueryStream<{ user?: { id: string; firstName: string; lastName: string; avatarUrl?: string | null } }, Message>(
		(q) =>
			q
				.from({ channelMember: channelMemberCollection })
				.innerJoin({ user: userCollection }, ({ channelMember, user }) => eq(channelMember.userId, user.id))
				.where(({ channelMember }) => eq(channelMember.channelId, channelId))
				.limit(100)
				.orderBy(({ channelMember }) => channelMember.joinedAt, "desc")
				.select(({ channelMember, user }) => ({ ...channelMember, user })),
		(rows) =>
			toMessage(
				rows.flatMap((row) =>
					row.user
						? [
								{
									userId: row.user.id,
									firstName: row.user.firstName,
									lastName: row.user.lastName,
									avatarUrl: row.user.avatarUrl ?? null,
								},
							]
						: [],
				),
			),
	)

/** Every presence row, as `useMentionOptions` reads it. */
export const presenceStream = <Message>(
	toMessage: (presence: ReadonlyArray<{ userId: string; status: PresenceStatus }>) => Message,
) =>
	liveQueryStream<{ userId: string; status: PresenceStatus }, Message>(
		(q) => q.from({ presence: userPresenceStatusCollection }).select(({ presence }) => presence),
		(rows) => toMessage(rows.map((row) => ({ userId: row.userId, status: row.status }))),
	)

/** `useMentionOptions`' mentionable bots installed in the organization. */
export const mentionableBotsStream = <Message>(
	organizationId: string,
	toMessage: (bots: ReadonlyArray<MentionableBot>) => Message,
) =>
	liveQueryStream<
		{ userId: string; name: string; description?: string | null; user?: { avatarUrl?: string | null } },
		Message
	>(
		(q) =>
			q
				.from({ installation: botInstallationCollection })
				.innerJoin({ bot: botCollection }, ({ installation, bot }) => eq(installation.botId, bot.id))
				.innerJoin({ user: userCollection }, ({ bot, user }) => eq(bot.userId, user.id))
				.where(({ installation, bot }) =>
					and(eq(installation.organizationId, organizationId), eq(bot.mentionable, true), isNull(bot.deletedAt)),
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

interface BotCommandRow {
	readonly id: string
	readonly name: string
	readonly description: string
	readonly arguments: ReadonlyArray<{
		readonly name: string
		readonly description?: string | null
		readonly required: boolean
		readonly placeholder?: string | null
		readonly type: string
	}> | null
	readonly botId: string
	readonly botName: string
	readonly avatarUrl?: string | null
}

/** `useBotCommands`: enabled commands of the organization's installed bots. */
export const botCommandsStream = <Message>(
	organizationId: string,
	toMessage: (commands: ReadonlyArray<BotCommand>) => Message,
) =>
	liveQueryStream<BotCommandRow, Message>(
		(q) =>
			q
				.from({ command: botCommandCollection })
				.innerJoin({ bot: botCollection }, ({ command, bot }) => eq(command.botId, bot.id))
				.innerJoin({ installation: botInstallationCollection }, ({ bot, installation }) =>
					eq(bot.id, installation.botId),
				)
				.innerJoin({ user: userCollection }, ({ bot, user }) => eq(bot.userId, user.id))
				.where(({ command, installation, bot }) =>
					and(eq(installation.organizationId, organizationId), eq(command.isEnabled, true), isNull(bot.deletedAt)),
				)
				.select(({ command, bot, user }) => ({
					id: command.id,
					name: command.name,
					description: command.description,
					arguments: command.arguments,
					usageExample: command.usageExample,
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
					bot: { id: row.botId, name: row.botName, avatarUrl: row.avatarUrl ?? null },
					arguments: (row.arguments ?? []).map((arg) => ({
						name: arg.name,
						description: arg.description ?? null,
						required: arg.required,
						placeholder: arg.placeholder ?? null,
						type: arg.type,
					})),
				})),
			),
	)

/** `ComposerEditor`'s own membership query: the signed-in user's member row in a channel. */
export const ownMembershipStream = <Message>(
	channelId: string,
	userId: string,
	toMessage: (memberId: ChannelMemberId | null) => Message,
) =>
	liveQueryStream<{ id: ChannelMemberId }, Message>(
		(q) =>
			q
				.from({ member: channelMemberCollection })
				.where(({ member }) => and(eq(member.channelId, channelId), eq(member.userId, userId)))
				.orderBy(({ member }) => member.createdAt, "desc")
				.findOne(),
		(rows) => toMessage(rows[0]?.id ?? null),
	)
