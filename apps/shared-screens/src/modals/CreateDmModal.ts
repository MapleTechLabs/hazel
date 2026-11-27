// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * Start a conversation (the deleted Foldkit `overlay/modal/create-dm*.ts`, legacy `create-dm-modal.tsx`): pick
 * one or more people; an existing DM with exactly them opens, else one is created and opened.
 */
import { Command, Component, Subscription, UiSchema } from "@effect/ui"
import { ClientData, HazelRpc } from "@hazel/client-data"
import { ChannelId, OrganizationId, UserId } from "@hazel/schema"
import { Hazel, TextField } from "@hazel/ui/vocabulary/index"
import { and, eq } from "@tanstack/db"
import { Cause, Effect, Option, Schema, Stream } from "effect"
import { liveQuery } from "../app/live"
import { Session } from "../app/session"
import {
	channelHref,
	copyOf,
	errorToast,
	ModalEvents,
	navigate,
	reasonOf,
	successToast,
	toast,
} from "./feedback"
import { modalServices } from "./services"

export const OrgUser = Schema.Struct({
	id: UserId,
	firstName: Schema.String,
	lastName: Schema.String,
	avatarUrl: Schema.NullOr(Schema.String),
	online: Schema.Boolean,
	customMessage: Schema.NullOr(Schema.String),
})
export type OrgUser = typeof OrgUser.Type

export const CreateDmProps = Schema.Struct({ session: Session })
export type CreateDmProps = typeof CreateDmProps.Type

export const CreateDmModel = Schema.Struct({
	search: TextField.State,
	selected: Schema.Array(UserId),
	users: Schema.Array(OrgUser),
	submitting: Schema.Boolean,
})
export type CreateDmModel = typeof CreateDmModel.Type

export const CreateDmMessage = UiSchema.TaggedEnum({
	ChangedSearch: { payload: TextField.ChangePayload },
	PressedUser: { userId: UserId },
	UpdatedUsers: { users: Schema.Array(OrgUser) },
	PressedStart: {},
	PressedCancel: {},
	DismissedDialog: {},
	SucceededStartConversation: {},
	FailedStartConversation: {},
})
export type CreateDmMessage = typeof CreateDmMessage.Type

export const fullName = (user: OrgUser) => `${user.firstName} ${user.lastName}`.trim()

/** `findExistingDmChannel` (legacy `lib/channels.ts`): a DM in the org with exactly these people. */
export const existingDm = (
	data: ClientData["Service"],
	organizationId: OrganizationId,
	currentUserId: UserId,
	targetIds: ReadonlyArray<UserId>,
): ChannelId | null => {
	const members = new Map<string, Array<string>>()
	for (const member of data.collections.channelMemberCollection.state.values())
		members.set(member.channelId, [...(members.get(member.channelId) ?? []), member.userId])
	const participants = [currentUserId, ...targetIds].sort()
	for (const channel of data.collections.channelCollection.state.values()) {
		if (channel.organizationId !== organizationId) continue
		const ids = members.get(channel.id) ?? []
		const isSingle =
			channel.type === "single" &&
			targetIds.length === 1 &&
			ids.length === 2 &&
			ids.includes(currentUserId) &&
			ids.includes(targetIds[0] ?? "")
		const isGroup =
			channel.type === "direct" &&
			targetIds.length > 1 &&
			ids.length === participants.length &&
			[...ids].sort().every((id, index) => id === participants[index])
		if (isSingle || isGroup) return channel.id
	}
	return null
}

