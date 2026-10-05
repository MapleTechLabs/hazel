import { AsyncResult } from "effect/reactivity"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import type { SyncChannelLinkId, SyncConnectionId } from "@hazel/schema"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { eq, useLiveQuery } from "@tanstack/react-db"
import { Option } from "effect"
import { useMemo, useState } from "react"
import { toDate } from "~/lib/utils"
import { AddChannelLinkModal } from "~/components/chat-sync/add-channel-link-modal"
import IconCirclePause from "~/components/icons/icon-circle-pause"
import IconDotsVertical from "~/components/icons/icon-dots-vertical"
import IconHashtag from "~/components/icons/icon-hashtag"
import IconPlay from "~/components/icons/icon-play"
import IconPlus from "~/components/icons/icon-plus"
import IconTrash from "~/components/icons/icon-trash"
import { Button } from "~/components/ui/button"
import {
	Dialog,
	DialogClose,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "~/components/ui/dialog"
import { EmptyState } from "~/components/ui/empty-state"
import {
	Menu,
	MenuContent,
	MenuItem,
	MenuLabel,
	MenuSeparator,
	MenuSubMenu,
	MenuTrigger,
} from "~/components/ui/menu"
import { Modal, ModalContent } from "~/components/ui/modal"
import { SectionHeader } from "~/components/ui/section-header"
import { channelCollection } from "~/db/collections"
import { useOrganization } from "~/hooks/use-organization"
import { HazelRpcClient } from "~/lib/services/common/rpc-atom-client"
import { exitToast } from "~/lib/toast-exit"

export const Route = createFileRoute("/_app/$orgSlug/settings/chat-sync/$connectionId")({
	component: ChatSyncConnectionDetailPage,
})

const DISCORD_BRAND_COLOR = "#5865F2"

type ConnectionStatus = "active" | "paused" | "error" | "disabled"
type SyncDirection = "both" | "hazel_to_external" | "external_to_hazel"

const STATUS_CONFIG: Record<ConnectionStatus, { label: string; badgeClass: string }> = {
	active: {
		label: "Active",
		badgeClass: "bg-success-subtle text-success-subtle-fg",
	},
	paused: {
		label: "Paused",
		badgeClass: "bg-warning-subtle text-warning-subtle-fg",
	},
	error: {
		label: "Error",
		badgeClass: "bg-danger-subtle text-danger-subtle-fg",
	},
	disabled: {
		label: "Disabled",
		badgeClass: "bg-muted text-muted-fg",
	},
}

type WebhookPermissionState = "allowed" | "denied" | "unknown"

const WEBHOOK_PERMISSION_LABELS: Record<WebhookPermissionState, { label: string; badgeClass: string }> = {
	allowed: {
		label: "Webhook",
		badgeClass: "bg-success-subtle text-success-subtle-fg",
	},
	denied: {
		label: "Bot fallback",
		badgeClass: "bg-warning-subtle text-warning-subtle-fg",
	},
	unknown: {
		label: "Checking",
		badgeClass: "bg-muted text-muted-fg",
	},
}

const getWebhookPermissionFromSettings = (
	settings: Record<string, unknown> | null | undefined,
): WebhookPermissionState => {
	const raw = settings?.webhookPermission
	if (!raw || typeof raw !== "object") {
		return "unknown"
	}

	const status = (raw as { status?: unknown }).status
	if (status === "allowed" || status === "denied") {
		return status
	}

	return "unknown"
}

const DIRECTION_PATHS: Record<SyncDirection, string> = {
	both: "M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5",
	hazel_to_external: "M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3",
	external_to_hazel: "M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18",
}

function DirectionIcon({
	direction,
	...props
}: { direction: SyncDirection } & React.SVGProps<SVGSVGElement>) {
	return (
		<svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} {...props}>
			<path strokeLinecap="round" strokeLinejoin="round" d={DIRECTION_PATHS[direction]} />
		</svg>
	)
}

const DIRECTION_DISPLAY: Record<SyncDirection, { label: string; icon: React.ReactNode }> = {
	both: {
		label: "Both",
		icon: <DirectionIcon direction="both" className="size-4" />,
	},
	hazel_to_external: {
		label: "Hazel to Discord",
		icon: <DirectionIcon direction="hazel_to_external" className="size-4" />,
	},
	external_to_hazel: {
		label: "Discord to Hazel",
		icon: <DirectionIcon direction="external_to_hazel" className="size-4" />,
	},
}

