"use client"

import { useAtomSet } from "@effect/atom-react"
import type { ChannelId, UserId } from "@hazel/schema"
import { eq, inArray, not, or, useLiveQuery } from "@tanstack/react-db"
import { useMemo } from "react"
import { toast } from "sonner"
import { ChannelIcon } from "~/components/channel-icon"
import IconHashtag from "~/components/icons/icon-hashtag"
import {
	CommandMenuFormBody,
	CommandMenuFormContainer,
	CommandMenuFormHeader,
	CommandMenuInput,
} from "~/components/ui/command-menu-form"
import { joinChannelAction } from "~/db/actions"
import { channelCollection, channelMemberCollection } from "~/db/collections"
import { useOrganization } from "~/hooks/use-organization"
import { useAuth } from "~/lib/auth"
import { exitToast } from "~/lib/toast-exit"
import { useCommandPaletteContext } from "../command-palette-context"

interface JoinChannelViewProps {
	onClose: () => void
	onBack: () => void
}

export function JoinChannelView({ onClose, onBack }: JoinChannelViewProps) {
	const { organizationId } = useOrganization()
	const { user } = useAuth()
	const { currentPage, updateJoinChannelState } = useCommandPaletteContext()

	const joinChannel = useAtomSet(joinChannelAction, { mode: "promiseExit" })

	// Get all channels the user is already a member of
	const { data: userChannels } = useLiveQuery({
		query: (q) =>
			q
				.from({ m: channelMemberCollection })
				.where(({ m }) => eq(m.userId, user?.id || ""))
				.select(({ m }) => ({ channelId: m.channelId })),
		queryKey: [user?.id],
	})

	// Get all channels the user hasn't joined yet
	const { data: unjoinedChannels } = useLiveQuery({
		query: (q) => {
			const userChannelIds = userChannels?.map((m) => m.channelId) || []

			if (userChannelIds.length === 0) {
				return q
					.from({ channel: channelCollection })
					.where(({ channel }) => or(eq(channel.type, "public"), eq(channel.type, "private")))
					.where(({ channel }) => eq(channel.organizationId, organizationId || ""))
					.select(({ channel }) => ({ ...channel }))
			}

			return q
				.from({ channel: channelCollection })
				.where(({ channel }) => not(inArray(channel.id, userChannelIds)))
				.where(({ channel }) => or(eq(channel.type, "public"), eq(channel.type, "private")))
				.where(({ channel }) => eq(channel.organizationId, organizationId || ""))
				.select(({ channel }) => ({ ...channel }))
		},
		queryKey: [user?.id, userChannels, organizationId],
	})

	const searchQuery = currentPage.type === "join-channel" ? currentPage.searchQuery : ""

	const filteredChannels = useMemo(() => {
		if (!unjoinedChannels) return []
		if (!searchQuery.trim()) return unjoinedChannels
		return unjoinedChannels.filter((channel) =>
			channel.name.toLowerCase().includes(searchQuery.toLowerCase()),
		)
	}, [unjoinedChannels, searchQuery])

	// Type guard to ensure we're on the join-channel page
	if (currentPage.type !== "join-channel") {
		return null
	}

	const handleJoinChannel = async (channelId: ChannelId) => {
		if (!user?.id) {
			toast.error("User not authenticated")
			return
		}

		const exit = await joinChannel({
			channelId,
			userId: user.id as UserId,
		})

		exitToast(exit)
			.onSuccess(() => onClose())
			.successMessage("Successfully joined channel")
			.onErrorTag("ChannelNotFoundError", () => ({
				title: "Channel not found",
				description: "This channel may have been deleted.",
				isRetryable: false,
			}))
			.run()
	}

	return (
		<CommandMenuFormContainer>
			<CommandMenuFormHeader
				title="Join Channel"
				subtitle="Browse and join available channels"
				onBack={onBack}
			/>
			<CommandMenuFormBody className="p-0">
				<div className="border-b px-3 py-2 sm:px-2.5">
					<CommandMenuInput
						placeholder="Search channels..."
						value={searchQuery}
						onChange={(e) => updateJoinChannelState(() => ({ searchQuery: e.target.value }))}
						autoFocus
					/>
				</div>
				<div className="max-h-64 overflow-y-auto p-2">
					{!unjoinedChannels?.length ? (
						<div className="flex flex-col items-center justify-center py-8 text-center">
							<IconHashtag className="mb-3 size-8 text-muted-fg" />
							<p className="text-muted-fg text-sm">You've joined all available channels</p>
						</div>
					) : filteredChannels.length === 0 ? (
						<div className="py-4 text-center text-muted-fg text-sm">
							No channels match your search
						</div>
					) : (
						<div className="space-y-1">
							{filteredChannels.map((channel) => (
								<button
									key={channel.id}
									type="button"
									onClick={() => handleJoinChannel(channel.id)}
									className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted"
								>
									<ChannelIcon icon={channel.icon} className="size-4 text-muted-fg" />
									<span className="flex-1 truncate">{channel.name}</span>
									<span className="rounded bg-primary/10 px-2 py-0.5 text-primary text-xs">
										Join
									</span>
								</button>
							))}
						</div>
					)}
				</div>
			</CommandMenuFormBody>
		</CommandMenuFormContainer>
	)
}
