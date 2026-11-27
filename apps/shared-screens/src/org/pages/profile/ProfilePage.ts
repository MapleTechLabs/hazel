// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * `/:org/profile/:userId` (`web-foldkit/src/page/profile`, now deleted): a member's name, avatar,
 * presence and email; your own has "Edit profile".
 */
import { Subscription, UiSchema } from "@effect/ui"
import { UserId } from "@hazel/schema"
import { Hazel, TextField } from "@hazel/ui/vocabulary/index"
import { eq } from "@tanstack/db"
import { Match, Schema } from "effect"
import { initialsOf } from "../../../activity/format"
import { liveQuery } from "../../../app/live"
import { Navigate } from "../../../app/requests"
import { Session } from "../../../app/session"
import { getEffectivePresenceStatus, type PresenceStatus } from "../../../lib/utils/presence"
import { getStatusLabel } from "../../../lib/utils/status"
import { pageHeader } from "../../components/PageHeader"

export const ProfileUser = Schema.Struct({
	firstName: Schema.String,
	lastName: Schema.String,
	email: Schema.String,
	avatarUrl: Schema.NullOr(Schema.String),
	/** The stored presence status; null when the user has no presence row (offline). */
	presenceStatus: Schema.NullOr(Schema.String),
})
export type ProfileUser = typeof ProfileUser.Type

export const ProfileMessage = UiSchema.TaggedEnum({
	/** The live query's row; null when no such user. */
	UpdatedUser: { user: Schema.NullOr(ProfileUser) },
	PressedEditProfile: {},
})
export type ProfileMessage = typeof ProfileMessage.Type

export const ProfileProps = Schema.Struct({
	userId: UserId,
	session: Session,
	/** "Edit profile": the host's my-settings profile page. */
	editHref: Schema.String,
})
export type ProfileProps = typeof ProfileProps.Type

export const ProfileModel = Schema.Struct({
	loaded: Schema.Boolean,
	user: Schema.NullOr(ProfileUser),
})
export type ProfileModel = typeof ProfileModel.Type

interface ProfileRow {
	readonly user: {
		readonly firstName: string
		readonly lastName: string
		readonly email: string
		readonly avatarUrl?: string | null
	}
	readonly presence?: { readonly status?: string | null } | undefined
}

/** The user with their stored presence (`userWithPresenceAtomFamily`). */
const userStream = (userId: UserId) =>
	liveQuery<ProfileRow, ProfileMessage>(
		({ collections: c }) =>
			(q) =>
				q
					.from({ user: c.userCollection })
					.leftJoin({ presence: c.userPresenceStatusCollection }, ({ user, presence }) =>
						eq(user.id, presence.userId),
					)
					.where((row) => eq(row.user.id, userId))
					.select(({ user, presence }) => ({ user, presence })),
		(rows) => {
			const row = rows[0]
			return ProfileMessage.UpdatedUser({
				user:
					row === undefined
						? null
						: {
								firstName: row.user.firstName,
								lastName: row.user.lastName,
								email: row.user.email,
								avatarUrl: row.user.avatarUrl ?? null,
								presenceStatus: row.presence?.status ?? null,
							},
			})
		},
	)

/** The avatar's dot; `dnd` draws as `busy`, as the DMs tab does. */
const dotOf = (status: PresenceStatus) =>
	Match.value(status).pipe(
		Match.when("online", () => "online" as const),
		Match.when("away", () => "away" as const),
		Match.whenOr("busy", "dnd", () => "busy" as const),
		Match.orElse(() => "offline" as const),
	)

/** Today's badge intent (`getStatusBadgeIntent`); `secondary` is the neutral tone. */
const toneOf = (status: PresenceStatus) =>
	Match.value(status).pipe(
		Match.when("online", () => "success" as const),
		Match.whenOr("away", "busy", () => "warning" as const),
		Match.when("dnd", () => "danger" as const),
		Match.orElse(() => "neutral" as const),
	)

const ProfileDef = Hazel.component({
	name: "ProfilePage",
	props: ProfileProps,
	model: ProfileModel,
	message: ProfileMessage,
})

type H = Parameters<Parameters<typeof ProfileDef.make>[0]["view"]>[0]

const profile = (h: H, user: ProfileUser) => {
	const { session, userId, editHref } = h.props
	const isOwn = session.user?.id === userId
	const fullName = `${user.firstName} ${user.lastName}`
	const status = getEffectivePresenceStatus(
		user.presenceStatus === null ? null : { status: user.presenceStatus },
	)
	// HAZEL-GAP(p4-screen-page-column): today's column is `px-4 lg:px-8 py-6`; `page` pads 16pt all round.
	return h.stack
		.key("profile")
		.density("relaxed")
		.inset("page")
		.children(
			pageHeader(
				h,
				{
					title: "Profile",
					subtitle: isOwn
						? "View your profile information."
						: `View ${user.firstName}'s profile information.`,
				},
				isOwn
					? h.button
							.label("Edit profile")
							.icon("edit")
							.variant("secondary")
							.on("press", ProfileMessage.PressedEditProfile())
					: null,
			),
			h.stack.density("relaxed").children(
				h.stack
					.axis("horizontal")
					.align("center")
					.density("regular")
					.children(
						h.avatar
							.name(fullName)
							.initials(initialsOf(fullName))
							.src(user.avatarUrl ?? undefined)
							.presence(dotOf(status))
							.size("xlarge"),
						h.stack
							.density("snug")
							.align("start")
							.children(
								h.heading.level("2").children(fullName),
								// HAZEL-GAP(p4-badge-dot): today's pill leads with the status dot.
								h.badge.label(getStatusLabel(status)).tone(toneOf(status)).pill(),
							),
					),
				// HAZEL-GAP(p4-field-prefix-icon): today's field leads with the envelope glyph.
				// HAZEL-GAP(p4-page-max-width): today's column under the header is `max-w-xl`.
				h.textField
					.label("Email address")
					.inputKind("email")
					.value(TextField.set(TextField.empty, user.email))
					.disabled(),
			),
		)
}

export const ProfilePage = ProfileDef.make({
	init: () => ({ loaded: false, user: null }),
	update: {
		UpdatedUser: ($, { user }) => $.set({ loaded: true, user }),
		PressedEditProfile: ($) => $.run(Navigate.make({ href: $.props.editHref, replace: false })),
	},
	subscriptions: ({ props }) => [
		Subscription.make("user", [props.userId], ([userId]) => userStream(userId)),
	],
	view: (h, model) =>
		!model.loaded
			? h.progress.key("loading").style("spinner").label("Loading...")
			: model.user === null
				? h.emptyState.key("not-found").title("User not found")
				: profile(h, model.user),
})
