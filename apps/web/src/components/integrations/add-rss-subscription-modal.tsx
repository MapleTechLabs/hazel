import { useAtomSet } from "@effect/atom-react"
import type { Channel } from "@hazel/domain/models"
import type { ChannelId, OrganizationId } from "@hazel/schema"
import { eq, or, useLiveQuery } from "@tanstack/react-db"
import { useState } from "react"
import { createRssSubscriptionMutation } from "~/atoms/rss-subscription-atoms"
import IconHashtag from "~/components/icons/icon-hashtag"
import { Button } from "~/components/ui/button"
import { Input, InputGroup } from "~/components/ui/input"
import {
	Modal,
	ModalBody,
	ModalClose,
	ModalContent,
	ModalFooter,
	ModalHeader,
	ModalTitle,
} from "~/components/ui/modal"
import { channelCollection } from "~/db/collections"
import { exitToast } from "~/lib/toast-exit"

type ChannelData = Channel.Type

const POLLING_INTERVAL_OPTIONS = [
	{ value: 5, label: "Every 5 minutes" },
	{ value: 15, label: "Every 15 minutes" },
	{ value: 30, label: "Every 30 minutes" },
	{ value: 60, label: "Every hour" },
]

interface AddRssSubscriptionModalProps {
	organizationId: OrganizationId
	isOpen: boolean
	onClose: () => void
	onSuccess: () => void
}

