// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * `/:org/settings/team` (`web-foldkit/src/page/settings/team`, now deleted): the workspace's
 * people with their presence and role; an owner or admin changes roles and invites more.
 */
import { UiSchema } from "@effect/ui"
import { Subscription } from "@effect/ui"
import type { ClientData } from "@hazel/client-data"
import { OrganizationId, OrganizationMemberId, UserId } from "@hazel/schema"
import { Hazel } from "@hazel/ui/vocabulary/index"
import type { BadgeTone } from "@hazel/ui/vocabulary/options"
import { eq } from "@tanstack/db"
import { Schema, Stream } from "effect"
import { withData } from "../../../app/live"
import { OpenModal } from "../../../app/requests"
import { Session } from "../../../app/session"
import { getEffectivePresenceStatus } from "../../../lib/utils/presence"
import { getStatusBadgeIntent, getStatusLabel } from "../../../lib/utils/status"
import { settingsCard, settingsColumn } from "../../shared/card"

export const Role = Schema.Literals(["owner", "admin", "member"])
export type Role = typeof Role.Type

export const TeamMember = Schema.Struct({
	id: OrganizationMemberId,
	userId: UserId,
	role: Role,
	firstName: Schema.String,
	lastName: Schema.String,
	email: Schema.String,
	avatarUrl: Schema.NullOr(Schema.String),
	presenceStatus: Schema.NullOr(Schema.String),
	presenceLastSeenMs: Schema.NullOr(Schema.Finite),
})
export type TeamMember = typeof TeamMember.Type

export const TeamMessage = UiSchema.TaggedEnum({
	UpdatedMembers: { members: Schema.Array(TeamMember) },
	PressedInvite: {},
	PressedChangeRole: { memberId: OrganizationMemberId },
})
export type TeamMessage = typeof TeamMessage.Type

export const TeamProps = Schema.Struct({ session: Session })
export type TeamProps = typeof TeamProps.Type

export const TeamModel = Schema.Struct({
	members: Schema.Array(TeamMember),
	/** The live query answered once; until then the table draws skeleton rows, not "0 members". */
	loaded: Schema.Boolean,
})
export type TeamModel = typeof TeamModel.Type

interface MemberRow {
	readonly id: OrganizationMemberId
	readonly userId: UserId
	readonly role: Role
	readonly user: {
		readonly firstName: string
		readonly lastName: string
		readonly email: string
		readonly avatarUrl?: string | null
	}
	readonly presence?: { readonly status: string; readonly lastSeenAt: Date } | undefined
}

/** The organization's human members with their presence (`routes/.../settings/team.tsx`'s query). */
export const membersStream = <M>(
	organizationId: OrganizationId,
	to: (members: ReadonlyArray<TeamMember>) => M,
): Stream.Stream<M, never, ClientData> =>
	withData((data) =>
		data.liveQueryStream<MemberRow, M>(
			(q) =>
				q
					.from({ members: data.collections.organizationMemberCollection })
					.where(({ members }) => eq(members.organizationId, organizationId))
					.innerJoin({ user: data.collections.userCollection }, ({ members, user }) =>
						eq(members.userId, user.id),
					)
					.leftJoin(
						{ presence: data.collections.userPresenceStatusCollection },
						({ user, presence }) => eq(user.id, presence.userId),
					)
					.where(({ user }) => eq(user.userType, "user"))
					.select(({ members, user, presence }) => ({ ...members, user, presence })),
			(rows) =>
				to(
					rows.map((row) => ({
						id: row.id,
						userId: row.userId,
						role: row.role,
						firstName: row.user.firstName,
						lastName: row.user.lastName,
						email: row.user.email,
						avatarUrl: row.user.avatarUrl ?? null,
						presenceStatus: row.presence?.status ?? null,
						presenceLastSeenMs: row.presence ? new Date(row.presence.lastSeenAt).getTime() : null,
					})),
				),
		),
	)

/** An owner manages everyone; an admin manages members. */
export const canManage = (current: TeamMember | undefined, target: TeamMember): boolean =>
	current !== undefined &&
	current.userId !== target.userId &&
	(current.role === "owner" || (current.role === "admin" && target.role === "member"))

const fullName = (member: TeamMember) => `${member.firstName} ${member.lastName}`

const presenceTone = (status: string): BadgeTone => {
	const intent = getStatusBadgeIntent(status)
	return intent === "secondary" ? "neutral" : intent
}

const roleLabel = (role: Role) => role.charAt(0).toUpperCase() + role.slice(1)

