import type { OrganizationId } from "@hazel/schema"
import { and, eq, isNull, useLiveQuery } from "@tanstack/react-db"
import { useMemo } from "react"
import {
	botCollection,
	botCommandCollection,
	botInstallationCollection,
	userCollection,
} from "~/db/collections"
import type { BotCommandData } from "../types"

export function useBotCommands(orgId: OrganizationId, _channelId: string): BotCommandData[] {
	const { data } = useLiveQuery({
		query: (q) =>
			q
				.from({ command: botCommandCollection })
				.innerJoin({ bot: botCollection }, ({ command, bot }) => eq(command.botId, bot.id))
				.innerJoin({ installation: botInstallationCollection }, ({ bot, installation }) =>
					eq(bot.id, installation.botId),
				)
				.innerJoin({ user: userCollection }, ({ bot, user }) => eq(bot.userId, user.id))
				.where(({ command, installation, bot }) =>
					and(
						eq(installation.organizationId, orgId),
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
		queryKey: [orgId],
	})

	return useMemo(() => {
		return (data ?? []).map(
			(cmd): BotCommandData => ({
				id: cmd.id,
				name: cmd.name,
				description: cmd.description,
				provider: "bot",
				bot: {
					id: cmd.botId,
					name: cmd.botName,
					avatarUrl: cmd.avatarUrl ?? undefined,
				},
				arguments: (cmd.arguments ?? []).map((arg) => ({
					name: arg.name,
					description: arg.description ?? undefined,
					required: arg.required,
					placeholder: arg.placeholder ?? undefined,
					type: arg.type,
				})),
				usageExample: cmd.usageExample ?? undefined,
			}),
		)
	}, [data])
}
