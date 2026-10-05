import { useAtomSet, useAtomValue } from "@effect/atom-react"
import type { Channel } from "@hazel/domain/models"
import type { GitHubSubscriptionId, OrganizationId } from "@hazel/schema"
import { eq, or, useLiveQuery } from "@tanstack/react-db"
import { useCallback, useMemo, useRef, useState } from "react"
import { useMountEffect } from "~/hooks/use-mount-effect"
import {
	deleteGitHubSubscriptionMutation,
	type GitHubSubscriptionData,
	listOrganizationGitHubSubscriptionsMutation,
	updateGitHubSubscriptionMutation,
} from "~/atoms/github-subscription-atoms"
import { getProviderIconUrl } from "~/components/embeds/use-embed-theme"
import { IconCirclePause } from "~/components/icons/icon-circle-pause"
import IconDotsVertical from "~/components/icons/icon-dots-vertical"
import IconEdit from "~/components/icons/icon-edit"
import IconHashtag from "~/components/icons/icon-hashtag"
import { IconPlay } from "~/components/icons/icon-play"
import IconTrash from "~/components/icons/icon-trash"
import { resolvedThemeAtom } from "~/components/theme-provider"
import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator } from "~/components/ui/menu"
import { Modal, ModalClose, ModalContent, ModalFooter, ModalHeader } from "~/components/ui/modal"
import { channelCollection } from "~/db/collections"
import { exitToast } from "~/lib/toast-exit"
import { AddGitHubSubscriptionModal } from "./add-github-subscription-modal"
import { EditGitHubSubscriptionModal } from "./edit-github-subscription-modal"

type ChannelData = Channel.Type

interface GitHubSubscriptionsSectionProps {
	organizationId: OrganizationId
}

const EVENT_LABELS: Record<string, string> = {
	push: "Push",
	pull_request: "PRs",
	issues: "Issues",
	release: "Releases",
	deployment_status: "Deploy",
	workflow_run: "Actions",
	star: "Stars",
}