// HAZEL-GAP(p4-table-widths): today's Status is 144px and Role 112px wide; the nearest step is 128.
const COLUMNS = [
	{ key: "name", label: "Name", width: "fill" },
	{ key: "status", label: "Status", width: "regular", optional: true },
	{ key: "role", label: "Role", width: "regular" },
	{ key: "actions", label: "Actions", width: "regular", align: "end" },
] as const

const TeamDef = Hazel.component({
	name: "TeamPage",
	props: TeamProps,
	model: TeamModel,
	message: TeamMessage,
})

type H = Parameters<Parameters<typeof TeamDef.make>[0]["view"]>[0]

const memberRow = (h: H, member: TeamMember, current: TeamMember | undefined) => {
	const status = getEffectivePresenceStatus(
		member.presenceLastSeenMs === null ? null : { status: member.presenceStatus },
	)
	const cell = (column: string, ...content: ReadonlyArray<Hazel.NoTextInput<TeamMessage>>) =>
		h.tableCell.column(column).children(...content)
	// HAZEL-GAP(p4-table-cell-wrap): on a phone today's email wraps anywhere (`break-all`) and the name
	// ends in an ellipsis; here both clip at the cell's edge.
	// HAZEL-GAP(p4-avatar-36): today's row avatar is 36px (`size-9`); `medium` is 40.
	return h.tableRow
		.key(member.id)
		.title(fullName(member))
		.children(
			cell(
				"name",
				h.stack
					.axis("horizontal")
					.align("center")
					.density("cozy")
					.children(
						h.avatar
							.name(fullName(member))
							.src(member.avatarUrl ?? undefined)
							.size("medium"),
						h.stack
							.density("none")
							.children(
								h.text.role("label").strong().truncate().children(fullName(member)),
								h.text.role("caption").tone("muted").truncate().children(member.email),
							),
					),
			),
			// HAZEL-GAP(p4-badge-dot): today's status badge leads with a dot in the badge's colour.
			cell(
				"status",
				h.stack
					.axis("horizontal")
					.children(h.badge.label(getStatusLabel(status)).tone(presenceTone(status))),
			),
			cell(
				"role",
				h.stack
					.axis("horizontal")
					.children(
						h.badge
							.label(roleLabel(member.role))
							.tone(member.role === "member" ? "neutral" : "accent"),
					),
			),
			cell(
				"actions",
				canManage(current, member)
					? h.button
							.label("Change role")
							.variant("ghost")
							.size("xsmall")
							.on("press", TeamMessage.PressedChangeRole({ memberId: member.id }))
					: null,
			),
		)
}

export const TeamPage = TeamDef.make({
	init: () => ({ members: [], loaded: false }),
	update: {
		UpdatedMembers: ($, { members }) => $.evolve({ members: () => members, loaded: () => true }),
		// Today's `EmailInviteModal`, the same one the invitations page opens.
		PressedInvite: ($) => $.run(OpenModal.make({ modal: { _tag: "EmailInvite" } })),
		PressedChangeRole: ($, { memberId }) => {
			const target = $.model.members.find((member) => member.id === memberId)
			const userId = $.props.session.user?.id
			const current = $.model.members.find((member) => member.userId === userId)
			if (target === undefined || current === undefined) return $.model
			return $.run(
				OpenModal.make({
					modal: {
						_tag: "ChangeRole",
						userId: target.userId,
						memberId: target.id,
						name: fullName(target).trim(),
						role: target.role,
						currentUserRole: current.role,
					},
				}),
			)
		},
	},
	subscriptions: ({ props }) => {
		const organizationId = props.session.organization?.id
		return organizationId === undefined
			? []
			: [
					Subscription.make("members", [organizationId], ([id]) =>
						membersStream(id, (members) => TeamMessage.UpdatedMembers({ members })),
					),
				]
	},
	view: (h, model) => {
		const userId = h.props.session.user?.id
		const current = model.members.find((member) => member.userId === userId)
		const count = model.members.length
		return settingsColumn(
			h,
			"team",
			settingsCard(
				h,
				"team:members",
				{
					title: "Team members",
					subtitle: "Manage your team members and their account permissions here.",
					badge: model.loaded ? `${count} ${count === 1 ? "member" : "members"}` : undefined,
					action: h.button
						.label("Invite user")
						.icon("plus")
						.variant("secondary")
						.on("press", TeamMessage.PressedInvite()),
				},
				h.table
					.key("team:table")
					.label("Team members")
					.columns(COLUMNS)
					// Skeleton rows until the live query answers, so the table never flashes empty.
					.loading(!model.loaded)
					.loadingRows(4)
					.children(...model.members.map((member) => memberRow(h, member, current))),
			),
		)
	},
})
