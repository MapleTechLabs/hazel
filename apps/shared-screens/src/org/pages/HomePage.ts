// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * `/:org` (`web-foldkit/src/page/home`, now deleted): the organization's member directory, searched
 * by name or email, each member with Message and a menu (Message, View profile, Copy email).
 */
import { Command, Subscription, UiSchema } from "@effect/ui"
import { ClientData } from "@hazel/client-data"
import { Clipboard } from "@hazel/client-data/platform"
import { ChannelId, OrganizationId, UserId } from "@hazel/schema"
import { Hazel, TextField } from "@hazel/ui/vocabulary/index"
import { eq } from "@tanstack/db"
import { Effect, Match, Schema } from "effect"
import { initialsOf } from "../../activity/format"
import { liveQuery } from "../../app/live"
import { CreateDm, Navigate, ShowToast } from "../../app/requests"
import { Session } from "../../app/session"
import { existingDm } from "../../modals/CreateDmModal"
import { pageHeader } from "../components/PageHeader"

export const DirectoryMember = Schema.Struct({
	id: UserId,
	firstName: Schema.String,
	lastName: Schema.String,
	email: Schema.String,
	avatarUrl: Schema.NullOr(Schema.String),
	role: Schema.Literals(["owner", "admin", "member"]),
	/** The stored presence status; the directory shows it raw, without the staleness rule. */
	presenceStatus: Schema.NullOr(Schema.String),
})
export type DirectoryMember = typeof DirectoryMember.Type

export const HomeMessage = UiSchema.TaggedEnum({
	UpdatedMembers: { members: Schema.Array(DirectoryMember) },
	ChangedSearch: { payload: TextField.ChangePayload },
	PressedMessage: { userId: UserId },
	SelectedMemberAction: { userId: UserId, id: Schema.String },
	/** The user's DM with the member, when one exists. */
	FoundDm: { userId: UserId, channelId: Schema.NullOr(ChannelId) },
	CopiedEmail: { email: Schema.String },
	FailedCopyEmail: {},
})
export type HomeMessage = typeof HomeMessage.Type

export const HomeProps = Schema.Struct({
	session: Session,
	/** A phone: rows have no Message button (the menu has it). */
	isMobile: Schema.Boolean,
})
export type HomeProps = typeof HomeProps.Type

export const HomeModel = Schema.Struct({
	/** Null until the query is ready. */
	members: Schema.NullOr(Schema.Array(DirectoryMember)),
	search: TextField.State,
})
export type HomeModel = typeof HomeModel.Type

/** The user's DM with `userId` in the organization (`findExistingDmChannel`), read from the synced rows. */
export class FindMemberDm extends Command.Service<FindMemberDm>()("hazel/home/FindMemberDm", {
	args: { organizationId: OrganizationId, currentUserId: UserId, userId: UserId },
	success: HomeMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const data = yield* ClientData
			return ({ organizationId, currentUserId, userId }) =>
				Effect.sync(() =>
					HomeMessage.FoundDm({
						userId,
						channelId: existingDm(data, organizationId as OrganizationId, currentUserId, [
							userId,
						]),
					}),
				)
		}),
	)
}

/** `handleCopyEmail`, through the platform's clipboard. */
export class CopyEmail extends Command.Service<CopyEmail>()("hazel/home/CopyEmail", {
	args: { email: Schema.String },
	success: HomeMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const clipboard = yield* Clipboard
			return ({ email }) =>
				clipboard.write(email).pipe(
					Effect.match({
						onSuccess: () => HomeMessage.CopiedEmail({ email }),
						onFailure: () => HomeMessage.FailedCopyEmail(),
					}),
				)
		}),
	)
}

interface MemberRow {
	readonly id: UserId
	readonly firstName: string
	readonly lastName: string
	readonly email: string
	readonly avatarUrl?: string | null
	readonly role: DirectoryMember["role"]
	readonly presence?: { readonly status?: string | null } | undefined
}

