import { useAtomSet } from "@effect/atom-react"
import type { Channel } from "@hazel/domain/models"
import type { OrganizationId, RssSubscriptionId } from "@hazel/schema"
import { eq, or, useLiveQuery } from "@tanstack/react-db"
import { useCallback, useMemo, useRef, useState } from "react"
import { useMountEffect } from "~/hooks/use-mount-effect"
import { toDate } from "~/lib/utils"
import {
	deleteRssSubscriptionMutation,
	listOrganizationRssSubscriptionsMutation,
	type RssSubscriptionData,
	updateRssSubscriptionMutation,
} from "~/atoms/rss-subscription-atoms"
import { IconCirclePause } from "~/components/icons/icon-circle-pause"
import IconDotsVertical from "~/components/icons/icon-dots-vertical"
import IconHashtag from "~/components/icons/icon-hashtag"
import { IconPlay } from "~/components/icons/icon-play"
import IconTrash from "~/components/icons/icon-trash"
import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator } from "~/components/ui/menu"
import { Modal, ModalClose, ModalContent, ModalFooter, ModalHeader } from "~/components/ui/modal"
import { channelCollection } from "~/db/collections"
import { exitToast } from "~/lib/toast-exit"
import { AddRssSubscriptionModal } from "./add-rss-subscription-modal"

type ChannelData = Channel.Type

interface RssSubscriptionsSectionProps {
	organizationId: OrganizationId
}

