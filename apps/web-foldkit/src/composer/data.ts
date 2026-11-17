import { and, eq, inArray, isNull } from "@tanstack/db"
import { Stream } from "effect"
import {
	botCollection,
	botCommandCollection,
	botInstallationCollection,
	channelMemberCollection,
	chatSyncChannelLinkCollection,
	chatSyncConnectionCollection,
	userCollection,
} from "~/db/collections"
import type { BotCommandId, BotId, ChannelId, ChannelMemberId, OrganizationId, UserId } from "@hazel/schema"
import { liveQueryStream } from "../data/live-query"
import type { BotCommand, MentionableBot, MentionMember, MentionProvider } from "./composer"

interface MentionUserRow {
	readonly id: UserId
	readonly email: string
	readonly firstName: string
	readonly lastName: string
	readonly avatarUrl?: string | null
}

const toMentionMember = (user: MentionUserRow, provider: MentionProvider | null): MentionMember => ({
	userId: user.id,
	firstName: user.firstName,
	lastName: user.lastName,
	avatarUrl: user.avatarUrl ?? null,
	provider,
})

const channelMembersRows = (channelId: ChannelId) =>
	liveQueryStream<{ user?: MentionUserRow }, ReadonlyArray<MentionUserRow>>(
		(q) =>
			q
				.from({ channelMember: channelMemberCollection })
				.innerJoin({ user: userCollection }, ({ channelMember, user }) =>
					eq(channelMember.userId, user.id),
				)
				.where(({ channelMember }) => eq(channelMember.channelId, channelId))
				.limit(100)
				.orderBy(({ channelMember }) => channelMember.joinedAt, "desc")
				.select(({ channelMember, user }) => ({ ...channelMember, user })),
		(rows) => rows.flatMap((row) => (row.user ? [row.user] : [])),
	)

/** The platforms `channelId` is two-way synced with over an active link. */
const syncedProviders = (channelId: ChannelId) =>
	liveQueryStream<{ provider: string }, ReadonlyArray<MentionProvider>>(
		(q) =>
			q
				.from({ link: chatSyncChannelLinkCollection })
				.innerJoin({ connection: chatSyncConnectionCollection }, ({ link, connection }) =>
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
		(rows) => [
			...new Set(
				rows.flatMap((row): Array<MentionProvider> =>
					row.provider === "slack" || row.provider === "discord" ? [row.provider] : [],
				),
			),
		],
	)

/**
 * The org's Slack and Discord people: the shadow users chat sync made for provider users who
 * wrote in a linked channel (`<provider>-user-<id>@<provider>.internal`). They are org members but join no channel.
 */
const externalUsers = () =>
	liveQueryStream<MentionUserRow, ReadonlyArray<MentionUserRow>>(
		(q) =>
			q
				.from({ user: userCollection })
				.where(({ user }) => and(eq(user.userType, "machine"), isNull(user.deletedAt))),
		(rows) => rows,
	)

/**
 * The platform a shadow user belongs to, from its `<provider>-user-<id>@<provider>.internal` email.
 * Not the external id: it is `Sensitive`, so the synced user rows never carry it.
 */
const shadowProviderOf = (email: string | undefined): MentionProvider | null =>
	email?.startsWith("discord-user-") ? "discord" : email?.startsWith("slack-user-") ? "slack" : null

/**
 * Mention autocomplete: the channel's members (the query `useMentionOptions` runs), and in a
 * channel synced to Slack or Discord, that platform's people too, so a message can ping them there.
 */
export const mentionMembersStream = <Message>(
	channelId: ChannelId,
	toMessage: (members: ReadonlyArray<MentionMember>) => Message,
) =>
	Stream.zipLatestAll(channelMembersRows(channelId), syncedProviders(channelId), externalUsers()).pipe(
		Stream.map(([members, providers, external]) => {
			const memberIds = new Set(members.map((user) => user.id))
			const synced = external.flatMap((user) => {
				const provider = shadowProviderOf(user.email)
				return provider !== null && providers.includes(provider) && !memberIds.has(user.id)
					? [toMentionMember(user, provider)]
					: []
			})
			return toMessage([...members.map((user) => toMentionMember(user, null)), ...synced])
		}),
	)

/** `useMentionOptions`' mentionable bots installed in the organization. */
export const mentionableBotsStream = <Message>(
	organizationId: OrganizationId,
	toMessage: (bots: ReadonlyArray<MentionableBot>) => Message,
) =>
	liveQueryStream<
		{ userId: UserId; name: string; description?: string | null; user?: { avatarUrl?: string | null } },
		Message
	>(
		(q) =>
			q
				.from({ installation: botInstallationCollection })
				.innerJoin({ bot: botCollection }, ({ installation, bot }) => eq(installation.botId, bot.id))
				.innerJoin({ user: userCollection }, ({ bot, user }) => eq(bot.userId, user.id))
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

interface BotCommandRow {
	readonly id: BotCommandId
	readonly name: string
	readonly description: string
	readonly arguments: ReadonlyArray<{
		readonly name: string
		readonly description?: string | null
		readonly required: boolean
		readonly placeholder?: string | null
		readonly type: string
	}> | null
	readonly botId: BotId
	readonly botName: string
	readonly avatarUrl?: string | null
}

/** `useBotCommands`: enabled commands of the organization's installed bots. */
export const botCommandsStream = <Message>(
	organizationId: OrganizationId,
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
	channelId: ChannelId,
	userId: UserId,
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
