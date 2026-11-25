import { Submodel } from "foldkit"
import * as AsyncData from "foldkit/asyncData"
import type { Html, HtmlBuilder } from "foldkit/html"
import { getConnectInviteStatusBadge } from "~/lib/connect-shared-channels"
import { type CommonReason, commonMessage, isRetryableReason } from "~/lib/error-messages"
import { IconConnect, IconPlus } from "../../../icons"
import { avatar } from "../../../ui/avatar"
import { badge } from "../../../ui/badge"
import { button } from "../../../ui/button"
import { emptyState } from "../../../ui/empty-state"
import { callout } from "../../../ui/callout"
import { card, cardHeader } from "../../../ui/card"
import { type Column, dataTable } from "../../../ui/data-table"
import { pageHeader, pageLayout } from "../../../ui/page-header"
import type { PageViewInputs, Shared } from "../../contract"
import { type Invite, Message, type Model, type Mount, rowRoles } from "./model"
import type * as ShareModal from "./share-modal"
import { shareChannelModal } from "./share-modal-view"
import { interaction, revokeTarget } from "./update"
import { heading } from "../../../ui/heading"

/** Port of `channels/$channelId/settings/connect.tsx`. */

const toShareModalMessage = (message: ShareModal.Message) => Message.GotShareModalMessage({ message })

const plusIcon = <M>(h: HtmlBuilder<M>) => IconPlus(h, { attributes: { "data-slot": "icon" } })

const connectionRow = (h: HtmlBuilder<Message>, model: Model, mount: Mount, shared: Shared): Html | null => {
	const currentOrgId = shared.organization?.id ?? null
	const viewerRole = model.mounts.find((candidate) => candidate.organizationId === currentOrgId)?.role
	const roles = rowRoles(mount, viewerRole, currentOrgId)
	if (roles.isOwnOrg) return null
	const org = model.orgs[mount.organizationId]
	const isDisconnecting = model.disconnectingMountIds.includes(mount.id)
	const idleLabel = roles.isGuestLeavingConversation ? "Leave shared channel" : "Disconnect"
	const busyLabel = roles.isGuestLeavingConversation ? "Leaving..." : "Disconnecting..."
	const orgName = org?.name ?? mount.organizationId
	return h.keyed("div")(
		mount.id,
		[h.Class("flex items-center justify-between gap-3 px-4 py-3 md:px-6")],
		[
			h.div(
				[h.Class("flex min-w-0 items-center gap-3")],
				[
					avatar(h, {
						size: "sm",
						isSquare: true,
						src: org?.logoUrl,
						seed: org?.name,
						fallbackIcon: true,
					}),
					h.div(
						[h.Class("flex min-w-0 flex-col")],
						[
							h.span([h.Class("truncate font-medium text-fg text-sm")], [orgName]),
							...(model.confirmingDisconnectMountId === mount.id
								? [
										h.span(
											[h.Class("text-fg text-xs")],
											[
												roles.isGuestLeavingConversation
													? "Leave this shared channel? Your workspace stops seeing its messages."
													: `Disconnect ${orgName}? They stop seeing this channel.`,
											],
										),
									]
								: org?.slug
									? [h.span([h.Class("text-muted-fg text-xs")], [org.slug])]
									: []),
						],
					),
				],
			),
			!roles.canDisconnect
				? h.span([h.Class("shrink-0 text-muted-fg text-xs")], ["Managed by host workspace"])
				: model.confirmingDisconnectMountId === mount.id
					? h.div(
							[h.Class("flex shrink-0 items-center gap-2")],
							[
								button(
									h,
									{
										intent: "outline",
										size: "sm",
										onPress: Message.ClickedCancelDisconnect(),
									},
									["Cancel"],
								),
								button(
									h,
									{
										intent: "danger",
										size: "sm",
										onPress: Message.ClickedConfirmDisconnect({ mountId: mount.id }),
										attributes: [
											h.AriaLabel(
												roles.isGuestLeavingConversation
													? "Confirm leave shared channel"
													: `Confirm disconnect ${orgName}`,
											),
										],
									},
									[roles.isGuestLeavingConversation ? "Leave" : "Disconnect"],
								),
							],
						)
					: button(
							h,
							{
								intent: "outline",
								size: "sm",
								className: "shrink-0",
								isDisabled: isDisconnecting,
								isPending: isDisconnecting,
								onPress: Message.ClickedDisconnect({ mountId: mount.id }),
							},
							[isDisconnecting ? busyLabel : idleLabel],
						),
		],
	)
}

