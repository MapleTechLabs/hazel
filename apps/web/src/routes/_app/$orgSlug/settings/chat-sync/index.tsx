import { AsyncResult } from "effect/reactivity"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import type { SyncConnectionId } from "@hazel/schema"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { Option } from "effect"
import { toDate } from "~/lib/utils"
import { useState } from "react"
import { AddConnectionModal } from "~/components/chat-sync/add-connection-modal"
import IconArrowPath from "~/components/icons/icon-arrow-path"
import { IconChevronDown } from "~/components/icons/icon-chevron-down"
import IconPlus from "~/components/icons/icon-plus"
import IconTrash from "~/components/icons/icon-trash"
import { IconWarning } from "~/components/icons/icon-warning"
import { Badge } from "~/components/ui/badge"
import { Button, buttonStyles } from "~/components/ui/button"
import {
	Dialog,
	DialogClose,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "~/components/ui/dialog"
import { EmptyState } from "~/components/ui/empty-state"
import { Loader } from "~/components/ui/loader"
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "~/components/ui/menu"
import { Modal, ModalContent } from "~/components/ui/modal"
import { SectionHeader } from "~/components/ui/section-header"
import { useOrganization } from "~/hooks/use-organization"
import { HazelRpcClient } from "~/lib/services/common/rpc-atom-client"
import { exitToast } from "~/lib/toast-exit"

export const Route = createFileRoute("/_app/$orgSlug/settings/chat-sync/")({
	component: ChatSyncConnectionsPage,
})

const DISCORD_BRAND_COLOR = "#5865F2"
const SLACK_BRAND_COLOR = "#4A154B"

type ConnectionStatus = "active" | "paused" | "error" | "disabled"

const STATUS_CONFIG: Record<ConnectionStatus, { label: string; dotClass: string; textClass: string }> = {
	active: { label: "Active", dotClass: "bg-success", textClass: "text-success" },
	paused: { label: "Paused", dotClass: "bg-warning", textClass: "text-warning" },
	error: { label: "Error", dotClass: "bg-danger", textClass: "text-danger" },
	disabled: { label: "Disabled", dotClass: "bg-secondary", textClass: "text-muted-fg" },
}

function AddConnectionDropdown({ onSelectDiscord }: { onSelectDiscord: () => void }) {
	return (
		<Menu>
			<MenuTrigger className={buttonStyles({ intent: "primary", size: "md" })}>
				<IconPlus className="size-4" />
				Add Third Party Connection
				<IconChevronDown className="size-3.5 opacity-70" />
			</MenuTrigger>
			<MenuContent placement="bottom end" className="min-w-56">
				<MenuItem onAction={onSelectDiscord} className="gap-3">
					<svg viewBox="0 0 24 24" className="size-5 shrink-0" fill={DISCORD_BRAND_COLOR}>
						<path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
					</svg>
					Discord
				</MenuItem>
				<MenuSeparator />
				<MenuItem isDisabled className="gap-3">
					<svg viewBox="0 0 127 127" className="size-5 shrink-0">
						<path
							d="M27.2 80c0 7.3-5.9 13.2-13.2 13.2C6.7 93.2.8 87.3.8 80c0-7.3 5.9-13.2 13.2-13.2h13.2V80zm6.6 0c0-7.3 5.9-13.2 13.2-13.2 7.3 0 13.2 5.9 13.2 13.2v33c0 7.3-5.9 13.2-13.2 13.2-7.3 0-13.2-5.9-13.2-13.2V80z"
							fill="#E01E5A"
						/>
						<path
							d="M47 27c-7.3 0-13.2-5.9-13.2-13.2C33.8 6.5 39.7.6 47 .6c7.3 0 13.2 5.9 13.2 13.2V27H47zm0 6.7c7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2H13.9C6.6 60.1.7 54.2.7 46.9c0-7.3 5.9-13.2 13.2-13.2H47z"
							fill="#36C5F0"
						/>
						<path
							d="M99.9 46.9c0-7.3 5.9-13.2 13.2-13.2 7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2H99.9V46.9zm-6.6 0c0 7.3-5.9 13.2-13.2 13.2-7.3 0-13.2-5.9-13.2-13.2V13.8C66.9 6.5 72.8.6 80.1.6c7.3 0 13.2 5.9 13.2 13.2v33.1z"
							fill="#2EB67D"
						/>
						<path
							d="M80.1 99.8c7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2-7.3 0-13.2-5.9-13.2-13.2V99.8h13.2zm0-6.6c-7.3 0-13.2-5.9-13.2-13.2 0-7.3 5.9-13.2 13.2-13.2h33.1c7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2H80.1z"
							fill="#ECB22E"
						/>
					</svg>
					<span className="flex items-center gap-2">
						Slack
						<Badge intent="secondary" size="sm">
							Coming Soon
						</Badge>
					</span>
				</MenuItem>
			</MenuContent>
		</Menu>
	)
}

function ChatSyncConnectionsPage() {
	const { orgSlug } = Route.useParams()
	const navigate = useNavigate()
	const { organizationId } = useOrganization()
	const [isAddModalOpen, setIsAddModalOpen] = useState(false)
	const [deleteTarget, setDeleteTarget] = useState<{
		id: SyncConnectionId
		name: string
	} | null>(null)
	const [isDeleting, setIsDeleting] = useState(false)
	const [refreshKey, setRefreshKey] = useState(0)

	const connectionsResult = useAtomValue(
		HazelRpcClient.query(
			"chatSync.connection.list",
			{ organizationId: organizationId! },
			{ reactivityKeys: [`chatSyncConnections:${organizationId}:${refreshKey}`] },
		),
	)

	const deleteConnection = useAtomSet(HazelRpcClient.mutation("chatSync.connection.delete"), {
		mode: "promiseExit",
	})

	const handleDelete = async () => {
		if (!deleteTarget) return
		setIsDeleting(true)

		const exit = await deleteConnection({
			payload: { syncConnectionId: deleteTarget.id },
			reactivityKeys: [`chatSyncConnections:${organizationId}:${refreshKey}`],
		})

		exitToast(exit)
			.onSuccess(() => {
				setDeleteTarget(null)
				setRefreshKey((k) => k + 1)
			})
			.successMessage("Connection deleted")
			.onErrorTag("ChatSyncConnectionNotFoundError", () => ({
				title: "Connection not found",
				description: "This connection may have already been deleted.",
				isRetryable: false,
			}))
			.run()

		setIsDeleting(false)
	}

	// Loading state
	if (AsyncResult.isInitial(connectionsResult)) {
		return (
			<>
				<SectionHeader.Root className="border-none pb-0">
					<SectionHeader.Group>
						<div className="flex flex-1 flex-col justify-center gap-1">
							<SectionHeader.Heading>Chat Sync</SectionHeader.Heading>
							<SectionHeader.Subheading>
								Sync messages between Hazel and external platforms.
							</SectionHeader.Subheading>
						</div>
					</SectionHeader.Group>
				</SectionHeader.Root>
				<div className="flex items-center justify-center py-16">
					<div className="flex items-center gap-3 text-muted-fg">
						<Loader className="size-6" />
						<span className="text-sm">Loading connections...</span>
					</div>
				</div>
			</>
		)
	}

	// Error state
	if (AsyncResult.isFailure(connectionsResult)) {
		return (
			<>
				<SectionHeader.Root className="border-none pb-0">
					<SectionHeader.Group>
						<div className="flex flex-1 flex-col justify-center gap-1">
							<SectionHeader.Heading>Chat Sync</SectionHeader.Heading>
							<SectionHeader.Subheading>
								Sync messages between Hazel and external platforms.
							</SectionHeader.Subheading>
						</div>
					</SectionHeader.Group>
				</SectionHeader.Root>
				<EmptyState
					title="Failed to load connections"
					description="Something went wrong loading your sync connections. Please try refreshing."
				/>
			</>
		)
	}

	const data = AsyncResult.value(connectionsResult)
	const connections = Option.isSome(data) ? data.value.data : []

	return (
		<>
			<SectionHeader.Root className="border-none pb-0">
				<SectionHeader.Group>
					<div className="flex flex-1 flex-col justify-center gap-1">
						<SectionHeader.Heading>Chat Sync</SectionHeader.Heading>
						<SectionHeader.Subheading>
							Sync messages between Hazel and external platforms.
						</SectionHeader.Subheading>
					</div>
					<AddConnectionDropdown onSelectDiscord={() => setIsAddModalOpen(true)} />
				</SectionHeader.Group>
			</SectionHeader.Root>

			{connections.length === 0 ? (
				<EmptyState
					icon={IconArrowPath}
					title="No sync connections yet"
					description="Connect an external platform to start syncing messages with Hazel channels."
					action={<AddConnectionDropdown onSelectDiscord={() => setIsAddModalOpen(true)} />}
				/>
			) : (
				<div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
					{connections.map((connection) => {
						const status = (connection.status as ConnectionStatus) || "active"
						const statusConfig = STATUS_CONFIG[status]
						const displayName = connection.externalWorkspaceName || "Discord Server"

						return (
							<div
								key={connection.id}
								className="group relative flex flex-col overflow-hidden rounded-xl border border-border bg-bg transition-all duration-200 hover:border-border-hover hover:shadow-md"
							>
								<button
									type="button"
									onClick={() =>
										navigate({
											to: "/$orgSlug/settings/chat-sync/$connectionId",
											params: { orgSlug, connectionId: connection.id },
										})
									}
									className="flex flex-1 flex-col gap-4 p-5 text-left"
								>
									<div className="flex items-start justify-between gap-3">
										<div className="flex items-center gap-3">
											<div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-black/8">
												<svg
													viewBox="0 0 24 24"
													className="size-8"
													fill={DISCORD_BRAND_COLOR}
												>
													<path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
												</svg>
											</div>
											<div className="flex flex-col gap-0.5">
												<h3 className="font-semibold text-fg text-sm">
													{displayName}
												</h3>
												<div className="flex items-center gap-1.5">
													<div
														className={`size-1.5 rounded-full ${statusConfig.dotClass}`}
													/>
													<span className={`text-xs ${statusConfig.textClass}`}>
														{statusConfig.label}
													</span>
												</div>
											</div>
										</div>
									</div>
									<div className="flex flex-col gap-1 text-muted-fg text-xs">
										<span>Guild ID: {connection.externalWorkspaceId}</span>
										{connection.lastSyncedAt && (
											<span>
												Last synced:{" "}
												{toDate(connection.lastSyncedAt).toLocaleDateString(
													undefined,
													{
														month: "short",
														day: "numeric",
														hour: "numeric",
														minute: "2-digit",
													},
												)}
											</span>
										)}
									</div>
								</button>
								<div className="flex items-center justify-between border-border border-t bg-bg-muted/50 px-5 py-3">
									<span className="font-medium text-fg text-xs opacity-0 transition-opacity group-hover:opacity-100">
										Manage
									</span>
									<div className="flex items-center gap-2">
										<button
											type="button"
											onClick={(e) => {
												e.stopPropagation()
												setDeleteTarget({
													id: connection.id as SyncConnectionId,
													name: displayName,
												})
											}}
											className="rounded-sm p-1 text-muted-fg opacity-0 transition-all hover:bg-danger/10 hover:text-danger group-hover:opacity-100"
											title="Delete connection"
										>
											<IconTrash className="size-4" />
										</button>
										<svg
											className="size-4 text-muted-fg transition-transform group-hover:translate-x-0.5"
											fill="none"
											viewBox="0 0 24 24"
											stroke="currentColor"
											strokeWidth={2}
										>
											<path
												strokeLinecap="round"
												strokeLinejoin="round"
												d="M9 5l7 7-7 7"
											/>
										</svg>
									</div>
								</div>
							</div>
						)
					})}
				</div>
			)}

			<AddConnectionModal
				organizationId={organizationId!}
				orgSlug={orgSlug}
				isOpen={isAddModalOpen}
				onClose={() => setIsAddModalOpen(false)}
				onSuccess={() => setRefreshKey((k) => k + 1)}
			/>

			{/* Delete confirmation modal */}
			<Modal>
				<ModalContent
					isOpen={!!deleteTarget}
					onOpenChange={(open) => !open && setDeleteTarget(null)}
					size="md"
				>
					<Dialog>
						<DialogHeader>
							<div className="flex size-12 items-center justify-center rounded-lg border border-danger/10 bg-danger/5">
								<IconWarning className="size-6 text-danger" />
							</div>
							<DialogTitle>Delete Connection</DialogTitle>
							<DialogDescription>
								Are you sure you want to delete the connection to{" "}
								<span className="font-medium text-fg">{deleteTarget?.name}</span>? This will
								also remove all linked channels. This action cannot be undone.
							</DialogDescription>
						</DialogHeader>
						<DialogFooter>
							<DialogClose intent="secondary">Cancel</DialogClose>
							<Button
								intent="danger"
								onPress={handleDelete}
								isDisabled={isDeleting}
								isPending={isDeleting}
							>
								{isDeleting ? "Deleting..." : "Delete Connection"}
							</Button>
						</DialogFooter>
					</Dialog>
				</ModalContent>
			</Modal>
		</>
	)
}