/** The organization's people (not bots), with their stored presence. */
const membersStream = (organizationId: OrganizationId) =>
	liveQuery<MemberRow, HomeMessage>(
		({ collections: c }) =>
			(q) =>
				q
					.from({ member: c.organizationMemberCollection })
					.where(({ member }) => eq(member.organizationId, organizationId))
					.innerJoin({ user: c.userCollection }, ({ member, user }) => eq(member.userId, user.id))
					.leftJoin({ presence: c.userPresenceStatusCollection }, ({ user, presence }) =>
						eq(user.id, presence.userId),
					)
					.where(({ user }) => eq(user.userType, "user"))
					.select(({ member, user, presence }) => ({ ...user, role: member.role, presence })),
		(rows) =>
			HomeMessage.UpdatedMembers({
				members: rows.map((row) => ({
					id: row.id,
					firstName: row.firstName,
					lastName: row.lastName,
					email: row.email,
					avatarUrl: row.avatarUrl ?? null,
					role: row.role,
					presenceStatus: row.presence?.status || null,
				})),
			}),
	)

/** A case-insensitive match on the full name or the email. */
export const filterMembers = (members: ReadonlyArray<DirectoryMember>, query: string) => {
	const search = query.toLowerCase()
	return search === ""
		? members
		: members.filter(
				(member) =>
					`${member.firstName} ${member.lastName}`.toLowerCase().includes(search) ||
					member.email.toLowerCase().includes(search),
			)
}

const fullNameOf = (member: DirectoryMember) => `${member.firstName} ${member.lastName}`.trim()

/** The raw status's dot: none without a row, `dnd` as `busy`. */
const dotOf = (status: string | null) =>
	Match.value(status).pipe(
		Match.when(null, () => "none" as const),
		Match.when("online", () => "online" as const),
		Match.when("away", () => "away" as const),
		Match.whenOr("busy", "dnd", () => "busy" as const),
		Match.orElse(() => "offline" as const),
	)

const capitalize = (role: string) => role.charAt(0).toUpperCase() + role.slice(1)

const MEMBER_ENTRIES = [
	{
		entries: [
			{ id: "message", label: "Message", icon: "messages" as const },
			{ id: "view-profile", label: "View profile", icon: "user" as const },
			{ id: "copy-email", label: "Copy email", icon: "copy" as const },
		],
	},
]

const HomeDef = Hazel.component({
	name: "HomePage",
	props: HomeProps,
	model: HomeModel,
	message: HomeMessage,
})

type H = Parameters<Parameters<typeof HomeDef.make>[0]["view"]>[0]

const memberRow = (h: H, member: DirectoryMember) => {
	const name = fullNameOf(member)
	const isCurrentUser = h.props.session.user?.id === member.id
	// HAZEL-GAP(p4-item-title-meta): today's title is the name, a muted `·` and the role in muted 12pt
	// (an admin's with a crown); the role joins the title here.
	const title = `${name || "Unknown user"} · ${capitalize(member.role)}${member.role === "admin" ? " \u{1F451}" : ""}`
	return (
		h.item
			.key(member.id)
			.title(title)
			.subtitle(member.email)
			// HAZEL-GAP(p4-item-avatar-small): today's row is `px-3 py-2` with a 36pt avatar; `large` is 40pt.
			.leadingSize("large")
			.leading(
				h.avatar
					.name(name || "User")
					.initials(initialsOf(name || "User"))
					.src(member.avatarUrl ?? undefined)
					.presence(dotOf(member.presenceStatus))
					.size("medium"),
			)
			// HAZEL-GAP(p4-item-actions-visible): today's Message and menu buttons show at rest on a wide
			// screen; `actions` shows them on hover or focus (always on touch).
			.actions(
				...(isCurrentUser
					? []
					: [
							h.props.isMobile
								? null
								: h.button
										.label(`Message ${name}`)
										.icon("messages")
										.iconOnly()
										.variant("ghost")
										.size("small")
										.on("press", HomeMessage.PressedMessage({ userId: member.id })),
							h.menu
								.label("Member actions")
								.entries(MEMBER_ENTRIES)
								.trigger(
									h.button
										.label("Member actions")
										.icon("dots")
										.iconOnly()
										.variant("ghost")
										.size("small"),
								)
								.on("select", ({ id }) =>
									HomeMessage.SelectedMemberAction({ userId: member.id, id }),
								),
						]),
			)
	)
}