export function RssSubscriptionsSection({ organizationId }: RssSubscriptionsSectionProps) {
	const [subscriptions, setSubscriptions] = useState<readonly RssSubscriptionData[]>([])
	const [isLoading, setIsLoading] = useState(true)
	const [isAddModalOpen, setIsAddModalOpen] = useState(false)

	const listSubscriptions = useAtomSet(listOrganizationRssSubscriptionsMutation, {
		mode: "promiseExit",
	})
	const updateSubscription = useAtomSet(updateRssSubscriptionMutation, { mode: "promiseExit" })
	const deleteSubscription = useAtomSet(deleteRssSubscriptionMutation, { mode: "promiseExit" })

	// Ref to avoid stale closures
	const listSubscriptionsRef = useRef(listSubscriptions)
	listSubscriptionsRef.current = listSubscriptions

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

	// Create channel lookup map
	const channelMap = useMemo(() => {
		const map = new Map<string, ChannelData>()
		for (const channel of channels) {
			map.set(channel.id, channel)
		}
		return map
	}, [channels])

	// Fetch subscriptions
	const fetchSubscriptions = useCallback(async (isInitial = false) => {
		if (isInitial) setIsLoading(true)
		const exit = await listSubscriptionsRef.current({ payload: {} })

		exitToast(exit)
			.onSuccess((result) => setSubscriptions(result.data))
			.run()
		if (isInitial) setIsLoading(false)
	}, [])

	// Fetch on mount
	useMountEffect(() => {
		void fetchSubscriptions(true)
	})

	// Group subscriptions by feed URL
	const groupedSubscriptions = useMemo(() => {
		const groups = new Map<
			string,
			{
				feedUrl: string
				feedTitle: string | null
				subscriptions: Array<RssSubscriptionData & { channelName: string }>
			}
		>()

		for (const sub of subscriptions) {
			const channel = channelMap.get(sub.channelId)
			const channelName = channel?.name ?? "Unknown"

			if (!groups.has(sub.feedUrl)) {
				groups.set(sub.feedUrl, {
					feedUrl: sub.feedUrl,
					feedTitle: sub.feedTitle,
					subscriptions: [],
				})
			}

			groups.get(sub.feedUrl)?.subscriptions.push({
				...sub,
				channelName,
			})
		}

		// Sort groups by feed title or URL
		return Array.from(groups.values()).sort((a, b) =>
			(a.feedTitle ?? a.feedUrl).localeCompare(b.feedTitle ?? b.feedUrl),
		)
	}, [subscriptions, channelMap])

	const handleToggle = async (subscription: RssSubscriptionData) => {
		const exit = await updateSubscription({
			payload: {
				id: subscription.id as RssSubscriptionId,
				isEnabled: !subscription.isEnabled,
			},
		})

		exitToast(exit)
			.onSuccess(() => fetchSubscriptions())
			.successMessage(subscription.isEnabled ? "Subscription disabled" : "Subscription enabled")
			.onErrorTag("RssSubscriptionNotFoundError", () => ({
				title: "Subscription not found",
				description: "This subscription may have been deleted.",
				isRetryable: false,
			}))
			.run()
	}

	const handleDelete = async (subscription: RssSubscriptionData) => {
		const exit = await deleteSubscription({
			payload: { id: subscription.id as RssSubscriptionId },
		})

		exitToast(exit)
			.onSuccess(() => fetchSubscriptions())
			.successMessage("Subscription removed")
			.onErrorTag("RssSubscriptionNotFoundError", () => ({
				title: "Subscription not found",
				description: "This subscription may have already been deleted.",
				isRetryable: false,
			}))
			.run()
	}

	// Loading state - wait for both subscriptions and channels
	const isChannelsLoading = subscriptions.length > 0 && channels.length === 0
	if (isLoading || isChannelsLoading) {
		return (
			<div className="overflow-hidden rounded-xl border border-border bg-bg">
				<div className="border-border border-b bg-bg-muted/30 px-5 py-3">
					<h3 className="font-semibold text-fg text-sm">RSS Subscriptions</h3>
				</div>
				<div className="flex items-center justify-center p-8">
					<div className="flex items-center gap-3 text-muted-fg">
						<svg className="size-5 animate-spin" fill="none" viewBox="0 0 24 24">
							<circle
								className="opacity-25"
								cx="12"
								cy="12"
								r="10"
								stroke="currentColor"
								strokeWidth="4"
							/>
							<path
								className="opacity-75"
								fill="currentColor"
								d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
							/>
						</svg>
						<span className="text-sm">Loading subscriptions...</span>
					</div>
				</div>
			</div>
		)
	}

	return (
		<>
			<div className="overflow-hidden rounded-xl border border-border bg-bg">
				<div className="flex items-center justify-between border-border border-b bg-bg-muted/30 px-5 py-3">
					<div className="flex items-center gap-2">
						<h3 className="font-semibold text-fg text-sm">RSS Subscriptions</h3>
						{subscriptions.length > 0 && (
							<span className="rounded-full bg-secondary px-2 py-0.5 text-muted-fg text-xs">
								{subscriptions.length}
							</span>
						)}
					</div>
					<Button intent="primary" size="sm" onPress={() => setIsAddModalOpen(true)}>
						<svg
							className="size-4"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
							strokeWidth={2}
						>
							<path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
						</svg>
						Add Feed
					</Button>
				</div>

				{groupedSubscriptions.length === 0 ? (
					<div className="flex flex-col items-center justify-center px-5 py-12 text-center">
						<div className="mb-4 flex size-16 items-center justify-center rounded-lg bg-warning-subtle">
							<svg
								className="size-8 text-warning-subtle-fg"
								fill="none"
								viewBox="0 0 24 24"
								stroke="currentColor"
								strokeWidth={1.5}
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									d="M12.75 19.5v-.75a7.5 7.5 0 0 0-7.5-7.5H4.5m0-6.75h.75c7.87 0 14.25 6.38 14.25 14.25v.75M6 18.75a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z"
								/>
							</svg>
						</div>
						<h4 className="mb-1 font-medium text-fg">No RSS feeds configured</h4>
						<p className="mb-6 max-w-sm text-muted-fg text-sm">
							Subscribe channels to RSS or Atom feeds to automatically post new articles and
							updates.
						</p>
						<Button intent="primary" onPress={() => setIsAddModalOpen(true)}>
							<svg
								className="size-4"
								fill="none"
								viewBox="0 0 24 24"
								stroke="currentColor"
								strokeWidth={2}
							>
								<path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
							</svg>
							Add Your First Feed
						</Button>
					</div>
				) : (
					<div className="divide-y divide-border">
						{groupedSubscriptions.map((group) => (
							<div key={group.feedUrl}>
								{/* Feed header */}
								<div className="flex items-center gap-3 bg-bg-muted/20 px-5 py-2.5">
									<div className="flex size-6 items-center justify-center rounded bg-warning-subtle">
										<svg
											className="size-3.5 text-warning-subtle-fg"
											fill="none"
											viewBox="0 0 24 24"
											stroke="currentColor"
											strokeWidth={2}
										>
											<path
												strokeLinecap="round"
												strokeLinejoin="round"
												d="M12.75 19.5v-.75a7.5 7.5 0 0 0-7.5-7.5H4.5m0-6.75h.75c7.87 0 14.25 6.38 14.25 14.25v.75M6 18.75a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z"
											/>
										</svg>
									</div>
									<div className="min-w-0 flex-1">
										<span className="font-medium text-fg text-sm">
											{group.feedTitle ?? group.feedUrl}
										</span>
										{group.feedTitle && (
											<p className="truncate text-muted-fg text-xs">{group.feedUrl}</p>
										)}
									</div>
									<span className="text-muted-fg text-xs">
										{group.subscriptions.length} channel
										{group.subscriptions.length === 1 ? "" : "s"}
									</span>
								</div>

								{/* Channel subscriptions */}
								<div className="divide-y divide-border/50">
									{group.subscriptions.map((sub) => (
										<SubscriptionRow
											key={sub.id}
											subscription={sub}
											channelName={sub.channelName}
											onToggle={() => handleToggle(sub)}
											onDelete={() => handleDelete(sub)}
										/>
									))}
								</div>
							</div>
						))}
					</div>
				)}
			</div>

			<AddRssSubscriptionModal
				organizationId={organizationId}
				isOpen={isAddModalOpen}
				onClose={() => setIsAddModalOpen(false)}
				onSuccess={() => fetchSubscriptions()}
			/>
		</>
	)
}

