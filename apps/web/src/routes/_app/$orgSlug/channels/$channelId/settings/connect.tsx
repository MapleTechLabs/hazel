import { AsyncResult } from "effect/reactivity"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import type { ChannelId, ConnectConversationId, ConnectInviteId, OrganizationId } from "@hazel/schema"
import { eq, useLiveQuery } from "@tanstack/react-db"
import { type DateTime, Option } from "effect"
import { createFileRoute } from "@tanstack/react-router"
import { useMemo, useState } from "react"
import {
	disconnectConnectOrgMutation,
	listOutgoingInvitesQuery,
	revokeConnectInviteMutation,
} from "~/atoms/connect-share-atoms"
import { ShareChannelModal } from "~/components/connect/share-channel-modal"
import { IconConnect } from "~/components/icons/icon-connect"
import IconPlus from "~/components/icons/icon-plus"
import { Avatar } from "~/components/ui/avatar"
import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import { EmptyState } from "~/components/ui/empty-state"
import { SectionHeader } from "~/components/ui/section-header"
import {
	channelCollection,
	connectConversationChannelCollection,
	organizationCollection,
} from "~/db/collections"
import { useOrganization } from "~/hooks/use-organization"
import {
	getConnectInviteStatusBadge,
	getSharedConversationMountsForChannel,
} from "~/lib/connect-shared-channels"
import { toDate } from "~/lib/utils"
import { exitToastAsync } from "~/lib/toast-exit"

export const Route = createFileRoute("/_app/$orgSlug/channels/$channelId/settings/connect")({
	component: ConnectPage,
})