const FEATURES = [
	"Bidirectional message sync",
	"Thread and reply support",
	"Real-time message delivery",
	"Per-channel direction control",
	"Automatic deduplication",
	"Edit and delete sync",
]

function ChatSyncConnectionDetailPage() {
	const { orgSlug, connectionId } = Route.useParams()
	const navigate = useNavigate()
	const { organizationId } = useOrganization()
	const [isAddLinkModalOpen, setIsAddLinkModalOpen] = useState(false)
	const [deleteTarget, setDeleteTarget] = useState<{
		id: SyncChannelLinkId
		name: string
	} | null>(null)
	const [isDeletingLink, setIsDeletingLink] = useState(false)
	const [isDisconnecting, setIsDisconnecting] = useState(false)
	const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false)
	const [refreshKey, setRefreshKey] = useState(0)

	// Fetch all connections and find the current one
	const connectionsResult = useAtomValue(
		HazelRpcClient.query("chatSync.connection.list", { organizationId: organizationId! }),
	)

	// Fetch channel links for this connection
	const channelLinksResult = useAtomValue(
		HazelRpcClient.query(
			"chatSync.channelLink.list",
			{ syncConnectionId: connectionId as SyncConnectionId },
			{ reactivityKeys: [`chatSyncLinks:${connectionId}:${refreshKey}`] },
		),
	)

	const deleteConnection = useAtomSet(HazelRpcClient.mutation("chatSync.connection.delete"), {
		mode: "promiseExit",
	})

	const deleteChannelLink = useAtomSet(HazelRpcClient.mutation("chatSync.channelLink.delete"), {
		mode: "promiseExit",
	})

	const updateChannelLink = useAtomSet(HazelRpcClient.mutation("chatSync.channelLink.update"), {
		mode: "promiseExit",
	})

	// Find the current connection from the list
	const connection = useMemo(() => {
		if (!AsyncResult.isSuccess(connectionsResult)) return null
		const data = AsyncResult.value(connectionsResult)
		if (Option.isNone(data)) return null
		return data.value.data.find((c) => c.id === connectionId) ?? null
	}, [connectionsResult, connectionId])

	// Get channel links
	const channelLinks = useMemo(() => {
		if (!AsyncResult.isSuccess(channelLinksResult)) return []
		const data = AsyncResult.value(channelLinksResult)
		if (Option.isNone(data)) return []
		return data.value.data
	}, [channelLinksResult])

	const handleBack = () => {
		navigate({ to: "/$orgSlug/settings/chat-sync", params: { orgSlug } })
	}

	const handleDisconnect = async () => {
		setIsDisconnecting(true)
		const exit = await deleteConnection({
			payload: { syncConnectionId: connectionId as SyncConnectionId },
		})

		exitToast(exit)
			.onSuccess(() => {
				navigate({ to: "/$orgSlug/settings/chat-sync", params: { orgSlug } })
			})
			.successMessage("Connection deleted")
			.onErrorTag("ChatSyncConnectionNotFoundError", () => ({
				title: "Connection not found",
				description: "This connection may have already been deleted.",
				isRetryable: false,
			}))
			.run()

		setIsDisconnecting(false)
		setShowDisconnectConfirm(false)
	}

	const handleDeleteLink = async () => {
		if (!deleteTarget) return
		setIsDeletingLink(true)

		const exit = await deleteChannelLink({
			payload: { syncChannelLinkId: deleteTarget.id },
			reactivityKeys: [`chatSyncLinks:${connectionId}:${refreshKey}`],
		})

		exitToast(exit)
			.onSuccess(() => {
				setDeleteTarget(null)
				setRefreshKey((k) => k + 1)
			})
			.successMessage("Channel link removed")
			.onErrorTag("ChatSyncChannelLinkNotFoundError", () => ({
				title: "Link not found",
				description: "This channel link may have already been removed.",
				isRetryable: false,
			}))
			.run()

		setIsDeletingLink(false)
	}

	const handleToggleLinkActive = async (linkId: SyncChannelLinkId, currentlyActive: boolean) => {
		const exit = await updateChannelLink({
			payload: { syncChannelLinkId: linkId, isActive: !currentlyActive },
			reactivityKeys: [`chatSyncLinks:${connectionId}:${refreshKey}`],
		})

		exitToast(exit)
			.onSuccess(() => {
				setRefreshKey((k) => k + 1)
			})
			.successMessage(currentlyActive ? "Channel link paused" : "Channel link resumed")
			.onErrorTag("ChatSyncChannelLinkNotFoundError", () => ({
				title: "Link not found",
				description: "This channel link may have already been removed.",
				isRetryable: false,
			}))
			.run()
	}

	const handleChangeDirection = async (linkId: SyncChannelLinkId, newDirection: SyncDirection) => {
		const exit = await updateChannelLink({
			payload: { syncChannelLinkId: linkId, direction: newDirection },
			reactivityKeys: [`chatSyncLinks:${connectionId}:${refreshKey}`],
		})

		exitToast(exit)
			.onSuccess(() => {
				setRefreshKey((k) => k + 1)
			})
			.successMessage(`Sync direction updated to ${DIRECTION_DISPLAY[newDirection].label}`)
			.onErrorTag("ChatSyncChannelLinkNotFoundError", () => ({
				title: "Link not found",
				description: "This channel link may have already been removed.",
				isRetryable: false,
			}))
			.run()
	}

	// Loading state
	if (AsyncResult.isInitial(connectionsResult)) {
		return (
			<div className="flex items-center justify-center py-24">
				<div className="flex items-center gap-3 text-muted-fg">
					<div className="size-6 animate-spin rounded-full border-2 border-border border-t-primary" />
					<span className="text-sm">Loading connection...</span>
				</div>
			</div>
		)
	}

	// Connection not found
	if (!connection) {
		return (
			<div className="flex flex-col gap-6">
				<button
					type="button"
					onClick={handleBack}
					className="-ml-1 flex w-fit items-center gap-1 text-muted-fg text-sm transition-colors hover:text-fg"
				>
					<svg
						className="size-4"
						fill="none"
						viewBox="0 0 24 24"
						stroke="currentColor"
						strokeWidth={2}
					>
						<path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
					</svg>
					<span>Back to Chat Sync</span>
				</button>
				<EmptyState
					title="Connection not found"
					description="This sync connection may have been deleted."
					action={
						<Button intent="secondary" onPress={handleBack}>
							Go back
						</Button>
					}
				/>
			</div>
		)
	}

	const status = (connection.status as ConnectionStatus) || "active"
	const statusConfig = STATUS_CONFIG[status]
	const displayName = connection.externalWorkspaceName || "Discord Server"

	return (
		<div className="flex flex-col gap-6">
			{/* Back link */}
			<button
				type="button"
				onClick={handleBack}
				className="-ml-1 flex w-fit items-center gap-1 text-muted-fg text-sm transition-colors hover:text-fg"
			>
				<svg className="size-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
					<path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
				</svg>
				<span>Back to Chat Sync</span>
			</button>

			{/* Header */}
			<SectionHeader.Root className="border-none pb-0">
				<SectionHeader.Group>
					<div className="flex items-center gap-4">
						<div
							className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl shadow-md ring-1 ring-black/8"
							style={{ backgroundColor: `${DISCORD_BRAND_COLOR}10` }}
						>
							<svg viewBox="0 0 24 24" className="size-10" fill={DISCORD_BRAND_COLOR}>
								<path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
							</svg>
						</div>
						<div className="flex flex-col gap-1">
							<div className="flex items-center gap-3">
								<SectionHeader.Heading>{displayName}</SectionHeader.Heading>
								<span
									className={`inline-flex items-center gap-1.5 rounded-sm px-2.5 py-0.5 font-medium text-xs ${statusConfig.badgeClass}`}
								>
									<span
										className={`size-1.5 rounded-full ${
											status === "active"
												? "bg-success"
												: status === "paused"
													? "bg-warning"
													: status === "error"
														? "bg-danger"
														: "bg-muted-fg"
										}`}
									/>
									{statusConfig.label}
								</span>
							</div>
							<SectionHeader.Subheading>
								Guild ID: {connection.externalWorkspaceId}
							</SectionHeader.Subheading>
						</div>
					</div>
				</SectionHeader.Group>
			</SectionHeader.Root>

			{/* Main content */}
			<div className="grid gap-8 lg:grid-cols-[1fr_320px]">
				{/* Left column */}
				<div className="flex flex-col gap-8">
					{/* Connection Status Card */}
					<div className="overflow-hidden rounded-xl border border-border bg-bg">
						<div className="border-border border-b bg-bg-muted/30 px-5 py-3">
							<h3 className="font-semibold text-fg text-sm">Connection</h3>
						</div>
						<div className="p-5">
							{status === "error" ? (
								<div className="flex items-start gap-3">
									<div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-danger-subtle">
										<svg
											className="size-5 text-danger-subtle-fg"
											fill="none"
											viewBox="0 0 24 24"
											stroke="currentColor"
											strokeWidth={2}
										>
											<path
												strokeLinecap="round"
												strokeLinejoin="round"
												d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z"
											/>
										</svg>
									</div>
									<div className="flex flex-1 flex-col gap-1">
										<p className="font-medium text-fg text-sm">Connection Error</p>
										<p className="text-muted-fg text-sm">
											{connection.errorMessage ||
												"An unknown error occurred with this connection."}
										</p>
									</div>
									<Button
										intent="danger"
										size="sm"
										onPress={() => setShowDisconnectConfirm(true)}
									>
										Remove
									</Button>
								</div>
							) : (
								<div className="flex items-center justify-between gap-4">
									<div className="flex items-center gap-3">
										<div className="flex size-10 items-center justify-center rounded-xl bg-success-subtle">
											<svg
												className="size-5 text-success-subtle-fg"
												fill="none"
												viewBox="0 0 24 24"
												stroke="currentColor"
												strokeWidth={2}
											>
												<path
													strokeLinecap="round"
													strokeLinejoin="round"
													d="M5 13l4 4L19 7"
												/>
											</svg>
										</div>
										<div className="flex flex-col gap-0.5">
											<p className="font-medium text-fg text-sm">
												Connected to Discord
											</p>
											<p className="text-muted-fg text-xs">
												{connection.lastSyncedAt
													? `Last synced ${toDate(
															connection.lastSyncedAt,
														).toLocaleDateString(undefined, {
															month: "short",
															day: "numeric",
															hour: "numeric",
															minute: "2-digit",
														})}`
													: "Waiting for first sync"}
											</p>
										</div>
									</div>
									<Button
										intent="danger"
										size="sm"
										onPress={() => setShowDisconnectConfirm(true)}
									>
										Disconnect
									</Button>
								</div>
							)}
						</div>
					</div>

					{/* Channel Links Card */}
					<div className="overflow-hidden rounded-xl border border-border bg-bg">
						<div className="flex items-center justify-between border-border border-b bg-bg-muted/30 px-5 py-3">
							<div className="flex items-center gap-2">
								<h3 className="font-semibold text-fg text-sm">Channel Links</h3>
								{channelLinks.length > 0 && (
									<span className="rounded-sm bg-secondary px-2 py-0.5 text-muted-fg text-xs">
										{channelLinks.length}
									</span>
								)}
							</div>
							<Button intent="secondary" size="sm" onPress={() => setIsAddLinkModalOpen(true)}>
								<IconPlus data-slot="icon" />
								Link Channel
							</Button>
						</div>

						{AsyncResult.isInitial(channelLinksResult) ? (
							<div className="flex items-center justify-center p-8">
								<div className="flex items-center gap-3 text-muted-fg">
									<div className="size-5 animate-spin rounded-full border-2 border-border border-t-primary" />
									<span className="text-sm">Loading channel links...</span>
								</div>
							</div>
						) : channelLinks.length === 0 ? (
							<div className="flex flex-col items-center justify-center px-5 py-12 text-center">
								<div className="mb-4 flex size-12 items-center justify-center rounded-xl bg-bg-muted">
									<svg
										className="size-6 text-muted-fg"
										fill="none"
										viewBox="0 0 24 24"
										stroke="currentColor"
										strokeWidth={1.5}
									>
										<path
											strokeLinecap="round"
											strokeLinejoin="round"
											d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244"
										/>
									</svg>
								</div>
								<p className="mb-1 font-medium text-fg text-sm">No channels linked</p>
								<p className="mb-4 text-muted-fg text-sm">
									Link a Hazel channel to a Discord channel to start syncing messages.
								</p>
								<Button
									intent="primary"
									size="sm"
									onPress={() => setIsAddLinkModalOpen(true)}
								>
									<IconPlus data-slot="icon" />
									Link Channel
								</Button>
							</div>
						) : (
							<div className="divide-y divide-border">
								{channelLinks.map((link) => (
									<ChannelLinkRow
										key={link.id}
										link={link}
										onDelete={() =>
											setDeleteTarget({
												id: link.id as SyncChannelLinkId,
												name: link.externalChannelName || link.externalChannelId,
											})
										}
										onToggleActive={() =>
											handleToggleLinkActive(
												link.id as SyncChannelLinkId,
												link.isActive,
											)
										}
										onChangeDirection={(dir) =>
											handleChangeDirection(link.id as SyncChannelLinkId, dir)
										}
									/>
								))}
							</div>
						)}
					</div>
				</div>

				{/* Right column */}
				<div className="lg:sticky lg:top-6 lg:self-start">
					<div className="overflow-hidden rounded-xl border border-border bg-bg">
						<div className="border-border border-b bg-bg-muted/30 px-5 py-3">
							<h3 className="font-semibold text-fg text-sm">About Chat Sync</h3>
						</div>
						<div className="p-5">
							<p className="mb-4 text-muted-fg text-sm leading-relaxed">
								Chat Sync keeps messages in sync between Hazel and Discord. Messages sent in
								either platform are automatically mirrored to the linked channel, including
								edits and deletions.
							</p>
							<ul className="flex flex-col gap-2.5">
								{FEATURES.map((feature) => (
									<li key={feature} className="flex items-center gap-2.5 text-sm">
										<div className="flex size-5 shrink-0 items-center justify-center rounded-sm bg-success-subtle">
											<svg
												className="size-3 text-success-subtle-fg"
												fill="none"
												viewBox="0 0 24 24"
												stroke="currentColor"
												strokeWidth={3}
											>
												<path
													strokeLinecap="round"
													strokeLinejoin="round"
													d="M5 13l4 4L19 7"
												/>
											</svg>
										</div>
										<span className="text-fg">{feature}</span>
									</li>
								))}
							</ul>
						</div>
					</div>
				</div>
			</div>

			{/* Add Channel Link Modal */}
			<AddChannelLinkModal
				syncConnectionId={connectionId as SyncConnectionId}
				organizationId={organizationId!}
				externalWorkspaceId={connection.externalWorkspaceId}
				isOpen={isAddLinkModalOpen}
				onClose={() => setIsAddLinkModalOpen(false)}
				onSuccess={() => setRefreshKey((k) => k + 1)}
			/>

			{/* Delete channel link confirmation */}
			<Modal>
				<ModalContent
					isOpen={!!deleteTarget}
					onOpenChange={(open) => !open && setDeleteTarget(null)}
					size="md"
				>
					<Dialog>
						<DialogHeader>
							<div className="flex size-12 items-center justify-center rounded-lg border border-danger/10 bg-danger/5">
								<svg
									className="size-6 text-danger"
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
									strokeWidth={1.5}
								>
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
									/>
								</svg>
							</div>
							<DialogTitle>Remove Channel Link</DialogTitle>
							<DialogDescription>
								Are you sure you want to remove the link to{" "}
								<span className="font-medium text-fg">{deleteTarget?.name}</span>? Messages
								will stop syncing between these channels.
							</DialogDescription>
						</DialogHeader>
						<DialogFooter>
							<DialogClose intent="secondary">Cancel</DialogClose>
							<Button
								intent="danger"
								onPress={handleDeleteLink}
								isDisabled={isDeletingLink}
								isPending={isDeletingLink}
							>
								{isDeletingLink ? "Removing..." : "Remove Link"}
							</Button>
						</DialogFooter>
					</Dialog>
				</ModalContent>
			</Modal>

			{/* Disconnect confirmation */}
			<Modal>
				<ModalContent
					isOpen={showDisconnectConfirm}
					onOpenChange={(open) => !open && setShowDisconnectConfirm(false)}
					size="md"
				>
					<Dialog>
						<DialogHeader>
							<div className="flex size-12 items-center justify-center rounded-lg border border-danger/10 bg-danger/5">
								<svg
									className="size-6 text-danger"
									fill="none"
									viewBox="0 0 24 24"
									stroke="currentColor"
									strokeWidth={1.5}
								>
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
									/>
								</svg>
							</div>
							<DialogTitle>Disconnect from Discord</DialogTitle>
							<DialogDescription>
								Are you sure you want to disconnect{" "}
								<span className="font-medium text-fg">{displayName}</span>? All channel links
								will be removed and messages will stop syncing. This action cannot be undone.
							</DialogDescription>
						</DialogHeader>
						<DialogFooter>
							<DialogClose intent="secondary">Cancel</DialogClose>
							<Button
								intent="danger"
								onPress={handleDisconnect}
								isDisabled={isDisconnecting}
								isPending={isDisconnecting}
							>
								{isDisconnecting ? "Disconnecting..." : "Disconnect"}
							</Button>
						</DialogFooter>
					</Dialog>
				</ModalContent>
			</Modal>
		</div>
	)
}

