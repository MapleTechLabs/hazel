import { Submodel } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { IconClose, IconDots, IconPlus, IconUsersPlus } from "../../../icons"
import { badge } from "../../../ui/badge"
import { button } from "../../../ui/button"
import { card, cardHeader } from "../../../ui/card"
import { type Column, dataTable } from "../../../ui/data-table"
import { emptyState } from "../../../ui/empty-state"
import * as Menu from "../../../ui/menu"
import { menuLabel, view as menuView } from "../../../ui/menu-view"
import type { PageViewInputs } from "../../contract"
import { Message } from "./message"
import type { Invitation, Model, RowMenu } from "./model"
import { invitationsOf, rowMenuEntries } from "./update"
import { pageHeader, pageLayout } from "../../../ui/page-header"
import { statusDot } from "../../../ui/status-dot"
import { asyncListBody } from "../async-list"

/** Port of `routes/_app/$orgSlug/settings/invitations.tsx`. */

const formatSent = (createdAtMs: number) =>
	new Date(createdAtMs).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })

const roleLabel = (role: string) =>
	role === "org:admin" || role === "admin"
		? "Admin"
		: role === "org:member" || role === "member"
			? "Member"
			: role

const plusIcon = (h: HtmlBuilder<Message>) => IconPlus(h, { attributes: { "data-slot": "icon" } })

const rowActions = (h: HtmlBuilder<Message>, row: RowMenu, isRevoking: boolean): Html =>
	h.submodel({
		slotId: row.menu.id,
		model: row.menu,
		view: menuView,
		viewInputs: {
			entries: rowMenuEntries(isRevoking),
			toTrigger: (attributes, overlay) =>
				button(
					h,
					{
						intent: "plain",
						size: "sq-xs",
						className: "max-md:size-10",
						isPending: isRevoking,
						isDisabled: isRevoking,
						attributes: [h.AriaLabel("Invitation actions"), ...attributes],
					},
					[IconDots(h), overlay],
				),
			content: (key) => [
				IconClose(h, { attributes: { "data-slot": "icon" } }),
				menuLabel(h, row.menu.id, key, isRevoking ? "Revoking..." : "Revoke invitation"),
			],
		},
		toParentMessage: (message: Menu.Message) =>
			Message.GotRowMenuMessage({ invitationId: row.invitationId, message }),
	})

const columns = (h: HtmlBuilder<Message>, model: Model): ReadonlyArray<Column<Invitation>> => [
	{
		key: "email",
		label: "Email",
		cell: (invitation) =>
			h.span(
				[h.Class("block truncate font-medium max-md:whitespace-normal max-md:break-all")],
				[invitation.emailAddress],
			),
	},
	{
		key: "role",
		label: "Role",
		widthClass: "w-32",
		cell: (invitation) => h.span([h.Class("text-muted-fg")], [roleLabel(invitation.role)]),
	},
	{
		key: "status",
		label: "Status",
		widthClass: "w-32",
		hideClass: "max-md:hidden",
		cell: () => badge(h, { intent: "warning" }, [statusDot(h, { tone: "warning" }), "Pending"]),
	},
	{
		key: "sent",
		label: "Sent",
		widthClass: "w-36",
		hideClass: "max-md:hidden",
		cell: (invitation) => h.span([h.Class("text-muted-fg")], [formatSent(invitation.createdAtMs)]),
	},
	{
		key: "actions",
		label: "Actions",
		align: "right",
		widthClass: "w-24",
		cell: (invitation) => {
			const row = model.menus.find((candidate) => candidate.invitationId === invitation.id)
			return row === undefined ? "" : rowActions(h, row, model.revokingId === invitation.id)
		},
	},
]

const invitationsTable = (
	h: HtmlBuilder<Message>,
	model: Model,
	invitations: ReadonlyArray<Invitation>,
): Html =>
	dataTable(h, {
		ariaLabel: "Pending invitations",
		id: "invitations",
		columns: columns(h, model),
		rows: invitations,
		rowKey: (invitation) => invitation.id,
		isFramed: false,
	})

const loadedBody = (h: HtmlBuilder<Message>, model: Model, invitations: ReadonlyArray<Invitation>): Html =>
	invitations.length === 0
		? emptyState(h, {
				icon: (className) => IconUsersPlus(h, { className }),
				title: "No pending invitations",
				description: "Invite team members to join your organization.",
				action: button(h, { intent: "secondary", size: "sm", onPress: Message.ClickedInviteUser() }, [
					plusIcon(h),
					"Invite a team member",
				]),
				className: "h-64",
			})
		: invitationsTable(h, model, invitations)

const body = (h: HtmlBuilder<Message>, model: Model): Html =>
	asyncListBody(h, model.invitations, {
		loadingLabel: "Loading invitations...",
		failedTitle: "Couldn't load invitations",
		onRetry: Message.ClickedRetryFetchInvitations(),
		loaded: (invitations) => loadedBody(h, model, invitations),
	})

export const view = Submodel.defineView<Model, Message, PageViewInputs>((model, _inputs, h) => {
	const count = invitationsOf(model).length
	return pageLayout(h, {}, [
		card(h, {}, [
			cardHeader(h, [
				pageHeader(h, {
					title: "Pending invitations",
					size: "title",
					badges: count > 0 ? [badge(h, { intent: "secondary" }, [`${count}`, " pending"])] : [],
					subtitle:
						"Pending invitations to this workspace. Each link expires 7 days after it was sent.",
					actions: [
						button(h, { intent: "secondary", size: "md", onPress: Message.ClickedInviteUser() }, [
							plusIcon(h),
							"Invite user",
						]),
					],
				}),
			]),
			body(h, model),
		]),
	])
})