/** Opens the DM, creating it first when none exists; the toast and the link are the Command's. */
export class StartConversation extends Command.Service<StartConversation>()(
	"hazel/modals/StartConversation",
	{
		args: {
			organizationId: OrganizationId,
			orgSlug: Schema.String,
			currentUserId: UserId,
			participantIds: Schema.Array(UserId),
			name: Schema.NullOr(Schema.String),
			/** The success toast, for a DM that had to be created. */
			created: Schema.String,
		},
		success: CreateDmMessage,
	},
) {
	static readonly layer = this.toLayer(
		Effect.map(
			modalServices,
			({ data, run }) =>
				({ organizationId, orgSlug, currentUserId, participantIds, name, created }) =>
					run(
						Effect.gen(function* () {
							const existing = existingDm(data, organizationId, currentUserId, participantIds)
							if (existing !== null) return yield* navigate(channelHref(orgSlug, existing))
							const client = yield* HazelRpc
							const result = yield* client("channel.createDm", {
								organizationId,
								participantIds: [...participantIds],
								type: participantIds.length === 1 ? "single" : "direct",
								name: name ?? undefined,
							})
							yield* navigate(channelHref(orgSlug, result.data.id))
							yield* toast(successToast(created))
						}).pipe(
							Effect.as(CreateDmMessage.SucceededStartConversation()),
							// BOUNDARY: every failure reads as its common reason.
							Effect.catchCause((cause) =>
								toast(
									errorToast(
										copyOf(
											reasonOf(Option.getOrUndefined(Cause.findErrorOption(cause))),
											{},
										),
									),
								).pipe(Effect.as(CreateDmMessage.FailedStartConversation())),
							),
						),
					),
		),
	)
}

/** `organizationUsers`: the org's human users with their presence. */
const organizationUsers = (organizationId: OrganizationId) =>
	liveQuery<
		{
			readonly id: UserId
			readonly firstName: string
			readonly lastName: string
			readonly avatarUrl?: string | null
			readonly status?: string | null
			readonly customMessage?: string | null
		},
		CreateDmMessage
	>(
		(data) => (q) =>
			q
				.from({ member: data.collections.organizationMemberCollection })
				.innerJoin({ user: data.collections.userCollection }, ({ member, user }) =>
					eq(member.userId, user.id),
				)
				.leftJoin({ presence: data.collections.userPresenceStatusCollection }, ({ user, presence }) =>
					eq(user.id, presence.userId),
				)
				.where(({ member, user }) =>
					and(eq(member.organizationId, organizationId), eq(user.userType, "user")),
				)
				.select(({ user, presence }) => ({
					id: user.id,
					firstName: user.firstName,
					lastName: user.lastName,
					avatarUrl: user.avatarUrl,
					status: presence?.status,
					customMessage: presence?.customMessage,
				})),
		(rows) =>
			CreateDmMessage.UpdatedUsers({
				users: rows.map((row) => ({
					id: row.id,
					firstName: row.firstName ?? "",
					lastName: row.lastName ?? "",
					avatarUrl: row.avatarUrl ?? null,
					online: row.status === "online",
					customMessage: row.customMessage ?? null,
				})),
			}),
	)

/** `filteredUsers`: everyone but the signed-in user, matched on first, last or full name. */
export const filteredUsers = (model: CreateDmModel, currentUserId: UserId | undefined) => {
	const others = model.users.filter((user) => user.id !== currentUserId)
	const query = model.search.text.trim().toLowerCase()
	if (query === "") return others
	return others.filter((user) =>
		[user.firstName, user.lastName, fullName(user)].some((name) => name.toLowerCase().includes(query)),
	)
}

const close = ModalEvents.RequestedClose()

const initialsOf = (user: OrgUser) =>
	`${user.firstName.charAt(0)}${user.lastName.charAt(0)}`.toUpperCase() || "?"