function ConnectPage() {
	const { channelId } = Route.useParams()
	const { organizationId } = useOrganization()
	const [showShareModal, setShowShareModal] = useState(false)

	const { data: channel } = useLiveQuery(
		(q) =>
			q
				.from({ channel: channelCollection })
				.where(({ channel }) => eq(channel.id, channelId as ChannelId))
				.findOne()
				.select(({ channel }) => ({ name: channel.name })),
		[channelId],
	)

	// Check if channel is actually shared (more than one active mount)
	const { data: connections } = useLiveQuery(
		(q) =>
			q
				.from({ ccc: connectConversationChannelCollection })
				.where(({ ccc }) => eq(ccc.isActive, true))
				.select(({ ccc }) => ({ ...ccc })),
		[],
	)

	// Get outgoing invites for this channel (RPC returns all org invites, filter by channelId)
	const outgoingResult = useAtomValue(listOutgoingInvitesQuery(organizationId!))
	const outgoingInvites = useMemo(() => {
		if (!AsyncResult.isSuccess(outgoingResult)) return []
		const data = AsyncResult.value(outgoingResult)
		if (Option.isNone(data)) return []
		return data.value.data.filter((inv) => inv.hostChannelId === channelId)
	}, [outgoingResult, channelId])

	type SharedConnection = NonNullable<typeof connections>[number]
	const sharedConnections: SharedConnection[] = getSharedConversationMountsForChannel(
		channelId as ChannelId,
		connections ?? [],
	)
	const isConnected = sharedConnections.length > 0
	const viewerMount = sharedConnections.find((connection) => connection.organizationId === organizationId)

	return (
		<>
			<div className="flex flex-col gap-6 px-4 lg:px-8">
				<SectionHeader.Root className="border-none pb-0">
					<SectionHeader.Group>
						<div className="flex flex-1 flex-col justify-center gap-1">
							<SectionHeader.Heading>Hazel Connect</SectionHeader.Heading>
							<SectionHeader.Subheading>
								Share this channel with another organization to collaborate together.
							</SectionHeader.Subheading>
						</div>
						<SectionHeader.Actions>
							<Button intent="secondary" size="md" onPress={() => setShowShareModal(true)}>
								<IconPlus data-slot="icon" />
								Share channel
							</Button>
						</SectionHeader.Actions>
					</SectionHeader.Group>
				</SectionHeader.Root>

				{/* Active connections */}
				{isConnected && (
					<div className="overflow-hidden rounded-xl border border-border bg-bg shadow-sm">
						<div className="border-border border-b bg-bg px-4 py-4 md:px-6">
							<div className="flex items-center gap-2">
								<h3 className="font-semibold text-fg text-sm">Active connections</h3>
								<Badge intent="success" size="sm">
									{
										sharedConnections.filter((c) => c.organizationId !== organizationId)
											.length
									}
								</Badge>
							</div>
						</div>
						<div className="divide-y divide-border">
							{sharedConnections.map((conn) => (
								<ConnectionRow
									key={conn.id}
									conversationId={conn.conversationId}
									organizationId={conn.organizationId}
									role={conn.role}
									viewerRole={viewerMount?.role}
									currentOrgId={organizationId}
								/>
							))}
						</div>
					</div>
				)}

				{/* Outgoing invites */}
				{outgoingInvites && outgoingInvites.length > 0 ? (
					<div className="overflow-hidden rounded-xl border border-border bg-bg shadow-sm">
						<div className="border-border border-b bg-bg px-4 py-4 md:px-6">
							<h3 className="font-semibold text-fg text-sm">Invitations</h3>
						</div>
						<div className="overflow-x-auto">
							<table className="w-full min-w-full">
								<thead className="border-border border-b bg-bg">
									<tr>
										<th className="px-4 py-3 text-left font-medium text-muted-fg text-xs">
											Target
										</th>
										<th className="px-4 py-3 text-left font-medium text-muted-fg text-xs">
											Status
										</th>
										<th className="px-4 py-3 text-left font-medium text-muted-fg text-xs">
											Sent
										</th>
										<th className="px-4 py-3 text-right font-medium text-muted-fg text-xs">
											Actions
										</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-border">
									{outgoingInvites.map((invite) => (
										<InviteRow
											key={invite.id}
											invite={invite}
											organizationId={organizationId}
										/>
									))}
								</tbody>
							</table>
						</div>
					</div>
				) : (
					!isConnected && (
						<EmptyState
							icon={IconConnect}
							title="Not shared yet"
							description="Share this channel with another organization to start collaborating across teams."
							action={
								<Button intent="secondary" size="sm" onPress={() => setShowShareModal(true)}>
									<IconPlus data-slot="icon" />
									Share this channel
								</Button>
							}
						/>
					)
				)}
			</div>

			{channel && (
				<ShareChannelModal
					isOpen={showShareModal}
					onOpenChange={setShowShareModal}
					channelId={channelId as ChannelId}
					channelName={channel.name}
					organizationId={organizationId!}
				/>
			)}
		</>
	)
}

