import { Submodel } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { getConnectInviteStatusBadge } from "~/lib/connect-shared-channels"
import * as SuggestionPrompt from "../../../customers/suggestion-prompt"
import { IconConnect } from "../../../icons"
import { badge } from "../../../ui/badge"
import { button } from "../../../ui/button"
import { card, cardHeader } from "../../../ui/card"
import { type Column, dataTable } from "../../../ui/data-table"
import { emptyState } from "../../../ui/empty-state"
import type { PageViewInputs } from "../../contract"
import { Message } from "./message"
import { acceptTarget, declineTarget, interaction, invitesOf } from "./update"
import type { Invite, Model } from "./model"
import { pageHeader, pageLayout } from "../../../ui/page-header"
import { asyncListBody } from "../async-list"

/** Port of `routes/_app/$orgSlug/settings/connect-invites.tsx`. */

const toSuggestionMessage = (message: SuggestionPrompt.Message) => Message.GotSuggestionMessage({ message })

const actionsCell = (h: HtmlBuilder<Message>, model: Model, invite: Invite): Html | string => {
	if (invite.status !== "pending") return ""
	const isAccepting = model.acceptingIds.includes(invite.id)
	const isDeclining = model.decliningIds.includes(invite.id)
	const isBusy = isAccepting || isDeclining
	return h.div(
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
	)
}

const columns = (h: HtmlBuilder<Message>, model: Model): ReadonlyArray<Column<Invite>> => [
	{
		key: "from",
		label: "From",
		cell: (invite) =>
			h.span(
				[h.Class("block truncate font-medium")],
				[
					model.hostOrganizations.find((org) => org.id === invite.hostOrganizationId)?.name ??
						invite.hostOrganizationId,
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
		key: "received",
		label: "Received",
		widthClass: "w-36",
		hideClass: "max-md:hidden",
		cell: (invite) =>
			h.span([h.Class("text-muted-fg")], [new Date(invite.createdAtMs).toLocaleDateString()]),
	},
	{
		key: "actions",
		label: "Actions",
		align: "right",
		widthClass: "w-52",
		cell: (invite) => actionsCell(h, model, invite),
	},
]

const invitesTable = (h: HtmlBuilder<Message>, model: Model, invites: ReadonlyArray<Invite>): Html =>
	dataTable(h, {
		ariaLabel: "Connect invitations",
		id: "connect-invites",
		columns: columns(h, model),
		rows: [
			...invites.filter((invite) => invite.status === "pending"),
			...invites.filter((invite) => invite.status !== "pending"),
		],
		rowKey: (invite) => invite.id,
		isFramed: false,
	})

const loadedBody = (h: HtmlBuilder<Message>, model: Model, invites: ReadonlyArray<Invite>): Html =>
	invites.length === 0
		? emptyState(h, {
				icon: (className) => IconConnect(h, { className }),
				title: "No connect invitations",
				description: "When another organization invites you to share a channel, it will appear here.",
				className: "h-64",
			})
		: invitesTable(h, model, invites)

const body = (h: HtmlBuilder<Message>, model: Model): Html =>
	asyncListBody(h, model.invites, {
		loadingLabel: "Loading invitations...",
		failedTitle: "Couldn't load connect invitations",
		onRetry: Message.ClickedRetryListInvites(),
		loaded: (invites) => loadedBody(h, model, invites),
	})

export const view = Submodel.defineView<Model, Message, PageViewInputs>((model, _inputs, h) => {
	const pendingCount = invitesOf(model).filter((invite) => invite.status === "pending").length
	return pageLayout(h, {}, [
		SuggestionPrompt.view(h, model.suggestion, {
			toParentMessage: toSuggestionMessage,
			// The guest channel is named "shared-channel" until the host's snapshot arrives.
			subject: "The shared channel",
		}),
		card(h, {}, [
			cardHeader(h, [
				pageHeader(h, {
					title: "Connect invitations",
					size: "title",
					badges:
						pendingCount > 0
							? [badge(h, { intent: "secondary" }, [`${pendingCount}`, " pending"])]
							: [],
					subtitle: "Invitations from other organizations to share channels.",
				}),
			]),
			body(h, model),
		]),
	])
})
