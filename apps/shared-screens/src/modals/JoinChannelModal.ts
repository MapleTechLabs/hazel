// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * Browse channels (today's `overlay/modal/join-channel.ts`, legacy `join-channel-modal.tsx`): the
 * organization's channels the user is not in, searchable, each with Join.
 */
import { Command, Component, Subscription, UiSchema } from "@effect/ui"
import { ChannelId, OrganizationId, UserId } from "@hazel/schema"
import { Hazel, TextField } from "@hazel/ui/vocabulary/index"
import { and, eq, inArray } from "@tanstack/db"
import { Cause, Effect, Option, Schema, Stream } from "effect"
import { liveQuery } from "../app/live"
import { Session } from "../app/session"
import { copyOf, errorToast, ModalEvents, reasonOf, successToast, toast } from "./feedback"
import { modalServices } from "./services"

export const JoinChannelProps = Schema.Struct({ session: Session })
export type JoinChannelProps = typeof JoinChannelProps.Type

export const BrowsedChannel = Schema.Struct({ id: ChannelId, name: Schema.String })
export type BrowsedChannel = typeof BrowsedChannel.Type

export const JoinChannelModel = Schema.Struct({
	search: TextField.State,
	/** The channels the user is a member of; null until loaded. */
	memberChannelIds: Schema.NullOr(Schema.Array(ChannelId)),
	/** The organization's public and private channels; null until loaded. */
	channels: Schema.NullOr(Schema.Array(BrowsedChannel)),
})
export type JoinChannelModel = typeof JoinChannelModel.Type

export const JoinChannelMessage = UiSchema.TaggedEnum({
	ChangedSearch: { payload: TextField.ChangePayload },
	UpdatedMemberChannels: { channelIds: Schema.Array(ChannelId) },
	UpdatedChannels: { channels: Schema.Array(BrowsedChannel) },
	PressedJoin: { channelId: ChannelId },
	PressedClose: {},
	DismissedDialog: {},
	SucceededJoinChannel: {},
	FailedJoinChannel: {},
})
export type JoinChannelMessage = typeof JoinChannelMessage.Type

const notFound = { title: "Channel not found", description: "This channel may have been deleted." }

/** Joins the channel; the toast is the Command's, so it shows after the modal closed too. */
export class JoinChannel extends Command.Service<JoinChannel>()("hazel/modals/JoinChannel", {
	args: { channelId: ChannelId, userId: UserId },
	success: JoinChannelMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.map(
			modalServices,
			({ data, run }) =>
				(args) =>
					run(
						data.actions.joinChannelAction(args).pipe(
							Effect.andThen(toast(successToast("Successfully joined channel"))),
							Effect.as(JoinChannelMessage.SucceededJoinChannel()),
							Effect.catchTags({
								ChannelNotFoundError: () =>
									toast(errorToast(notFound)).pipe(
										Effect.as(JoinChannelMessage.FailedJoinChannel()),
									),
							}),
							// BOUNDARY: every other failure reads as its common reason.
							Effect.catchCause((cause) =>
								toast(
									errorToast(copyOf(reasonOf(Option.getOrUndefined(Cause.findErrorOption(cause))), {})),
								).pipe(Effect.as(JoinChannelMessage.FailedJoinChannel())),
							),
						),
					),
		),
	)
}

const memberChannels = (userId: UserId) =>
	liveQuery<{ readonly channelId: ChannelId }, JoinChannelMessage>(
		(data) => (q) =>
			q
				.from({ member: data.collections.channelMemberCollection })
				.where(({ member }) => eq(member.userId, userId))
				.select(({ member }) => ({ channelId: member.channelId })),
		(rows) => JoinChannelMessage.UpdatedMemberChannels({ channelIds: rows.map((row) => row.channelId) }),
	)