export function AddRssSubscriptionModal({
	organizationId,
	isOpen,
	onClose,
	onSuccess,
}: AddRssSubscriptionModalProps) {
	const [selectedChannel, setSelectedChannel] = useState<ChannelData | null>(null)
	const [feedUrl, setFeedUrl] = useState("")
	const [pollingInterval, setPollingInterval] = useState(15)
	const [isCreating, setIsCreating] = useState(false)
	const [channelSearch, setChannelSearch] = useState("")

	// Query all channels in organization
	const { data: channelsData } = useLiveQuery({
		query: (q) =>
			q
				.from({ channel: channelCollection })
				.where(({ channel }) => eq(channel.organizationId, organizationId))
				.where(({ channel }) => or(eq(channel.type, "public"), eq(channel.type, "private")))
				.select(({ channel }) => ({ ...channel })),
		queryKey: [organizationId],
	})
	const channels = channelsData ?? []

	const createSubscription = useAtomSet(createRssSubscriptionMutation, { mode: "promiseExit" })

	const isValidUrl = (() => {
		try {
			const url = new URL(feedUrl.trim())
			const protocol = url.protocol
			if (protocol === "https:") return true
			if (protocol === "http:") return true
			return false
		} catch {
			return false
		}
	})()

	const handleSubmit = async () => {
		if (!selectedChannel || !isValidUrl) return

		setIsCreating(true)
		const exit = await createSubscription({
			payload: {
				channelId: selectedChannel.id as ChannelId,
				feedUrl: feedUrl.trim(),
				pollingIntervalMinutes: pollingInterval,
			},
		})

		exitToast(exit)
			.onSuccess(() => {
				onSuccess()
				handleClose()
			})
			.successMessage(`Subscribed #${selectedChannel.name} to RSS feed`)
			.onErrorTag("RssSubscriptionExistsError", () => ({
				title: "Already subscribed",
				description: "This channel is already subscribed to this feed URL.",
				isRetryable: false,
			}))
			.onErrorTag("RssFeedValidationError", (error) => ({
				title: "Invalid feed URL",
				description: error.message,
				isRetryable: true,
			}))
			.onErrorTag("ChannelNotFoundError", () => ({
				title: "Channel not found",
				description: "This channel may have been deleted.",
				isRetryable: false,
			}))
			.run()
		setIsCreating(false)
	}

	const handleClose = () => {
		setSelectedChannel(null)
		setFeedUrl("")
		setPollingInterval(15)
		setChannelSearch("")
		onClose()
	}

	// Filter channels by search
	const filteredChannels = channelSearch
		? channels.filter((c) => c.name.toLowerCase().includes(channelSearch.toLowerCase()))
		: channels

	return (
		<Modal isOpen={isOpen} onOpenChange={(open) => !open && handleClose()}>
			<ModalContent size="lg">
				<ModalHeader>
					<ModalTitle>Add RSS Subscription</ModalTitle>
				</ModalHeader>

				<ModalBody>
					<div className="flex flex-col gap-4">
						{/* Step 1: Channel selector */}
						<div className="flex flex-col gap-2">
							<label className="font-medium text-fg text-sm">Channel</label>
							<p className="text-muted-fg text-xs">
								Select which channel receives the feed items.
							</p>
							{selectedChannel ? (
								<div className="flex items-center justify-between rounded-lg border border-accent bg-accent/5 p-3">
									<div className="flex items-center gap-3">
										<div className="flex size-8 items-center justify-center rounded bg-accent/10">
											<IconHashtag className="size-4 text-accent-fg" />
										</div>
										<span className="font-medium text-fg text-sm">
											{selectedChannel.name}
										</span>
									</div>
									<Button intent="plain" size="sm" onPress={() => setSelectedChannel(null)}>
										Change
									</Button>
								</div>
							) : (
								<div className="flex flex-col gap-2">
									<InputGroup>
										<Input
											placeholder="Search channels..."
											value={channelSearch}
											onChange={(e) => setChannelSearch(e.target.value)}
										/>
									</InputGroup>
									<div className="max-h-40 overflow-y-auto rounded-lg border border-border">
										{filteredChannels.length === 0 ? (
											<div className="flex items-center justify-center py-6 text-muted-fg text-sm">
												{channelSearch
													? "No channels found"
													: "No channels available"}
											</div>
										) : (
											<div className="divide-y divide-border">
												{filteredChannels.map((channel) => (
													<button
														key={channel.id}
														type="button"
														onClick={() => setSelectedChannel(channel)}
														className="group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-accent hover:text-accent-fg focus:bg-accent focus:text-accent-fg focus:outline-none"
													>
														<div className="flex size-6 shrink-0 items-center justify-center rounded bg-bg-muted group-hover:bg-accent-fg/10 group-focus:bg-accent-fg/10">
															<IconHashtag className="size-3.5 text-muted-fg group-hover:text-accent-fg group-focus:text-accent-fg" />
														</div>
														<span className="truncate font-medium text-sm">
															{channel.name}
														</span>
													</button>
												))}
											</div>
										)}
									</div>
								</div>
							)}
						</div>

						{/* Step 2: Feed URL (only show when channel is selected) */}
						{selectedChannel && (
							<div className="flex flex-col gap-2">
								<label className="font-medium text-fg text-sm">Feed URL</label>
								<p className="text-muted-fg text-xs">
									Enter the RSS or Atom feed URL. The feed will be validated when you
									submit.
								</p>
								<InputGroup>
									<Input
										placeholder="https://example.com/feed.xml"
										value={feedUrl}
										onChange={(e) => setFeedUrl(e.target.value)}
									/>
								</InputGroup>
								{feedUrl.trim() && !isValidUrl && (
									<p className="text-danger text-xs">
										Please enter a valid URL starting with https:// or http://
									</p>
								)}
							</div>
						)}

						{/* Step 3: Polling interval (only show when URL is valid) */}
						{selectedChannel && isValidUrl && (
							<div className="flex flex-col gap-2">
								<label className="font-medium text-fg text-sm">Polling Interval</label>
								<p className="text-muted-fg text-xs">
									How often to check the feed for new items.
								</p>
								<div className="grid grid-cols-2 gap-2">
									{POLLING_INTERVAL_OPTIONS.map((option) => (
										<button
											key={option.value}
											type="button"
											onClick={() => setPollingInterval(option.value)}
											className={`rounded-lg border p-3 text-left text-sm transition-all ${
												pollingInterval === option.value
													? "border-accent bg-accent/5 font-medium text-fg"
													: "border-border text-muted-fg hover:border-border-hover hover:bg-bg-muted"
											}`}
										>
											{option.label}
										</button>
									))}
								</div>
							</div>
						)}
					</div>
				</ModalBody>

				<ModalFooter>
					<ModalClose intent="secondary">Cancel</ModalClose>
					<Button
						intent="primary"
						onPress={handleSubmit}
						isDisabled={!selectedChannel || !isValidUrl || isCreating}
					>
						{isCreating ? "Adding..." : "Add Subscription"}
					</Button>
				</ModalFooter>
			</ModalContent>
		</Modal>
	)
}
