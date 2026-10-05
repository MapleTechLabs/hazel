import { AsyncResult } from "effect/reactivity"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import type { ConnectInviteId, OrganizationId } from "@hazel/schema"
import { eq, useLiveQuery } from "@tanstack/react-db"
import { type DateTime, Option } from "effect"
import { createFileRoute } from "@tanstack/react-router"
import { useMemo, useState } from "react"
import {
	acceptConnectInviteMutation,
	declineConnectInviteMutation,
	listIncomingInvitesQuery,
} from "~/atoms/connect-share-atoms"
import { IconConnect } from "~/components/icons/icon-connect"
import { Badge } from "~/components/ui/badge"
import { Button } from "~/components/ui/button"
import { Card, CardHeader } from "~/components/ui/card"
import { EmptyState } from "~/components/ui/empty-state"
import { organizationCollection } from "~/db/collections"
import { useOrganization } from "~/hooks/use-organization"
import { getConnectInviteStatusBadge } from "~/lib/connect-shared-channels"
import { toDate } from "~/lib/utils"
import { exitToastAsync } from "~/lib/toast-exit"

export const Route = createFileRoute("/_app/$orgSlug/settings/connect-invites")({
	component: ConnectInvitesPage,
})

function ConnectInvitesPage() {
	const { organizationId } = useOrganization()

	const invitesResult = useAtomValue(listIncomingInvitesQuery(organizationId!))

	const allInvites = useMemo(() => {
		if (!AsyncResult.isSuccess(invitesResult)) return []
		const data = AsyncResult.value(invitesResult)
		if (Option.isNone(data)) return []
		return data.value.data
	}, [invitesResult])

	const pendingInvites = allInvites.filter((inv) => inv.status === "pending")
	const otherInvites = allInvites.filter((inv) => inv.status !== "pending")

	return (
		<div className="flex flex-col gap-6 px-4 lg:px-8">
			{/* Pending invites */}
			<Card>
				<CardHeader>
					<div className="flex flex-col gap-0.5">
						<div className="flex items-center gap-2">
							<h2 className="font-semibold text-fg text-lg">Connect invitations</h2>
							{pendingInvites.length > 0 && (
								<Badge intent="secondary">{pendingInvites.length} pending</Badge>
							)}
						</div>
						<p className="text-muted-fg text-sm">
							Invitations from other organizations to share channels.
						</p>
					</div>
				</CardHeader>

				{pendingInvites.length === 0 && otherInvites.length === 0 ? (
					<EmptyState
						icon={IconConnect}
						title="No connect invitations"
						description="When another organization invites you to share a channel, it will appear here."
						className="h-64"
					/>
				) : (
					<div className="overflow-x-auto">
						<table className="w-full min-w-full">
							<thead className="border-border border-b bg-bg">
								<tr>
									<th className="px-4 py-3 text-left font-medium text-muted-fg text-xs">
										From
									</th>
									<th className="px-4 py-3 text-left font-medium text-muted-fg text-xs">
										Status
									</th>
									<th className="px-4 py-3 text-left font-medium text-muted-fg text-xs">
										Received
									</th>
									<th className="px-4 py-3 text-right font-medium text-muted-fg text-xs">
										Actions
									</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-border">
								{pendingInvites.map((invite) => (
									<IncomingInviteRow
										key={invite.id}
										invite={invite}
										organizationId={organizationId}
									/>
								))}
								{otherInvites.map((invite) => (
									<IncomingInviteRow
										key={invite.id}
										invite={invite}
										organizationId={organizationId}
									/>
								))}
							</tbody>
						</table>
					</div>
				)}
			</Card>
		</div>
	)
}

function IncomingInviteRow({
	invite,
	organizationId,
}: {
	invite: {
		id: ConnectInviteId
		hostOrganizationId: OrganizationId
		status: string
		createdAt: Date | DateTime.Utc
	}
	organizationId: OrganizationId | undefined
}) {
	const [isAccepting, setIsAccepting] = useState(false)
	const [isDeclining, setIsDeclining] = useState(false)

	const acceptInvite = useAtomSet(acceptConnectInviteMutation, { mode: "promiseExit" })
	const declineInvite = useAtomSet(declineConnectInviteMutation, { mode: "promiseExit" })

	// Resolve host organization name
	const { data: hostOrg } = useLiveQuery(
		(q) =>
			q
				.from({ org: organizationCollection })
				.where(({ org }) => eq(org.id, invite.hostOrganizationId))
				.findOne()
				.select(({ org }) => ({ name: org.name, slug: org.slug, logoUrl: org.logoUrl })),
		[invite.hostOrganizationId],
	)

	const statusBadge = getConnectInviteStatusBadge(invite.status)

	const handleAccept = async () => {
		if (!organizationId) return
		setIsAccepting(true)
		try {
			await exitToastAsync(
				acceptInvite({
					payload: {
						inviteId: invite.id,
						guestOrganizationId: organizationId,
					},
					reactivityKeys: [`connectInvites:incoming:${organizationId}`],
				}),
			)
				.loading("Accepting invite...")
				.successMessage("Channel connected")
				.onErrorTag("ConnectInviteNotFoundError", () => ({
					title: "Invite not found",
					description: "This invite may have been revoked or expired.",
					isRetryable: false,
				}))
				.onErrorTag("ConnectInviteInvalidStateError", () => ({
					title: "Cannot accept",
					description: "This invite is no longer in an acceptable state.",
					isRetryable: false,
				}))
				.onErrorTag("ConnectWorkspaceNotFoundError", () => ({
					title: "Workspace not found",
					description: "The target workspace could not be found.",
					isRetryable: false,
				}))
				.onErrorTag("ConnectChannelAlreadySharedError", () => ({
					title: "Already shared",
					description: "This channel is already shared with that organization.",
					isRetryable: false,
				}))
				.run()
		} finally {
			setIsAccepting(false)
		}
	}

	const handleDecline = async () => {
		setIsDeclining(true)
		try {
			await exitToastAsync(
				declineInvite({
					payload: {
						inviteId: invite.id,
					},
					reactivityKeys: [`connectInvites:incoming:${organizationId}`],
				}),
			)
				.loading("Declining invite...")
				.successMessage("Invite declined")
				.onErrorTag("ConnectInviteNotFoundError", () => ({
					title: "Invite not found",
					description: "This invite may have already been revoked or expired.",
					isRetryable: false,
				}))
				.onErrorTag("ConnectInviteInvalidStateError", () => ({
					title: "Cannot decline",
					description: "This invite is no longer in a declinable state.",
					isRetryable: false,
				}))
				.onErrorTag("ConnectWorkspaceNotFoundError", () => ({
					title: "Workspace not found",
					description: "This invite is not bound to a workspace.",
					isRetryable: false,
				}))
				.run()
		} finally {
			setIsDeclining(false)
		}
	}

	const isBusy = isAccepting || isDeclining

	return (
		<tr className="hover:bg-secondary/50">
			<td className="px-4 py-4">
				<span className="font-medium text-fg text-sm">
					{hostOrg?.name ?? invite.hostOrganizationId}
				</span>
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
					<div className="flex items-center justify-end gap-2">
						<Button intent="outline" size="sm" onPress={handleDecline} isDisabled={isBusy}>
							{isDeclining ? "Declining..." : "Decline"}
						</Button>
						<Button intent="primary" size="sm" onPress={handleAccept} isDisabled={isBusy}>
							{isAccepting ? "Accepting..." : "Accept"}
						</Button>
					</div>
				)}
			</td>
		</tr>
	)
}
