import { Submodel } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { getEffectivePresenceStatus } from "~/utils/presence"
import { getStatusBadgeIntent, getStatusLabel } from "~/utils/status"
import { IconDotsVertical, IconPlus } from "../../../icons"
import { avatar } from "../../../ui/avatar"
import { badge } from "../../../ui/badge"
import { button } from "../../../ui/button"
import { card, cardHeader, cardHeaderGroup } from "../../../ui/card"
import type { PageViewInputs } from "../../contract"
import { Message } from "./message"
import type { Model, TeamMember } from "./model"

/** Port of `routes/_app/$orgSlug/settings/team.tsx` (read path; menus and modals follow in Phase 5). */

const getInitials = (name: string) => {
	const [firstName, lastName] = name.split(" ")
	return `${firstName?.charAt(0)}${lastName?.charAt(0)}`
}

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

const headerCell = <Message>(h: HtmlBuilder<Message>, label: string, align: "left" | "right") =>
	h.th([h.Class(`px-4 py-3 text-${align} font-medium text-muted-fg text-xs`)], [label])

const memberRow = <Message>(
	h: HtmlBuilder<Message>,
	member: TeamMember,
	context: {
		readonly members: ReadonlyArray<TeamMember>
		readonly currentUserId: string | undefined
		readonly nowMs: number
		readonly onInvite: Message
	},
): Html => {
	const fullName = `${member.firstName} ${member.lastName}`
	const status = getEffectivePresenceStatus(
		member.presenceLastSeenMs === null
			? null
			: { status: member.presenceStatus, lastSeenAt: new Date(member.presenceLastSeenMs) },
		context.nowMs,
	)
	const showActions =
		context.currentUserId !== undefined &&
		member.userId !== context.currentUserId &&
		canManageUser(context.members, context.currentUserId, member.role)

	return h.keyed("tr")(
		member.id,
		[h.Class("hover:bg-secondary/50")],
		[
			h.td(
				[h.Class("px-4 py-4")],
				[
					h.div(
						[h.Class("flex items-center gap-3")],
						[
							avatar(h, {
								src: member.avatarUrl,
								alt: undefined,
								seed: fullName,
								className: "size-9",
							}),
							h.div(
								[h.Class("flex flex-col")],
								[
									h.span([h.Class("font-medium text-fg text-sm")], [fullName]),
									h.span([h.Class("text-muted-fg text-xs")], [member.email]),
								],
							),
						],
					),
				],
			),
			h.td(
				[h.Class("px-4 py-4")],
				[
					badge(h, { intent: getStatusBadgeIntent(status) }, [
						h.span([h.Class("size-1.5 rounded-full bg-current")]),
						getStatusLabel(status),
					]),
				],
			),
			h.td(
				[h.Class("px-4 py-4")],
				[
					badge(
						h,
						{
							intent:
								member.role === "owner" || member.role === "admin" ? "primary" : "secondary",
						},
						[member.role.charAt(0).toUpperCase() + member.role.slice(1)],
					),
				],
			),
			h.td(
				[h.Class("px-4 py-4 text-right")],
				showActions
					? [
							h.div(
								[h.Class("flex justify-end")],
								[
									button(
										h,
										{
											intent: "plain",
											size: "sq-xs",
											attributes: [
												h.Attribute("aria-haspopup", "true"),
												h.Attribute("aria-expanded", "false"),
												h.Attribute("aria-label", "Actions"),
											],
										},
										[IconDotsVertical(h, { className: "size-5 text-muted-fg" })],
									),
								],
							),
						]
					: [],
			),
		],
	)
}

export const teamPage = <Message>(
	h: HtmlBuilder<Message>,
	props: {
		readonly members: ReadonlyArray<TeamMember>
		readonly currentUserId: string | undefined
		readonly nowMs: number
		readonly onInvite: Message
	},
): Html =>
	h.div(
		[h.Class("flex flex-col gap-6 px-4 lg:px-8")],
		[
			card(h, {}, [
				cardHeader(h, [
					cardHeaderGroup(h, [
						h.div(
							[h.Class("flex flex-1 flex-col gap-0.5")],
							[
								h.div(
									[h.Class("flex items-center gap-2")],
									[
										h.h2([h.Class("font-semibold text-fg text-lg")], ["Team members"]),
										badge(h, { intent: "secondary" }, [
											`${props.members.length || 0}`,
											" users",
										]),
									],
								),
								h.p(
									[h.Class("text-muted-fg text-sm")],
									["Manage your team members and their account permissions here."],
								),
							],
						),
						h.div(
							[h.Class("flex gap-3")],
							[
								button(h, { intent: "secondary", size: "md", onPress: props.onInvite }, [
									IconPlus(h, { attributes: { "data-slot": "icon" } }),
									"Invite user",
								]),
							],
						),
					]),
				]),
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
												headerCell(h, "Name", "left"),
												headerCell(h, "Status", "left"),
												headerCell(h, "Role", "left"),
												headerCell(h, "Actions", "right"),
											],
										),
									],
								),
								h.tbody(
									[h.Class("divide-y divide-border")],
									props.members.map((member) => memberRow(h, member, props)),
								),
							],
						),
					],
				),
			]),
		],
	)

export const view = Submodel.defineView<Model, Message, PageViewInputs>((model, { shared }, h) =>
	teamPage(h, {
		members: model.members,
		currentUserId: shared.currentUser?.id,
		nowMs: shared.nowMs,
		onInvite: Message.ClickedInviteUser(),
	}),
)