const activeConnections = (h: HtmlBuilder<Message>, model: Model, shared: Shared): Html =>
	card(h, {}, [
		cardHeader(h, [
			h.div(
				[h.Class("flex items-center gap-2")],
				[
					heading(h, { variant: "subsection" }, ["Active connections"]),
					badge(h, { intent: "success", size: "sm" }, [
						`${model.mounts.filter((mount) => mount.organizationId !== shared.organization?.id).length}`,
					]),
				],
			),
		]),
		h.div(
			[h.Class("divide-y divide-border")],
			model.mounts.map((mount) => connectionRow(h, model, mount, shared)),
		),
	])

const inviteColumns = (h: HtmlBuilder<Message>, model: Model): ReadonlyArray<Column<Invite>> => [
	{
		key: "target",
		label: "Target",
		cell: (invite) =>
			h.div(
				[h.Class("flex min-w-0 flex-col")],
				[
					h.span([h.Class("truncate font-medium")], [invite.targetValue]),
					h.span([h.Class("text-muted-fg text-xs")], ["Workspace"]),
				],
			),
	},
	{
		key: "status",
		label: "Status",
		widthClass: "w-32",
		cell: (invite) => {
			const statusBadge = getConnectInviteStatusBadge(invite.status)
			return badge(h, { intent: statusBadge.intent, size: "sm" }, [statusBadge.label])
		},
	},
	{
		key: "sent",
		label: "Sent",
		widthClass: "w-36",
		hideClass: "max-md:hidden",
		cell: (invite) =>
			h.span([h.Class("text-muted-fg")], [new Date(invite.createdAtMs).toLocaleDateString()]),
	},
	{
		key: "actions",
		label: "Actions",
		align: "right",
		widthClass: "w-32",
		cell: (invite) => {
			if (invite.status !== "pending") return ""
			const isRevoking = model.revokingInviteIds.includes(invite.id)
			return button(
				h,
				{
					intent: "outline",
					size: "sm",
					isDisabled: isRevoking,
					onPress: Message.ClickedRevokeInvite({ inviteId: invite.id }),
					interaction: {
						wiring: interaction.wiring(model),
						target: revokeTarget(invite.id),
					},
				},
				[isRevoking ? "Revoking..." : "Revoke"],
			)
		},
	},
]

const invitations = (h: HtmlBuilder<Message>, model: Model, invites: ReadonlyArray<Invite>): Html =>
	card(h, {}, [
		cardHeader(h, [heading(h, { variant: "subsection" }, ["Invitations"])]),
		dataTable(h, {
			ariaLabel: "Invitations",
			id: "channel-connect-invites",
			columns: inviteColumns(h, model),
			rows: invites,
			rowKey: (invite) => invite.id,
			isFramed: false,
		}),
	])

const invitesFailed = (h: HtmlBuilder<Message>, reason: CommonReason): Html => {
	const message = commonMessage(reason)
	return callout(
		h,
		{
			intent: "danger",
			title: "Couldn't load invitations",
			actions: isRetryableReason(reason)
				? [
						button(h, { intent: "outline", size: "sm", onPress: Message.ClickedRetryInvites() }, [
							"Try again",
						]),
					]
				: [],
		},
		[message.description ?? message.title],
	)
}

/** The invitations table, a load failure, or (with no connections either) the "not shared" empty state. */
const invitationsSection = (
	h: HtmlBuilder<Message>,
	model: Model,
	isConnected: boolean,
): ReadonlyArray<Html> => {
	const invites = AsyncData.getOrElse(model.invites, () => [])
	return AsyncData.isFailure(model.invites)
		? [invitesFailed(h, model.invites.error)]
		: invites.length > 0
			? [invitations(h, model, invites)]
			: isConnected || AsyncData.isPending(model.invites)
				? []
				: [notShared(h)]
}

const notShared = (h: HtmlBuilder<Message>): Html =>
	emptyState(h, {
		icon: (className) => IconConnect(h, { className }),
		title: "Not shared yet",
		description: "Share this channel with another organization to start collaborating across teams.",
		action: button(h, { intent: "secondary", size: "sm", onPress: Message.ClickedShareChannel() }, [
			plusIcon(h),
			"Share this channel",
		]),
	})

export const view = Submodel.defineView<Model, Message, PageViewInputs>((model, { shared }, h) => {
	const isConnected = model.mounts.length > 0
	return pageLayout(h, {}, [
		pageHeader(h, {
			title: "Hazel Connect",
			size: "title",
			subtitle: "Share this channel with another organization to collaborate together.",
			actions: [
				button(h, { intent: "secondary", size: "md", onPress: Message.ClickedShareChannel() }, [
					plusIcon(h),
					"Share channel",
				]),
			],
		}),
		...(isConnected ? [activeConnections(h, model, shared)] : []),
		...invitationsSection(h, model, isConnected),
		// `{channel && <ShareChannelModal />}`; its overlay portals to the body.
		...(model.channelName === null
			? []
			: [shareChannelModal(h, model.share, model.channelName, toShareModalMessage)]),
	])
})