export function GitHubSubscriptionsSection({ organizationId }: GitHubSubscriptionsSectionProps) {
	const [subscriptions, setSubscriptions] = useState<readonly GitHubSubscriptionData[]>([])
	const [isLoading, setIsLoading] = useState(true)
	const [isAddModalOpen, setIsAddModalOpen] = useState(false)
	const [editingSubscription, setEditingSubscription] = useState<{
		subscription: GitHubSubscriptionData
		channelName: string
	} | null>(null)

	const resolvedTheme = useAtomValue(resolvedThemeAtom)

	const listSubscriptions = useAtomSet(listOrganizationGitHubSubscriptionsMutation, {
		mode: "promiseExit",
	})
	const updateSubscription = useAtomSet(updateGitHubSubscriptionMutation, { mode: "promiseExit" })
	const deleteSubscription = useAtomSet(deleteGitHubSubscriptionMutation, { mode: "promiseExit" })

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

	// Group subscriptions by repository
	const groupedSubscriptions = useMemo(() => {
		const groups = new Map<
			string,
			{
				repositoryFullName: string
				repositoryId: number
				subscriptions: Array<GitHubSubscriptionData & { channelName: string }>
			}
		>()

		for (const sub of subscriptions) {
			const channel = channelMap.get(sub.channelId)
			const channelName = channel?.name ?? "Unknown"

			if (!groups.has(sub.repositoryFullName)) {
				groups.set(sub.repositoryFullName, {
					repositoryFullName: sub.repositoryFullName,
					repositoryId: sub.repositoryId,
					subscriptions: [],
				})
			}

			groups.get(sub.repositoryFullName)?.subscriptions.push({
				...sub,
				channelName,
			})
		}

		// Sort groups by repository name
		return Array.from(groups.values()).sort((a, b) =>
			a.repositoryFullName.localeCompare(b.repositoryFullName),
		)
	}, [subscriptions, channelMap])

	const handleToggle = async (subscription: GitHubSubscriptionData) => {
		const exit = await updateSubscription({
			payload: {
				id: subscription.id as GitHubSubscriptionId,
				isEnabled: !subscription.isEnabled,
			},
		})

		exitToast(exit)
			.onSuccess(() => fetchSubscriptions())
			.successMessage(subscription.isEnabled ? "Subscription disabled" : "Subscription enabled")
			.onErrorTag("GitHubSubscriptionNotFoundError", () => ({
				title: "Subscription not found",
				description: "This subscription may have been deleted.",
				isRetryable: false,
			}))
			.run()
	}

	const handleDelete = async (subscription: GitHubSubscriptionData) => {
		const exit = await deleteSubscription({
			payload: { id: subscription.id as GitHubSubscriptionId },
		})

		exitToast(exit)
			.onSuccess(() => fetchSubscriptions())
			.successMessage("Subscription removed")
			.onErrorTag("GitHubSubscriptionNotFoundError", () => ({
				title: "Subscription not found",
				description: "This subscription may have already been deleted.",
				isRetryable: false,
			}))
			.run()
	}

	const handleEdit = (subscription: GitHubSubscriptionData, channelName: string) => {
		setEditingSubscription({ subscription, channelName })
	}

	// Loading state - wait for both subscriptions and channels
	const isChannelsLoading = subscriptions.length > 0 && channels.length === 0
	if (isLoading || isChannelsLoading) {
		return (
			<div className="overflow-hidden rounded-xl border border-border bg-bg">
				<div className="border-border border-b bg-bg-muted/30 px-5 py-3">
					<h3 className="font-semibold text-fg text-sm">Channel Subscriptions</h3>
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
						<h3 className="font-semibold text-fg text-sm">Channel Subscriptions</h3>
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
						Add Subscription
					</Button>
				</div>

				{groupedSubscriptions.length === 0 ? (
					<div className="flex flex-col items-center justify-center px-5 py-12 text-center">
						<div className="mb-4 flex size-16 items-center justify-center rounded-lg bg-secondary/50">
							<img
								src={getProviderIconUrl("github", {
									theme: resolvedTheme === "dark" ? "light" : "dark",
								})}
								alt="GitHub"
								className="size-8 rounded"
							/>
						</div>
						<h4 className="mb-1 font-medium text-fg">No subscriptions configured</h4>
						<p className="mb-6 max-w-sm text-muted-fg text-sm">
							Subscribe channels to GitHub repositories to receive notifications for pushes,
							pull requests, issues, and more.
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
							Add Your First Subscription
						</Button>
					</div>
				) : (
					<div className="divide-y divide-border">
						{groupedSubscriptions.map((group) => (
							<div key={group.repositoryFullName}>
								{/* Repository header */}
								<div className="flex items-center gap-3 bg-bg-muted/20 px-5 py-2.5">
									<div className="flex size-6 items-center justify-center rounded bg-bg-muted">
										<svg
											className="size-3.5 text-muted-fg"
											fill="currentColor"
											viewBox="0 0 16 16"
										>
											<path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8ZM5 12.25v3.25a.25.25 0 0 0 .4.2l1.45-1.087a.25.25 0 0 1 .3 0L8.6 15.7a.25.25 0 0 0 .4-.2v-3.25a.25.25 0 0 0-.25-.25h-3.5a.25.25 0 0 0-.25.25Z" />
										</svg>
									</div>
									<span className="font-medium text-fg text-sm">
										{group.repositoryFullName}
									</span>
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
											onEdit={() => handleEdit(sub, sub.channelName)}
										/>
									))}
								</div>
							</div>
						))}
					</div>
				)}
			</div>

			<AddGitHubSubscriptionModal
				organizationId={organizationId}
				isOpen={isAddModalOpen}
				onClose={() => setIsAddModalOpen(false)}
				onSuccess={() => fetchSubscriptions()}
			/>

			{editingSubscription && (
				<EditGitHubSubscriptionModal
					subscription={editingSubscription.subscription}
					channelName={editingSubscription.channelName}
					isOpen={true}
					onClose={() => setEditingSubscription(null)}
					onSuccess={() => fetchSubscriptions()}
				/>
			)}
		</>
	)
}

interface SubscriptionRowProps {
	subscription: GitHubSubscriptionData
	channelName: string
	onToggle: () => void
	onDelete: () => void
	onEdit: () => void
}

function SubscriptionRow({ subscription, channelName, onToggle, onDelete, onEdit }: SubscriptionRowProps) {
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

	// Get first 2 event labels
	const eventLabels = subscription.enabledEvents
		.slice(0, 2)
		.map((e) => EVENT_LABELS[e] ?? e)
		.join(", ")
	const remainingCount = subscription.enabledEvents.length - 2

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
					</div>
					<div className="flex items-center gap-2 text-muted-fg text-xs">
						<span>
							{eventLabels}
							{remainingCount > 0 && ` +${remainingCount}`}
						</span>
						{subscription.branchFilter && (
							<>
								<span className="text-muted-fg/50">·</span>
								<span className="font-mono">{subscription.branchFilter}</span>
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
					<MenuItem onAction={onEdit}>
						<IconEdit className="size-4" />
						<MenuLabel>Edit</MenuLabel>
					</MenuItem>
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
						title="Remove subscription?"
						description="This will stop posting GitHub events to this channel."
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