/**
 * Individual channel link row in the channel links list
 */
function ChannelLinkRow({
	link,
	onDelete,
	onToggleActive,
	onChangeDirection,
}: {
	link: {
		id: string
		hazelChannelId: string
		externalChannelId: string
		externalChannelName: string | null
		direction: string
		isActive: boolean
		settings: Record<string, unknown> | null
	}
	onDelete: () => void
	onToggleActive: () => void
	onChangeDirection: (direction: SyncDirection) => void
}) {
	const direction = (link.direction as SyncDirection) || "both"
	const directionDisplay = DIRECTION_DISPLAY[direction]
	const webhookPermissionStatus = getWebhookPermissionFromSettings(link.settings)
	const webhookPermissionLabel = WEBHOOK_PERMISSION_LABELS[webhookPermissionStatus]

	// Look up the Hazel channel name
	const { data: channelData } = useLiveQuery({
		query: (q) =>
			q
				.from({ channel: channelCollection })
				.where(({ channel }) => eq(channel.id, link.hazelChannelId))
				.select(({ channel }) => ({ ...channel })),
		queryKey: [link.hazelChannelId],
	})
	const hazelChannel = channelData?.[0]

	return (
		<div className="flex items-center gap-4 px-5 py-3">
			{/* Hazel channel */}
			<div className="flex min-w-0 flex-1 items-center gap-2">
				<IconHashtag className="size-4 shrink-0 text-muted-fg" />
				<span className="truncate font-medium text-fg text-sm">
					{hazelChannel?.name || "Unknown channel"}
				</span>
			</div>

			{/* Direction indicator */}
			<div
				className="flex shrink-0 items-center gap-1.5 rounded-sm bg-bg-muted/50 px-2.5 py-1 text-muted-fg"
				title={directionDisplay.label}
			>
				{directionDisplay.icon}
				<span className="text-xs">{directionDisplay.label}</span>
			</div>

			{/* Discord channel */}
			<div className="flex min-w-0 flex-1 items-center gap-2">
				<svg viewBox="0 0 24 24" className="size-4 shrink-0" fill={DISCORD_BRAND_COLOR}>
					<path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
				</svg>
				<span className="truncate text-fg text-sm">
					{link.externalChannelName || link.externalChannelId}
				</span>
			</div>

			{/* Status + Actions */}
			<div className="flex shrink-0 items-center gap-2">
				<span
					className={`inline-flex rounded-sm px-2 py-0.5 text-xs ${webhookPermissionLabel.badgeClass}`}
				>
					{webhookPermissionLabel.label}
				</span>
				<span
					className={`inline-flex rounded-sm px-2 py-0.5 text-xs ${
						link.isActive
							? "bg-success-subtle font-medium text-success-subtle-fg"
							: "bg-muted text-muted-fg"
					}`}
				>
					{link.isActive ? "Active" : "Paused"}
				</span>

				<Menu>
					<MenuTrigger
						aria-label="Channel link actions"
						className="inline-flex size-7 items-center justify-center rounded-lg text-muted-fg hover:bg-secondary hover:text-fg"
					>
						<IconDotsVertical className="size-4" />
					</MenuTrigger>
					<MenuContent placement="bottom end">
						<MenuSubMenu>
							<MenuItem>
								<DirectionIcon direction={direction} className="size-4" data-slot="icon" />
								<MenuLabel>Change direction</MenuLabel>
							</MenuItem>
							<MenuContent>
								{(["both", "hazel_to_external", "external_to_hazel"] as const).map((dir) => (
									<MenuItem key={dir} onAction={() => onChangeDirection(dir)}>
										<DirectionIcon direction={dir} className="size-4" data-slot="icon" />
										<MenuLabel>{DIRECTION_DISPLAY[dir].label}</MenuLabel>
									</MenuItem>
								))}
							</MenuContent>
						</MenuSubMenu>
						<MenuItem onAction={onToggleActive}>
							{link.isActive ? (
								<IconCirclePause className="size-4" />
							) : (
								<IconPlay className="size-4" />
							)}
							<MenuLabel>{link.isActive ? "Pause sync" : "Resume sync"}</MenuLabel>
						</MenuItem>
						<MenuSeparator />
						<MenuItem intent="danger" onAction={onDelete}>
							<IconTrash className="size-4" />
							<MenuLabel>Remove link</MenuLabel>
						</MenuItem>
					</MenuContent>
				</Menu>
			</div>
		</div>
	)
}
