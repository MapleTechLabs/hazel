import { Submodel } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { getConnectInviteStatusBadge } from "~/lib/connect-shared-channels"
import { IconConnect } from "../../../icons"
import { badge } from "../../../ui/badge"
import { button } from "../../../ui/button"
import { card, cardHeader } from "../../../ui/card"
import { emptyState } from "../../../ui/empty-state"
import type { PageViewInputs } from "../../contract"
import { Message } from "./message"
import { acceptTarget, declineTarget, interaction } from "./update"
import type { Invite, Model } from "./model"

/** Port of `routes/_app/$orgSlug/settings/connect-invites.tsx`. */

const headerCell = (h: HtmlBuilder<Message>, label: string, align: "left" | "right") =>
	h.th([h.Class(`px-4 py-3 text-${align} font-medium text-muted-fg text-xs`)], [label])

const inviteRow = (h: HtmlBuilder<Message>, model: Model, invite: Invite): Html => {
	const statusBadge = getConnectInviteStatusBadge(invite.status)
	const hostName =
		model.hostOrganizations.find((org) => org.id === invite.hostOrganizationId)?.name ??
		invite.hostOrganizationId
	const isAccepting = model.acceptingIds.includes(invite.id)
	const isDeclining = model.decliningIds.includes(invite.id)
	const isBusy = isAccepting || isDeclining
	return h.keyed("tr")(
		invite.id,
		[h.Class("hover:bg-secondary/50")],
		[
			h.td([h.Class("px-4 py-4")], [h.span([h.Class("font-medium text-fg text-sm")], [hostName])]),
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
							h.div(
								[h.Class("flex items-center justify-end gap-2")],
								[
									button(
										h,
										{
											intent: "outline",
											size: "sm",
											isDisabled: isBusy,
											onPress: Message.ClickedDecline({ inviteId: invite.id }),
											interaction: {
												wiring: interaction.wiring(model),
												target: declineTarget(invite.id),
											},
										},
										[isDeclining ? "Declining..." : "Decline"],
									),
									button(
										h,
										{
											intent: "primary",
											size: "sm",
											isDisabled: isBusy,
											onPress: Message.ClickedAccept({ inviteId: invite.id }),
											interaction: {
												wiring: interaction.wiring(model),
												target: acceptTarget(invite.id),
											},
										},
										[isAccepting ? "Accepting..." : "Accept"],
									),
								],
							),
						]
					: [],
			),
		],
	)
}

export const view = Submodel.defineView<Model, Message, PageViewInputs>((model, _inputs, h) => {
	const pendingInvites = model.invites.filter((invite) => invite.status === "pending")
	const otherInvites = model.invites.filter((invite) => invite.status !== "pending")
	return h.div(
		[h.Class("flex flex-col gap-6 px-4 lg:px-8")],
		[
			card(h, {}, [
				cardHeader(h, [
					h.div(
						[h.Class("flex flex-col gap-0.5")],
						[
							h.div(
								[h.Class("flex items-center gap-2")],
								[
									h.h2([h.Class("font-semibold text-fg text-lg")], ["Connect invitations"]),
									...(pendingInvites.length > 0
										? [
												badge(h, { intent: "secondary" }, [
													`${pendingInvites.length}`,
													" pending",
												]),
											]
										: []),
								],
							),
							h.p(
								[h.Class("text-muted-fg text-sm")],
								["Invitations from other organizations to share channels."],
							),
						],
					),
				]),
				model.invites.length === 0
					? emptyState(h, {
							icon: (className) => IconConnect(h, { className }),
							title: "No connect invitations",
							description:
								"When another organization invites you to share a channel, it will appear here.",
							className: "h-64",
						})
					: h.div(
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
														headerCell(h, "From", "left"),
														headerCell(h, "Status", "left"),
														headerCell(h, "Received", "left"),
														headerCell(h, "Actions", "right"),
													],
												),
											],
										),
										h.tbody(
											[h.Class("divide-y divide-border")],
											[...pendingInvites, ...otherInvites].map((invite) =>
												inviteRow(h, model, invite),
											),
										),
									],
								),
							],
						),
			]),
		],
	)
})