function ConnectionRow({
	conversationId,
	organizationId,
	role,
	viewerRole,
	currentOrgId,
}: {
	conversationId: string
	organizationId: string
	role: "host" | "guest"
	viewerRole: "host" | "guest" | undefined
	currentOrgId: OrganizationId | undefined
}) {
	const [isDisconnecting, setIsDisconnecting] = useState(false)
	const disconnect = useAtomSet(disconnectConnectOrgMutation, { mode: "promiseExit" })

	// Try to resolve org name from local collection
	const { data: org } = useLiveQuery(
		(q) =>
			q
				.from({ org: organizationCollection })
				.where(({ org }) => eq(org.id, organizationId as OrganizationId))
				.findOne()
				.select(({ org }) => ({ name: org.name, slug: org.slug, logoUrl: org.logoUrl })),
		[organizationId],
	)

	const isOwnOrg = organizationId === currentOrgId
	const isGuestLeavingConversation = viewerRole === "guest" && role === "host"
	const disconnectTargetOrganizationId =
		(isGuestLeavingConversation ? currentOrgId : (organizationId as OrganizationId)) ?? null
	const canDisconnect = viewerRole === "host" || isGuestLeavingConversation

	const handleDisconnect = async () => {
		if (!disconnectTargetOrganizationId) return
		setIsDisconnecting(true)
		try {
			await exitToastAsync(
				disconnect({
					payload: {
						conversationId: conversationId as ConnectConversationId,
						organizationId: disconnectTargetOrganizationId,
					},
				}),
			)
				.loading(isGuestLeavingConversation ? "Leaving shared channel..." : "Disconnecting...")
				.successMessage(
					isGuestLeavingConversation ? "Left shared channel" : "Organization disconnected",
				)
				.run()
		} finally {
			setIsDisconnecting(false)
		}
	}

	if (isOwnOrg) return null

	return (
		<div className="flex items-center justify-between px-4 py-3 md:px-6">
			<div className="flex items-center gap-3">
				<Avatar size="sm" isSquare src={org?.logoUrl} seed={org?.name ?? organizationId} />
				<div className="flex flex-col">
					<span className="font-medium text-fg text-sm">{org?.name ?? organizationId}</span>
					{org?.slug && <span className="text-muted-fg text-xs">{org.slug}</span>}
				</div>
			</div>
			{canDisconnect ? (
				<Button intent="outline" size="sm" onPress={handleDisconnect} isDisabled={isDisconnecting}>
					{isDisconnecting
						? isGuestLeavingConversation
							? "Leaving..."
							: "Disconnecting..."
						: isGuestLeavingConversation
							? "Leave shared channel"
							: "Disconnect"}
				</Button>
			) : (
				<span className="text-muted-fg text-xs">Managed by host workspace</span>
			)}
		</div>
	)
}

function InviteRow({
	invite,
	organizationId,
}: {
	invite: {
		id: string
		targetKind: string
		targetValue: string
		status: string
		createdAt: Date | DateTime.Utc
	}
	organizationId: OrganizationId | undefined
}) {
	const [isRevoking, setIsRevoking] = useState(false)
	const revokeInvite = useAtomSet(revokeConnectInviteMutation, { mode: "promiseExit" })

	const statusBadge = getConnectInviteStatusBadge(invite.status)

	const handleRevoke = async () => {
		setIsRevoking(true)
		try {
			await exitToastAsync(
				revokeInvite({
					payload: { inviteId: invite.id as ConnectInviteId },
					reactivityKeys: [`connectInvites:outgoing:${organizationId}`],
				}),
			)
				.loading("Revoking invite...")
				.successMessage("Invite revoked")
				.onErrorTag("ConnectInviteNotFoundError", () => ({
					title: "Invite not found",
					description: "This invite may have already been revoked or expired.",
					isRetryable: false,
				}))
				.onErrorTag("ConnectInviteInvalidStateError", () => ({
					title: "Cannot revoke",
					description: "This invite is no longer in a revokable state.",
					isRetryable: false,
				}))
				.run()
		} finally {
			setIsRevoking(false)
		}
	}

	return (
		<tr className="hover:bg-secondary/50">
			<td className="px-4 py-4">
				<div className="flex flex-col">
					<span className="font-medium text-fg text-sm">{invite.targetValue}</span>
					<span className="text-muted-fg text-xs">Workspace</span>
				</div>
			</td>
			<td className="px-4 py-4">
				<Badge intent={statusBadge.intent} size="sm">
					{statusBadge.label}
				</Badge>
			</td>
			<td className="px-4 py-4">
				<span className="text-muted-fg text-sm">{toDate(invite.createdAt).toLocaleDateString()}</span>
			</td>
			<td className="px-4 py-4 text-right">
				{invite.status === "pending" && (
					<Button intent="outline" size="sm" onPress={handleRevoke} isDisabled={isRevoking}>
						{isRevoking ? "Revoking..." : "Revoke"}
					</Button>
				)}
			</td>
		</tr>
	)
}
