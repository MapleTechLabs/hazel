import { useAtomSet } from "@effect/atom-react"
import type { WithVirtualProps } from "@tanstack/db"
import type { Channel } from "@hazel/domain/models"
import type { ChannelId, OrganizationId } from "@hazel/schema"
import { eq, or, useLiveQuery } from "@tanstack/react-db"
import { formatDistanceToNow } from "date-fns"
import { toDate } from "~/lib/utils"
import { useCallback, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { listOrganizationWebhooksMutation, type WebhookData } from "~/atoms/channel-webhook-atoms"
import { useMountEffect } from "~/hooks/use-mount-effect"
import { getProviderIconUrl } from "~/components/embeds/use-embed-theme"
import IconCheck from "~/components/icons/icon-check"
import IconCopy from "~/components/icons/icon-copy"
import IconHashtag from "~/components/icons/icon-hashtag"
import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import { Input } from "~/components/ui/input"
import { channelCollection } from "~/db/collections"
import { exitToast } from "~/lib/toast-exit"
import { ConfigureRailwayModal } from "./configure-railway-modal"

type ChannelData = WithVirtualProps<Channel.Type>

interface RailwayIntegrationContentProps {
	organizationId: OrganizationId
}

export function RailwayIntegrationContent({ organizationId }: RailwayIntegrationContentProps) {
	const [isModalOpen, setIsModalOpen] = useState(false)
	const [selectedChannelId, setSelectedChannelId] = useState<ChannelId | null>(null)
	const [selectedWebhook, setSelectedWebhook] = useState<WebhookData | null>(null)
	const [webhooks, setWebhooks] = useState<readonly WebhookData[]>([])
	const [isLoading, setIsLoading] = useState(true)
	const [newlyCreatedWebhook, setNewlyCreatedWebhook] = useState<{
		webhookId: string
		token: string
		channelId: ChannelId
	} | null>(null)
	const [copied, setCopied] = useState(false)

	const listWebhooks = useAtomSet(listOrganizationWebhooksMutation, { mode: "promiseExit" })

	// Use ref to avoid stale closures and unnecessary effect re-runs
	const listWebhooksRef = useRef(listWebhooks)
	listWebhooksRef.current = listWebhooks

	// Query all channels in organization (public and private only, not DMs/threads)
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

	// Fetch webhooks (isInitial = false for refetches to avoid remount)
	const fetchWebhooks = useCallback(async (isInitial = false) => {
		if (isInitial) setIsLoading(true)
		const exit = await listWebhooksRef.current({ payload: {} })

		exitToast(exit)
			.onSuccess((result) => setWebhooks(result.data))
			.run()
		if (isInitial) setIsLoading(false)
	}, [])

	// Fetch webhooks on mount
	useMountEffect(() => {
		void fetchWebhooks(true)
	})

	// Filter to Railway webhooks only
	const railwayWebhooks = useMemo(() => webhooks.filter((w) => w.name === "Railway"), [webhooks])

	// Map webhooks to channels for display
	const configuredChannels = useMemo(() => {
		return railwayWebhooks
			.map((webhook) => {
				const channel = channels.find((c) => c.id === webhook.channelId)
				return { webhook, channel }
			})
			.filter(
				(item): item is { webhook: WebhookData; channel: ChannelData } => item.channel !== undefined,
			)
	}, [railwayWebhooks, channels])

	// Get channels without Railway configured
	const unconfiguredChannels = useMemo(() => {
		const configuredIds = new Set(railwayWebhooks.map((w) => w.channelId))
		return channels.filter((c) => !configuredIds.has(c.id))
	}, [channels, railwayWebhooks])

	const handleAddChannel = () => {
		setSelectedChannelId(null)
		setSelectedWebhook(null)
		setIsModalOpen(true)
	}

	const handleManageChannel = (webhook: WebhookData, channel: ChannelData) => {
		setSelectedChannelId(channel.id)
		setSelectedWebhook(webhook)
		setIsModalOpen(true)
	}

	const handleSuccess = () => {
		fetchWebhooks()
	}

	const handleWebhookCreated = (data: { webhookId: string; token: string; channelId: ChannelId }) => {
		setNewlyCreatedWebhook(data)
	}

	const handleCopyUrl = async () => {
		if (!newlyCreatedWebhook) return
		const url = `${import.meta.env.VITE_BACKEND_URL}/webhooks/incoming/${newlyCreatedWebhook.webhookId}/${newlyCreatedWebhook.token}/railway`
		try {
			await navigator.clipboard.writeText(url)
			setCopied(true)
			toast.success("URL copied")
			setTimeout(() => setCopied(false), 2000)
		} catch {
			toast.error("Failed to copy")
		}
	}

	const handleDismissNewWebhook = () => {
		setNewlyCreatedWebhook(null)
		setCopied(false)
	}

	// Show loading if webhooks are loading, or if we have webhooks but channels haven't loaded yet from Electric
	const isChannelsLoading = railwayWebhooks.length > 0 && channels.length === 0
	if (isLoading || isChannelsLoading) {
		return (
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
					<span className="text-sm">Loading channels...</span>
				</div>
			</div>
		)
	}

	return (
		<>
			<div className="overflow-hidden rounded-xl border border-border bg-bg">
				<div className="flex items-center justify-between border-border border-b bg-bg-muted/30 px-5 py-3">
					<h3 className="font-medium text-fg text-sm">Configured Channels</h3>
					<Button
						intent="primary"
						size="sm"
						onPress={handleAddChannel}
						isDisabled={unconfiguredChannels.length === 0}
					>
						<svg
							className="size-4"
							fill="none"
							viewBox="0 0 24 24"
							stroke="currentColor"
							strokeWidth={2}
						>
							<path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
						</svg>
						Add Channel
					</Button>
				</div>

				{configuredChannels.length === 0 && !newlyCreatedWebhook ? (
					<div className="flex flex-col items-center justify-center px-5 py-12 text-center">
						<div className="mb-4 flex size-16 items-center justify-center rounded-lg bg-secondary/50">
							<img
								src={getProviderIconUrl("railway")}
								alt="Railway"
								className="size-8 rounded"
							/>
						</div>
						<h4 className="mb-1 font-medium text-fg">No channels configured</h4>
						<p className="mb-6 max-w-sm text-muted-fg text-sm">
							Add Railway to a channel to start receiving deployment alerts and notifications.
						</p>
						<Button intent="primary" onPress={handleAddChannel}>
							<svg
								className="size-4"
								fill="none"
								viewBox="0 0 24 24"
								stroke="currentColor"
								strokeWidth={2}
							>
								<path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
							</svg>
							Add Your First Channel
						</Button>
					</div>
				) : (
					<div className="divide-y divide-border">
						{newlyCreatedWebhook && (
							<div className="border-warning/30 border-b bg-warning-subtle/30 px-5 py-4">
								<div className="flex items-start gap-3">
									<div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-warning-subtle">
										<svg
											className="size-4 text-warning-subtle-fg"
											fill="none"
											viewBox="0 0 24 24"
											stroke="currentColor"
											strokeWidth={2}
										>
											<path
												strokeLinecap="round"
												strokeLinejoin="round"
												d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
											/>
										</svg>
									</div>
									<div className="flex-1 space-y-3">
										<div>
											<p className="font-medium text-warning-subtle-fg text-sm">
												Copy the webhook URL and add it to your Railway project
												webhook settings
											</p>
											<p className="mt-1 text-warning-subtle-fg/80 text-xs">
												#
												{channels.find((c) => c.id === newlyCreatedWebhook.channelId)
													?.name ?? "channel"}{" "}
												• The full URL includes your secret token. Keep it safe!
											</p>
										</div>
										<div className="flex gap-2">
											<Input
												value={`${import.meta.env.VITE_BACKEND_URL}/webhooks/incoming/${newlyCreatedWebhook.webhookId}/${newlyCreatedWebhook.token}/railway`}
												readOnly
												className="flex-1 font-mono text-xs"
											/>
											<Button intent="outline" size="sq-sm" onPress={handleCopyUrl}>
												{copied ? (
													<IconCheck className="size-4 text-success" />
												) : (
													<IconCopy className="size-4" />
												)}
											</Button>
										</div>
										<Button
											intent="secondary"
											size="sm"
											onPress={handleDismissNewWebhook}
										>
											Done
										</Button>
									</div>
								</div>
							</div>
						)}
						{configuredChannels.map(({ webhook, channel }) => (
							<div
								key={webhook.id}
								className="flex items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-bg-muted/20"
							>
								<div className="flex items-center gap-3">
									<div className="flex size-10 items-center justify-center rounded-lg bg-bg-muted">
										<IconHashtag className="size-5 text-muted-fg" />
									</div>
									<div className="flex flex-col gap-0.5">
										<div className="flex items-center gap-2">
											<span className="font-medium text-fg">{channel.name}</span>
											<Badge intent={webhook.isEnabled ? "success" : "secondary"}>
												{webhook.isEnabled ? "Active" : "Disabled"}
											</Badge>
										</div>
										<p className="text-muted-fg text-xs">
											{webhook.lastUsedAt
												? `Last alert ${formatDistanceToNow(toDate(webhook.lastUsedAt), { addSuffix: true })}`
												: "No alerts received yet"}
										</p>
									</div>
								</div>
								<Button
									intent="outline"
									size="sm"
									onPress={() => handleManageChannel(webhook, channel)}
								>
									Manage
								</Button>
							</div>
						))}
					</div>
				)}
			</div>

			<ConfigureRailwayModal
				// Key resets modal state when switching between channels/webhooks
				key={selectedWebhook?.id ?? selectedChannelId ?? "new"}
				isOpen={isModalOpen}
				onOpenChange={setIsModalOpen}
				channels={selectedWebhook ? channels : unconfiguredChannels}
				selectedChannelId={selectedChannelId}
				existingWebhook={selectedWebhook}
				onSuccess={handleSuccess}
				onWebhookCreated={handleWebhookCreated}
			/>
		</>
	)
}