interface SubscriptionRowProps {
	subscription: RssSubscriptionData
	channelName: string
	onToggle: () => void
	onDelete: () => void
}

function SubscriptionRow({ subscription, channelName, onToggle, onDelete }: SubscriptionRowProps) {
	const [showDeleteDialog, setShowDeleteDialog] = useState(false)
	const [isToggling, setIsToggling] = useState(false)
	const [isDeleting, setIsDeleting] = useState(false)

	const handleToggle = async () => {
		setIsToggling(true)
		await onToggle()
		setIsToggling(false)
	}

	const handleDelete = async () => {
		setIsDeleting(true)
		await onDelete()
		setIsDeleting(false)
		setShowDeleteDialog(false)
	}

	// Format polling interval
	const intervalLabel =
		subscription.pollingIntervalMinutes >= 60
			? `${subscription.pollingIntervalMinutes / 60}h`
			: `${subscription.pollingIntervalMinutes}m`

	// Error indicator
	const hasErrors = subscription.consecutiveErrors > 0

	return (
		<div className="flex items-center justify-between gap-4 px-5 py-3 transition-colors hover:bg-bg-muted/30">
			<div className="flex min-w-0 flex-1 items-center gap-3">
				<div className="flex size-8 shrink-0 items-center justify-center rounded bg-bg-muted">
					<IconHashtag className="size-4 text-muted-fg" />
				</div>
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2">
						<span className="truncate font-medium text-fg text-sm">{channelName}</span>
						<Badge intent={subscription.isEnabled ? "success" : "secondary"} className="shrink-0">
							{subscription.isEnabled ? "Active" : "Disabled"}
						</Badge>
						{hasErrors && (
							<Badge intent="danger" className="shrink-0">
								{subscription.consecutiveErrors} error
								{subscription.consecutiveErrors === 1 ? "" : "s"}
							</Badge>
						)}
					</div>
					<div className="flex items-center gap-2 text-muted-fg text-xs">
						<span>Every {intervalLabel}</span>
						{subscription.lastFetchedAt && (
							<>
								<span className="text-muted-fg/50">·</span>
								<span>
									Last fetched {toDate(subscription.lastFetchedAt).toLocaleDateString()}
								</span>
							</>
						)}
					</div>
				</div>
			</div>

			<Menu>
				<Button intent="plain" size="sq-xs" className="text-muted-fg">
					<IconDotsVertical className="size-4" />
				</Button>
				<MenuContent placement="bottom end">
					<MenuItem onAction={handleToggle} isDisabled={isToggling}>
						{subscription.isEnabled ? (
							<IconCirclePause className="size-4" />
						) : (
							<IconPlay className="size-4" />
						)}
						<MenuLabel>{subscription.isEnabled ? "Disable" : "Enable"}</MenuLabel>
					</MenuItem>
					<MenuSeparator />
					<MenuItem intent="danger" onAction={() => setShowDeleteDialog(true)}>
						<IconTrash className="size-4" />
						<MenuLabel>Remove</MenuLabel>
					</MenuItem>
				</MenuContent>
			</Menu>

			<Modal isOpen={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
				<ModalContent role="alertdialog" size="xs">
					<ModalHeader
						title="Remove feed?"
						description="This will stop posting updates from this RSS feed."
					/>
					<ModalFooter>
						<ModalClose>Cancel</ModalClose>
						<Button intent="danger" onPress={handleDelete} isPending={isDeleting}>
							Remove
						</Button>
					</ModalFooter>
				</ModalContent>
			</Modal>
		</div>
	)
}
