import { useAtomSet } from "@effect/atom-react"
import type { ChannelId } from "@hazel/schema"
import type { UserId } from "@hazel/schema"
import { eq, useLiveQuery } from "@tanstack/react-db"
import IconHashtag from "~/components/icons/icon-hashtag"
import { Button } from "~/components/ui/button"
import { joinChannelAction } from "~/db/actions"
import { channelCollection, channelMemberCollection } from "~/db/collections"
import { useAuth } from "~/lib/auth"
import { exitToast } from "~/lib/toast-exit"

interface ChannelJoinBannerProps {
	channelId: ChannelId
}

export function ChannelJoinBanner({ channelId }: ChannelJoinBannerProps) {
	const { user } = useAuth()
	const joinChannel = useAtomSet(joinChannelAction, { mode: "promiseExit" })

	// Query the channel directly (no membership join)
	const { data: channel } = useLiveQuery({
		query: (q) =>
			q
				.from({ channel: channelCollection })
				.where(({ channel }) => eq(channel.id, channelId))
				.findOne()
				.select(({ channel }) => ({ ...channel })),
		queryKey: [channelId],
	})

	const handleJoin = async () => {
		if (!user?.id) return

		const exit = await joinChannel({
			channelId,
			userId: user.id as UserId,
		})

		exitToast(exit)
			.successMessage("Joined channel")
			.onErrorTag("ChannelNotFoundError", () => ({
				title: "Channel not found",
				description: "This channel may have been deleted.",
				isRetryable: false,
			}))
			.run()
	}

	if (!channel) return null

	return (
		<div className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
			<div className="flex flex-col items-center gap-3">
				<div className="flex size-16 items-center justify-center rounded-2xl bg-secondary text-3xl text-muted-fg">
					{channel.icon ? <span>{channel.icon}</span> : <IconHashtag className="size-8" />}
				</div>
				<div className="flex flex-col items-center gap-1">
					<h2 className="font-semibold text-fg text-xl">{channel.name}</h2>
					<p className="max-w-sm text-center text-muted-fg text-sm">
						You're previewing this channel. Join to start chatting.
					</p>
				</div>
			</div>
			<Button intent="primary" size="lg" onPress={handleJoin}>
				Join #{channel.name}
			</Button>
		</div>
	)
}

/** Hook that checks if the current user is a member of a channel */
export function useIsChannelMember(channelId: ChannelId) {
	const { user } = useAuth()

	const { data: membership } = useLiveQuery({
		query: (q) =>
			q
				.from({ m: channelMemberCollection })
				.where(({ m }) => eq(m.channelId, channelId))
				.where(({ m }) => eq(m.userId, user?.id || ""))
				.findOne(),
		queryKey: [channelId, user?.id],
	})

	return !!membership
}
