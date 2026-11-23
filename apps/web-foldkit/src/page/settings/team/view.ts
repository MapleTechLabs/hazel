import { Submodel } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { getEffectivePresenceStatus } from "~/utils/presence"
import { getStatusBadgeIntent, getStatusLabel } from "~/utils/status"
import { IconDotsVertical, IconPlus } from "../../../icons"
import { avatar } from "../../../ui/avatar"
import { badge } from "../../../ui/badge"
import { button } from "../../../ui/button"
import { card, cardHeader } from "../../../ui/card"
import { type Column, dataTable } from "../../../ui/data-table"
import type { PageViewInputs } from "../../contract"
import { Message } from "./message"
import type { Model, TeamMember } from "./model"
import { pageHeader, pageLayout } from "../../../ui/page-header"
import { statusDot } from "../../../ui/status-dot"

/** Port of `routes/_app/$orgSlug/settings/team.tsx` (read path; menus and modals follow in Phase 5). */

const canManageUser = (
	members: ReadonlyArray<TeamMember>,
	currentUserId: string | undefined,
	targetRole: string,
) => {
	const current = members.find((member) => member.userId === currentUserId)
	if (!current) return false
	if (current.role === "owner") return true
	return current.role === "admin" && targetRole === "member"
}

type TeamContext<Message> = Readonly<{
	members: ReadonlyArray<TeamMember>
	currentUserId: string | undefined
	nowMs: number
	onInvite: Message
}>

const columns = <Message>(
	h: HtmlBuilder<Message>,
	context: TeamContext<Message>,
): ReadonlyArray<Column<TeamMember>> => [
	{
		key: "name",
		label: "Name",
		cell: (member) => {
			const fullName = `${member.firstName} ${member.lastName}`
			return h.div(
				[h.Class("flex min-w-0 items-center gap-3")],
				[
					avatar(h, { src: member.avatarUrl, alt: undefined, seed: fullName, className: "size-9" }),
					h.div(
						[h.Class("flex min-w-0 flex-col")],
						[
							h.span([h.Class("truncate font-medium")], [fullName]),
							h.span(
								[
									h.Class(
										"truncate text-muted-fg text-xs max-md:whitespace-normal max-md:break-all",
									),
								],
								[member.email],
							),
						],
					),
				],
			)
		},
	},
	{
		key: "status",
		label: "Status",
		widthClass: "w-36",
		hideClass: "max-md:hidden",
		cell: (member) => {
			const status = getEffectivePresenceStatus(
				member.presenceLastSeenMs === null ? null : { status: member.presenceStatus },
			)
			return badge(h, { intent: getStatusBadgeIntent(status) }, [
				// The dot takes the badge's colour.
				statusDot(h, { tone: "neutral", className: "bg-current" }),
				getStatusLabel(status),
			])
		},
	},
	{
		key: "role",
		label: "Role",
		widthClass: "w-28",
		cell: (member) =>
			badge(
				h,
				{ intent: member.role === "owner" || member.role === "admin" ? "primary" : "secondary" },
				[member.role.charAt(0).toUpperCase() + member.role.slice(1)],
			),
	},
	{
		key: "actions",
		label: "Actions",
		align: "right",
		widthClass: "w-24",
		cell: (member) =>
			context.currentUserId !== undefined &&
			member.userId !== context.currentUserId &&
			canManageUser(context.members, context.currentUserId, member.role)
				? button(
						h,
						{
							intent: "plain",
							size: "sq-xs",
							className: "max-md:size-10",
							attributes: [
								h.Attribute("aria-haspopup", "true"),
								h.Attribute("aria-expanded", "false"),
								h.Attribute("aria-label", "Actions"),
							],
						},
						[IconDotsVertical(h, { className: "size-5 text-muted-fg" })],
					)
				: "",
	},
]

export const teamPage = <Message>(h: HtmlBuilder<Message>, props: TeamContext<Message>): Html =>
	pageLayout(h, {}, [
		card(h, {}, [
			cardHeader(h, [
				pageHeader(h, {
					title: "Team members",
					size: "title",
					badges: [badge(h, { intent: "secondary" }, [`${props.members.length || 0}`, " users"])],
					subtitle: "Manage your team members and their account permissions here.",
					actions: [
						button(h, { intent: "secondary", size: "md", onPress: props.onInvite }, [
							IconPlus(h, { attributes: { "data-slot": "icon" } }),
							"Invite user",
						]),
					],
				}),
			]),
			dataTable(h, {
				ariaLabel: "Team members",
				id: "team-members",
				columns: columns(h, props),
				rows: props.members,
				rowKey: (member) => member.id,
				isFramed: false,
			}),
		]),
	])

export const view = Submodel.defineView<Model, Message, PageViewInputs>((model, { shared }, h) =>
	teamPage(h, {
		members: model.members,
		currentUserId: shared.currentUser?.id,
		nowMs: shared.nowMs,
		onInvite: Message.ClickedInviteUser(),
	}),
)
