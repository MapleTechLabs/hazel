import { useAtomSet } from "@effect/atom-react"
import type { ChannelId } from "@hazel/schema"
import type { UserId } from "@hazel/schema"
import { eq, inArray, not, or, useLiveQuery } from "@tanstack/react-db"
import { useState } from "react"
import { toast } from "sonner"
import IconHashtag from "~/components/icons/icon-hashtag"
import { Button } from "~/components/ui/button"
import { Description } from "~/components/ui/field"
import { Input } from "~/components/ui/input"
import { Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, ModalTitle } from "~/components/ui/modal"
import { joinChannelAction } from "~/db/actions"
import { channelCollection, channelMemberCollection } from "~/db/collections"
import { useOrganization } from "~/hooks/use-organization"
import { useAuth } from "~/lib/auth"
import { exitToast } from "~/lib/toast-exit"

interface JoinChannelModalProps {
	isOpen: boolean
	onOpenChange: (open: boolean) => void
}

export function JoinChannelModal({ isOpen, onOpenChange }: JoinChannelModalProps) {
	const [searchQuery, setSearchQuery] = useState("")
	const { organizationId } = useOrganization()
	const { user } = useAuth()

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
				// If user has no channels, return all public channels
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
			.onSuccess(() => {
				onOpenChange(false)
				setSearchQuery("")
			})
			.successMessage("Successfully joined channel")
			.onErrorTag("ChannelNotFoundError", () => ({
				title: "Channel not found",
				description: "This channel may have been deleted.",
				isRetryable: false,
			}))
			.run()
	}

	const filteredChannels =
		unjoinedChannels?.filter((channel) =>
			channel.name.toLowerCase().includes(searchQuery.toLowerCase()),
		) ?? []

	return (
		<Modal isOpen={isOpen} onOpenChange={onOpenChange}>
			<ModalContent size="lg">
				<ModalHeader>
					<ModalTitle>Browse Channels</ModalTitle>
					<Description>Join a public channel in your organization</Description>
				</ModalHeader>

				<ModalBody className="flex flex-col gap-4">
					<Input
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
						placeholder="Search channels..."
						autoFocus
					/>

					<div className="max-h-[400px] overflow-y-auto">
						{filteredChannels.length === 0 ? (
							<div className="flex flex-col items-center justify-center py-8 text-center">
								<IconHashtag className="mb-3 size-12 text-muted-fg" />
								<p className="text-muted-fg text-sm">
									{searchQuery
										? "No channels found matching your search"
										: unjoinedChannels?.length === 0
											? "You've already joined all available channels"
											: "No channels available to join"}
								</p>
							</div>
						) : (
							<div className="space-y-2">
								{filteredChannels.map((channel) => (
									<div
										key={channel.id}
										className="flex items-center justify-between rounded-lg border border-border p-3 transition-colors hover:bg-secondary"
									>
										<div className="flex items-center gap-3">
											<IconHashtag className="size-5 text-muted-fg" />
											<div className="font-medium">{channel.name}</div>
										</div>
										<Button
											size="sm"
											intent="primary"
											onPress={() => handleJoinChannel(channel.id)}
										>
											Join
										</Button>
									</div>
								))}
							</div>
						)}
					</div>
				</ModalBody>

				<ModalFooter>
					<Button
						intent="outline"
						onPress={() => {
							onOpenChange(false)
							setSearchQuery("")
						}}
					>
						Close
					</Button>
				</ModalFooter>
			</ModalContent>
		</Modal>
	)
}