const memberList = (h: H, model: HomeModel) => {
	if (model.members === null) return h.progress.key("loading").style("spinner").label("Loading...")
	const listed = filterMembers(model.members, model.search.text)
	if (listed.length === 0)
		return h.emptyState
			.key("empty")
			.title(
				model.search.text === ""
					? "No members in this organization"
					: "No members found matching your search",
			)
	// The `large` row's own padding stands in for today's 8pt gap between rows.
	return h.stack
		.key("members")
		.density("tight")
		.children(...listed.map((member) => memberRow(h, member)))
}

/** Message: the existing DM, else the app creates one (and its toast) and opens it. */
const openDm = ($: { readonly props: HomeProps; readonly model: HomeModel }, userId: UserId) => {
	const { organization, user } = $.props.session
	if (organization === null || user === null) return null
	return FindMemberDm.make({ organizationId: organization.id, currentUserId: user.id, userId })
}

export const HomePage = HomeDef.make({
	init: () => ({ members: null, search: TextField.empty }),
	update: {
		UpdatedMembers: ($, { members }) => $.evolve({ members: () => members }),
		ChangedSearch: ($, { payload }) =>
			$.evolve({ search: (search) => TextField.changed(search, payload) }),
		PressedMessage: ($, { userId }) => {
			const find = openDm($, userId)
			return find === null ? $.model : $.run(find)
		},
		SelectedMemberAction: ($, { userId, id }) => {
			const member = $.model.members?.find((entry) => entry.id === userId)
			const { orgSlug } = $.props.session
			if (member === undefined) return $.model
			return Match.value(id).pipe(
				Match.when("message", () => {
					const find = openDm($, userId)
					return find === null ? $.model : $.run(find)
				}),
				Match.when("view-profile", () =>
					orgSlug === null
						? $.model
						: $.run(Navigate.make({ href: `/${orgSlug}/profile/${userId}`, replace: false })),
				),
				Match.when("copy-email", () => $.run(CopyEmail.make({ email: member.email }))),
				Match.orElse(() => $.model),
			)
		},
		FoundDm: ($, { userId, channelId }) => {
			const { organization, orgSlug } = $.props.session
			const member = $.model.members?.find((entry) => entry.id === userId)
			if (organization === null || orgSlug === null || member === undefined) return $.model
			return channelId !== null
				? $.run(Navigate.make({ href: `/${orgSlug}/chat/${channelId}`, replace: false }))
				: $.run(
						CreateDm.make({
							organizationId: organization.id,
							orgSlug,
							userId,
							name: fullNameOf(member),
						}),
					)
		},
		CopiedEmail: ($, { email }) =>
			$.run(
				ShowToast.make({
					toast: {
						intent: "success",
						title: "Email copied",
						description: `${email} copied to clipboard`,
					},
				}),
			),
		FailedCopyEmail: ($) =>
			$.run(
				ShowToast.make({
					toast: {
						intent: "error",
						title: "Failed to copy email",
						description: "Please try again",
					},
				}),
			),
	},
	subscriptions: ({ props }) => {
		const organizationId = props.session.organization?.id ?? null
		return organizationId === null
			? []
			: [Subscription.make("members", [organizationId], ([id]) => membersStream(id))]
	},
	view: (h, model) =>
		// HAZEL-GAP(p4-screen-page-column): today's column is `px-4 lg:px-8 py-6`; `page` pads 16pt all round.
		h.stack
			.key("home")
			.density("relaxed")
			.inset("page")
			.children(
				pageHeader(h, {
					title: "Members",
					subtitle: "Explore your organization and connect with fellow members.",
				}),
				// HAZEL-GAP(p4-field-autofocus): today's search takes focus on arrival on a wide screen.
				h.searchField
					.placeholder("Search members...")
					.value(model.search)
					.on("change", (payload) => HomeMessage.ChangedSearch({ payload })),
				memberList(h, model),
			),
})