const organizationChannels = (organizationId: OrganizationId) =>
	liveQuery<BrowsedChannel, JoinChannelMessage>(
		(data) => (q) =>
			q
				.from({ channel: data.collections.channelCollection })
				.where(({ channel }) =>
					and(eq(channel.organizationId, organizationId), inArray(channel.type, ["public", "private"])),
				)
				.select(({ channel }) => ({ id: channel.id, name: channel.name })),
		(rows) => JoinChannelMessage.UpdatedChannels({ channels: rows.map(({ id, name }) => ({ id, name })) }),
	)

/** The channels to offer: loaded, not joined, matching the search. */
export const browsable = (model: JoinChannelModel): ReadonlyArray<BrowsedChannel> | null => {
	if (model.channels === null || model.memberChannelIds === null) return null
	const joined = new Set<string>(model.memberChannelIds)
	return model.channels.filter((channel) => !joined.has(channel.id))
}

const emptyText = (model: JoinChannelModel, unjoined: ReadonlyArray<BrowsedChannel> | null) =>
	model.search.text !== ""
		? "No channels found matching your search"
		: unjoined?.length === 0
			? "You've already joined all available channels"
			: "No channels available to join"

const close = ModalEvents.RequestedClose()

export const JoinChannelModalNoDeps = Hazel.component({
	name: "JoinChannelModal",
	props: JoinChannelProps,
	model: JoinChannelModel,
	message: JoinChannelMessage,
	events: ModalEvents,
}).make({
	init: () => ({ search: TextField.empty, memberChannelIds: null, channels: null }),
	update: {
		ChangedSearch: ($, { payload }) => $.evolve({ search: (search) => TextField.changed(search, payload) }),
		UpdatedMemberChannels: ($, { channelIds }) => $.evolve({ memberChannelIds: channelIds }),
		UpdatedChannels: ($, { channels }) => $.evolve({ channels }),
		// The shell renders only signed in; without a user there is nobody to join.
		PressedJoin: ($, { channelId }) => {
			const user = $.props.session.user
			return user === null ? $.model : $.run(JoinChannel.make({ channelId, userId: user.id }))
		},
		PressedClose: ($) => $.emit(close),
		DismissedDialog: ($) => $.emit(close),
		SucceededJoinChannel: ($) => $.emit(close),
		FailedJoinChannel: ($) => $.model,
	},
	subscriptions: ({ props }) => [
		Subscription.make("memberChannels", [props.session.user?.id ?? null], ([userId]) =>
			userId === null ? Stream.empty : memberChannels(userId),
		),
		Subscription.make("channels", [props.session.organization?.id ?? null], ([organizationId]) =>
			organizationId === null ? Stream.empty : organizationChannels(organizationId),
		),
	],
	view: (h, model) => {
		const unjoined = browsable(model)
		const query = model.search.text.toLowerCase()
		const shown = (unjoined ?? []).filter((channel) => channel.name.toLowerCase().includes(query))
		return h.dialog
			.open(true)
			.title("Browse channels")
			.description("Join a public channel in your organization")
			.on("dismiss", JoinChannelMessage.DismissedDialog())
			.children(
				h.searchField
					.placeholder("Search channels...")
					.value(model.search)
					.on("change", (payload) => JoinChannelMessage.ChangedSearch({ payload })),
				shown.length === 0
					? h.emptyState.title(emptyText(model, unjoined)).icon("hashtag")
					: // HAZEL-GAP(p4-join-row-card): today each row is its own bordered card, 8px apart, in a 400px scroll.
						h.list.children(
							...shown.map((channel) =>
								h.item
									.key(channel.id)
									.title(channel.name)
									.leading(h.icon.name("hashtag"))
									.trailing(
										h.button
											.label("Join")
											.size("small")
											.on("press", JoinChannelMessage.PressedJoin({ channelId: channel.id })),
									),
							),
						),
			)
			.actions(h.button.label("Close").variant("outline").on("press", JoinChannelMessage.PressedClose()))
	},
})

export const JoinChannelModal = JoinChannelModalNoDeps.pipe(Component.provide(JoinChannel.layer))