export const CreateDmModalNoDeps = Hazel.component({
	name: "CreateDmModal",
	props: CreateDmProps,
	model: CreateDmModel,
	message: CreateDmMessage,
	events: ModalEvents,
	restore: (model) => ({ ...model, submitting: false }),
}).make({
	init: () => ({ search: TextField.empty, selected: [], users: [], submitting: false }),
	update: {
		ChangedSearch: ($, { payload }) =>
			$.evolve({ search: (search) => TextField.changed(search, payload) }),
		PressedUser: ($, { userId }) =>
			$.evolve({
				selected: (ids) =>
					ids.includes(userId) ? ids.filter((id) => id !== userId) : [...ids, userId],
			}),
		UpdatedUsers: ($, { users }) => $.evolve({ users }),
		PressedStart: ($) => {
			const { user, organization, orgSlug } = $.props.session
			const ids = $.model.selected
			if (
				ids.length === 0 ||
				$.model.submitting ||
				user === null ||
				organization === null ||
				orgSlug === null
			)
				return $.model
			const picked = $.model.users.filter((candidate) => ids.includes(candidate.id))
			const names = picked
				.map((candidate) => candidate.firstName)
				.slice(0, 3)
				.join(", ")
			const first = $.model.users.find((candidate) => candidate.id === ids[0])
			return $.evolve({ submitting: true }).run(
				StartConversation.make({
					organizationId: organization.id,
					orgSlug,
					currentUserId: user.id,
					participantIds: ids,
					name: ids.length === 1 ? null : names,
					created:
						ids.length === 1
							? `Started conversation with ${first?.firstName}`
							: `Created group conversation with ${ids.length} people`,
				}),
			)
		},
		PressedCancel: ($) => $.emit(close),
		DismissedDialog: ($) => $.emit(close),
		SucceededStartConversation: ($) => $.emit(close),
		FailedStartConversation: ($) => $.evolve({ submitting: false }),
	},
	subscriptions: ({ props }) => [
		Subscription.make("users", [props.session.organization?.id ?? null], ([organizationId]) =>
			organizationId === null ? Stream.empty : organizationUsers(organizationId),
		),
	],
	view: (h, model) => {
		const users = filteredUsers(model, h.props.session.user?.id)
		const selected = model.users.filter((user) => model.selected.includes(user.id))
		const avatar = (user: OrgUser) =>
			h.avatar
				.name(fullName(user))
				.initials(initialsOf(user))
				.src(user.avatarUrl ?? undefined)
		return (
			h.dialog
				.open(true)
				// HAZEL-GAP(p4-dialog-icon): today's header leads with a primary icon tile (messages) beside the title.
				.title("Start a conversation")
				.description("Select one or more team members to start a conversation")
				.on("dismiss", CreateDmMessage.DismissedDialog())
				.children(
					h.searchField
						.placeholder("Search team members...")
						.value(model.search)
						.on("change", (payload) => CreateDmMessage.ChangedSearch({ payload })),
					selected.length === 0
						? null
						: h.stack
								.axis("horizontal")
								.align("center")
								.density("compact")
								.children(
									h.text
										.role("caption")
										.tone("muted")
										.children(`${selected.length} selected`),
									h.avatarStack
										.overflow(selected.length > 3 ? selected.length - 3 : 0)
										.children(
											...selected.slice(0, 3).map((user) => avatar(user).key(user.id)),
										),
								),
					users.length === 0
						? h.emptyState.title(
								model.search.text !== "" ? "No users found" : "No team members available",
							)
						: h.list.children(
								...users.map((user) => {
									const isSelected = model.selected.includes(user.id)
									return (
										h.item
											.key(user.id)
											.title(fullName(user))
											// HAZEL-GAP(p4-item-subtitle-tone): today's "Active now" is success-green; subtitles are muted.
											.subtitle(user.online ? "Active now" : (user.customMessage ?? ""))
											// HAZEL-GAP(p4-item-check): today a picked row also rings in primary and ends in a check.
											.selected(isSelected)
											// HAZEL-GAP(p4-item-avatar-small): today's row avatar is the kit's `sm` (32px).
											.leading(avatar(user))
											.on("press", CreateDmMessage.PressedUser({ userId: user.id }))
									)
								}),
							),
				)
				.actions(
					h.button
						.label("Cancel")
						.variant("outline")
						.disabled(model.submitting)
						.on("press", CreateDmMessage.PressedCancel()),
					h.button
						.label(
							model.submitting
								? "Creating..."
								: selected.length > 1
									? `Start group conversation (${selected.length})`
									: "Start conversation",
						)
						.disabled(model.submitting || selected.length === 0)
						.on("press", CreateDmMessage.PressedStart()),
				)
		)
	},
})

export const CreateDmModal = CreateDmModalNoDeps.pipe(Component.provide(StartConversation.layer))
