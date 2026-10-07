import { Submodel } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { getConnectInviteStatusBadge } from "~/lib/connect-shared-channels"
import { IconConnect, IconPlus } from "../../../icons"
import { avatar } from "../../../ui/avatar"
import { badge } from "../../../ui/badge"
import { button } from "../../../ui/button"
import { emptyState } from "../../../ui/empty-state"
import { sectionHeaderActions } from "../../../ui/section-header"
import type { PageViewInputs, Shared } from "../../contract"
import { tabHeader } from "../section-header"
import { type Invite, Message, type Model, type Mount, rowRoles } from "./model"
import type * as ShareModal from "./share-modal"
import { shareChannelModal } from "./share-modal-view"

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
	return h.keyed("div")(
		mount.id,
		[h.Class("flex items-center justify-between px-4 py-3 md:px-6")],
		[
			h.div(
				[h.Class("flex items-center gap-3")],
				[
					avatar(h, {
						size: "sm",
						isSquare: true,
						src: org?.logoUrl,
						seed: org?.name ?? mount.organizationId,
					}),
					h.div(
						[h.Class("flex flex-col")],
						[
							h.span(
								[h.Class("font-medium text-fg text-sm")],
								[org?.name ?? mount.organizationId],
							),
							...(org?.slug ? [h.span([h.Class("text-muted-fg text-xs")], [org.slug])] : []),
						],
					),
				],
			),
			roles.canDisconnect
				? button(
						h,
						{
							intent: "outline",
							size: "sm",
							isDisabled: isDisconnecting,
							onPress: Message.ClickedDisconnect({ mountId: mount.id }),
						},
						[isDisconnecting ? busyLabel : idleLabel],
					)
				: h.span([h.Class("text-muted-fg text-xs")], ["Managed by host workspace"]),
		],
	)
}

const activeConnections = (h: HtmlBuilder<Message>, model: Model, shared: Shared): Html =>
	h.div(
		[h.Class("overflow-hidden rounded-xl border border-border bg-bg shadow-sm")],
		[
			h.div(
				[h.Class("border-border border-b bg-bg px-4 py-4 md:px-6")],
				[
					h.div(
						[h.Class("flex items-center gap-2")],
						[
							h.h3([h.Class("font-semibold text-fg text-sm")], ["Active connections"]),
							badge(h, { intent: "success", size: "sm" }, [
								`${model.mounts.filter((mount) => mount.organizationId !== shared.organization?.id).length}`,
							]),
						],
					),
				],
			),
			h.div(
				[h.Class("divide-y divide-border")],
				model.mounts.map((mount) => connectionRow(h, model, mount, shared)),
			),
		],
	)

const headerCell = (h: HtmlBuilder<Message>, label: string, align: "left" | "right") =>
	h.th([h.Class(`px-4 py-3 text-${align} font-medium text-muted-fg text-xs`)], [label])

const inviteRow = (h: HtmlBuilder<Message>, model: Model, invite: Invite): Html => {
	const statusBadge = getConnectInviteStatusBadge(invite.status)
	const isRevoking = model.revokingInviteIds.includes(invite.id)
	return h.keyed("tr")(
		invite.id,
		[h.Class("hover:bg-secondary/50")],
		[
			h.td(
				[h.Class("px-4 py-4")],
				[
					h.div(
						[h.Class("flex flex-col")],
						[
							h.span([h.Class("font-medium text-fg text-sm")], [invite.targetValue]),
							h.span([h.Class("text-muted-fg text-xs")], ["Workspace"]),
						],
					),
				],
			),
			h.td(
				[h.Class("px-4 py-4")],
				[badge(h, { intent: statusBadge.intent, size: "sm" }, [statusBadge.label])],
			),
			h.td(
				[h.Class("px-4 py-4")],
				[
					h.span(
						[h.Class("text-muted-fg text-sm")],
						[new Date(invite.createdAtMs).toLocaleDateString()],
					),
				],
			),
			h.td(
				[h.Class("px-4 py-4 text-right")],
				invite.status === "pending"
					? [
							button(
								h,
								{
									intent: "outline",
									size: "sm",
									isDisabled: isRevoking,
									onPress: Message.ClickedRevokeInvite({ inviteId: invite.id }),
								},
								[isRevoking ? "Revoking..." : "Revoke"],
							),
						]
					: [],
			),
		],
	)
}

const invitations = (h: HtmlBuilder<Message>, model: Model): Html =>
	h.div(
		[h.Class("overflow-hidden rounded-xl border border-border bg-bg shadow-sm")],
		[
			h.div(
				[h.Class("border-border border-b bg-bg px-4 py-4 md:px-6")],
				[h.h3([h.Class("font-semibold text-fg text-sm")], ["Invitations"])],
			),
			h.div(
				[h.Class("overflow-x-auto")],
				[
					h.table(
						[h.Class("w-full min-w-full")],
						[
							h.thead(
								[h.Class("border-border border-b bg-bg")],
								[
									h.tr(
										[],
										[
											headerCell(h, "Target", "left"),
											headerCell(h, "Status", "left"),
											headerCell(h, "Sent", "left"),
											headerCell(h, "Actions", "right"),
										],
									),
								],
							),
							h.tbody(
								[h.Class("divide-y divide-border")],
								model.invites.map((invite) => inviteRow(h, model, invite)),
							),
						],
					),
				],
			),
		],
	)

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
	return h.div(
		[h.Class("flex flex-col gap-6 px-4 lg:px-8")],
		[
			tabHeader(
				h,
				"Hazel Connect",
				"Share this channel with another organization to collaborate together.",
				[
					sectionHeaderActions(h, {}, [
						button(
							h,
							{ intent: "secondary", size: "md", onPress: Message.ClickedShareChannel() },
							[plusIcon(h), "Share channel"],
						),
					]),
				],
			),
			...(isConnected ? [activeConnections(h, model, shared)] : []),
			...(model.invites.length > 0 ? [invitations(h, model)] : isConnected ? [] : [notShared(h)]),
			// `{channel && <ShareChannelModal />}`; its overlay portals to the body.
			...(model.channelName === null
				? []
				: [shareChannelModal(h, model.share, model.channelName, toShareModalMessage)]),
		],
	)
})
