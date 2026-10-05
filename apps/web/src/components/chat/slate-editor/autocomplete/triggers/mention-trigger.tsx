"use client"

import type { OrganizationId } from "@hazel/schema"
import { and, eq, isNull, useLiveQuery } from "@tanstack/react-db"
import { useParams } from "@tanstack/react-router"
import { useMemo } from "react"
import { Avatar } from "~/components/ui/avatar"
import {
	botCollection,
	botInstallationCollection,
	channelMemberCollection,
	userCollection,
	userPresenceStatusCollection,
} from "~/db/collections"
import { AutocompleteListBox } from "../autocomplete-listbox"
import type { AutocompleteOption, AutocompleteState, MentionData } from "../types"

interface MentionTriggerProps {
	/** Items to display */
	items: AutocompleteOption<MentionData>[]
	/** Currently active index */
	activeIndex: number
	/** Callback when an item is selected */
	onSelect: (index: number) => void
	/** Callback when mouse hovers over an item */
	onHover: (index: number) => void
}

/**
 * Mention trigger component
 * Renders mention suggestions using simple index-based focus
 */
export function MentionTrigger({ items, activeIndex, onSelect, onHover }: MentionTriggerProps) {
	return (
		<AutocompleteListBox
			items={items}
			activeIndex={activeIndex}
			onSelect={onSelect}
			onHover={onHover}
			emptyMessage="No users found"
			renderItem={({ option, isFocused }) => <MentionItem option={option} isHighlighted={isFocused} />}
		/>
	)
}

interface MentionItemProps {
	option: AutocompleteOption<MentionData>
	isHighlighted: boolean
}

function MentionItem({ option }: MentionItemProps) {
	const { data } = option

	return (
		<div className="flex items-center gap-2">
			{data.type === "user" ? (
				<Avatar
					size="xs"
					src={data.avatarUrl ?? undefined}
					seed={data.displayName}
					alt={data.displayName}
					status={data.status}
				/>
			) : data.type === "bot" ? (
				<Avatar
					size="xs"
					src={data.avatarUrl ?? undefined}
					seed={data.displayName}
					alt={data.displayName}
				/>
			) : (
				<div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-primary font-medium text-primary-fg text-xs">
					@
				</div>
			)}

			<div className="min-w-0 flex-1">
				<div className="truncate font-medium">
					{data.type === "user" || data.type === "bot" ? option.label : `@${data.displayName}`}
				</div>
				{option.description && (
					<div className="truncate text-muted-fg text-xs">{option.description}</div>
				)}
			</div>
		</div>
	)
}

/**
 * Get the filtered options for mentions
 */
export function useMentionOptions(state: AutocompleteState, orgId?: OrganizationId) {
	const { id: channelId } = useParams({ from: "/_app/$orgSlug/chat/$id" })

	const { data: members } = useLiveQuery((q) =>
		q
			.from({ channelMember: channelMemberCollection })
			.innerJoin({ user: userCollection }, ({ channelMember, user }) =>
				eq(channelMember.userId, user.id),
			)
			.where(({ channelMember }) => eq(channelMember.channelId, channelId))
			.limit(100)
			.orderBy(({ channelMember }) => channelMember.joinedAt, "desc")
			.select(({ channelMember, user }) => ({
				...channelMember,
				user,
			})),
	)

	const { data: presenceData } = useLiveQuery((q) =>
		q.from({ presence: userPresenceStatusCollection }).select(({ presence }) => presence),
	)

	// Query mentionable bots installed in the organization
	const { data: mentionableBots } = useLiveQuery({
		query: (q) =>
			orgId
				? q
						.from({ installation: botInstallationCollection })
						.innerJoin({ bot: botCollection }, ({ installation, bot }) =>
							eq(installation.botId, bot.id),
						)
						.innerJoin({ user: userCollection }, ({ bot, user }) => eq(bot.userId, user.id))
						.where(({ installation, bot }) =>
							and(
								eq(installation.organizationId, orgId),
								eq(bot.mentionable, true),
								isNull(bot.deletedAt),
							),
						)
						.select(({ bot, user }) => ({
							...bot,
							user,
						}))
				: null,
		queryKey: [orgId],
	})

	const presenceMap = useMemo(() => {
		const map = new Map<string, "online" | "offline" | "away" | "busy" | "dnd">()
		presenceData?.forEach((p) => {
			map.set(p.userId, p.status)
		})
		return map
	}, [presenceData])

	return useMemo<AutocompleteOption<MentionData>[]>(() => {
		const opts: AutocompleteOption<MentionData>[] = []
		const search = state.search.toLowerCase()

		if ("channel".includes(search)) {
			opts.push({
				id: "channel",
				label: "@channel",
				description: "Notify all members in this channel",
				data: { id: "channel", type: "channel", displayName: "channel" },
			})
		}

		if ("here".includes(search)) {
			opts.push({
				id: "here",
				label: "@here",
				description: "Notify all online members",
				data: { id: "here", type: "here", displayName: "here" },
			})
		}

		// Add mentionable bots
		if (mentionableBots) {
			for (const bot of mentionableBots) {
				if (!bot.name.toLowerCase().includes(search)) continue

				opts.push({
					id: bot.userId, // Use bot's userId for mention format @[userId:BOT_USER_ID]
					label: bot.name,
					description: bot.description ?? "Bot",
					data: {
						id: bot.userId,
						type: "bot",
						displayName: bot.name,
						avatarUrl: bot.user?.avatarUrl ?? undefined,
					},
				})
			}
		}

		if (members) {
			for (const member of members) {
				if (!member.user) continue

				const displayName = `${member.user.firstName} ${member.user.lastName}`
				if (!displayName.toLowerCase().includes(search)) continue

				const status = presenceMap.get(member.user.id) ?? "offline"

				opts.push({
					id: member.user.id,
					label: displayName,
					data: {
						id: member.user.id,
						type: "user",
						displayName,
						avatarUrl: member.user.avatarUrl ?? undefined,
						status,
					},
				})
			}
		}

		return opts
	}, [state.search, members, mentionableBots, presenceMap])
}
