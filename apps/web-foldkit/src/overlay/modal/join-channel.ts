import { ChannelId, OrganizationId, UserId } from "@hazel/schema"
import { eq, inArray, not, or } from "@tanstack/db"
import { Effect, Schema, Stream } from "effect"
import { Command, Submodel, Subscription } from "foldkit"
import * as Dom from "foldkit/dom"
import { defineMessageUnion } from "foldkit/message"
import { modifyFields } from "foldkit/struct"
import { joinChannelAction } from "~/db/actions"
import { channelCollection, channelMemberCollection } from "~/db/collections"
import { liveQueryStream } from "../../data/live-query"
import { IconHashtag } from "../../icons"
import type { Shared } from "../../page/contract"
import { button } from "../../ui/button"
import { dialogBody, dialogFooter, dialogHeader } from "../../ui/dialog"
import { input } from "../../ui/input"
import { runAction, toastForCause } from "../action"
import { closed, completed, ModalOutMessage, successToast } from "../out-message"
import { ToastRequest } from "../toasts"
import * as Requests from "./requests"
import { defineModal, type ModalReturn, type ModalSubscriptionInput, type ModalViewInputs } from "./contract"
import { Frame, FrameMessage, frameView, initFrame, isFrameClosed, modalDescription, modalTitle } from "./frame"

/** `components/modals/join-channel-modal.tsx` (legacy `useModal("join-channel")`). */

const Channel = Schema.Struct({ id: ChannelId, name: Schema.String })

const Model = Schema.Struct({
	frame: Frame,
	searchQuery: Schema.String,
	isSearchFocused: Schema.Boolean,
	memberChannelIds: Schema.NullOr(Schema.Array(ChannelId)),
	unjoinedChannels: Schema.NullOr(Schema.Array(Channel)),
})
type Model = typeof Model.Type

const Message = defineMessageUnion({
	GotFrameMessage: { message: FrameMessage },
	ChangedSearch: { value: Schema.String },
	FocusedSearch: {},
	BlurredSearch: {},
	ClickedJoin: { channelId: ChannelId },
	ClickedClose: {},
	UpdatedMemberChannelIds: { channelIds: Schema.Array(ChannelId) },
	UpdatedUnjoinedChannels: { channels: Schema.Array(Channel) },
	SucceededJoinChannel: {},
	FailedJoinChannel: { toast: ToastRequest },
	CompletedFocusSearch: {},
})
type Message = typeof Message.Type

const SEARCH_ID = "join-channel-modal-search"

const FocusSearch = Command.define("FocusSearch", {
	args: {},
	messages: [Message.CompletedFocusSearch],
	execute: () => Dom.focus(`#${SEARCH_ID}`).pipe(Effect.ignoreCause, Effect.as(Message.CompletedFocusSearch())),
})

const JoinChannel = Command.define("JoinChannel", {
	args: { channelId: ChannelId, userId: UserId },
	messages: [Message.SucceededJoinChannel, Message.FailedJoinChannel],
	execute: ({ channelId, userId }) =>
		runAction(joinChannelAction, { channelId, userId }).pipe(
			Effect.as(Message.SucceededJoinChannel()),
			Effect.catchCause((cause) =>
				Effect.succeed(
					Message.FailedJoinChannel({
						toast: toastForCause(cause, {
							ChannelNotFoundError: {
								title: "Channel not found",
								description: "This channel may have been deleted.",
								isRetryable: false,
							},
						}),
					}),
				),
			),
		),
})

type Return = ModalReturn<Model, Message>

const update = (model: Model, message: Message, shared: Shared): Return =>
	Message.match<Return>(message, {
		// `autoFocus`: after the frame has portaled and focused its dialog.
		GotFrameMessage: ({ message }) =>
			isFrameClosed(model.frame, message)
				? { model, outMessage: closed }
				: message._tag === "CompletedPortalModal"
					? { model, commands: [FocusSearch({})] }
					: { model },
		ChangedSearch: ({ value }) => ({ model: modifyFields(model, { searchQuery: () => value }) }),
		FocusedSearch: () => ({ model: modifyFields(model, { isSearchFocused: () => true }) }),
		BlurredSearch: () => ({ model: modifyFields(model, { isSearchFocused: () => false }) }),
		// Legacy toasts "User not authenticated" without a user; the shell only renders signed in.
		ClickedJoin: ({ channelId }) =>
			shared.currentUser === null
				? { model }
				: { model, commands: [JoinChannel({ channelId, userId: shared.currentUser.id })] },
		ClickedClose: () => ({ model, outMessage: closed }),
		UpdatedMemberChannelIds: ({ channelIds }) => ({ model: modifyFields(model, { memberChannelIds: () => channelIds }) }),
		UpdatedUnjoinedChannels: ({ channels }) => ({ model: modifyFields(model, { unjoinedChannels: () => channels }) }),
		SucceededJoinChannel: () => ({ model, outMessage: completed({ toast: successToast("Successfully joined channel") }) }),
		FailedJoinChannel: ({ toast }) => ({ model, outMessage: ModalOutMessage.RequestedToast({ toast }) }),
		CompletedFocusSearch: () => ({ model }),
	})

const subscriptions = Subscription.make<ModalSubscriptionInput<Model>, Message>()((entry) => ({
	memberChannelIds: entry(
		{ userId: Schema.NullOr(UserId) },
		{
			modelToDependencies: (input) => ({ userId: input.shared.currentUser?.id ?? null }),
			dependenciesToStream: ({ userId }) =>
				userId === null
					? Stream.empty
					: liveQueryStream<{ channelId: ChannelId }, Message>(
							(q) =>
								q
									.from({ m: channelMemberCollection })
									.where(({ m }) => eq(m.userId, userId))
									.select(({ m }) => ({ channelId: m.channelId })),
							(rows) => Message.UpdatedMemberChannelIds({ channelIds: rows.map((row) => row.channelId) }),
						),
		},
	),
	unjoinedChannels: entry(
		{ organizationId: Schema.NullOr(OrganizationId), channelIds: Schema.NullOr(Schema.Array(ChannelId)) },
		{
			modelToDependencies: (input) => ({
				organizationId: input.shared.organization?.id ?? null,
				channelIds: input.model.memberChannelIds,
			}),
			dependenciesToStream: ({ organizationId, channelIds }) =>
				organizationId === null || channelIds === null
					? Stream.empty
					: liveQueryStream<{ id: ChannelId; name: string }, Message>(
							(q) => {
								const base = q
									.from({ channel: channelCollection })
									.where(({ channel }) => or(eq(channel.type, "public"), eq(channel.type, "private")))
									.where(({ channel }) => eq(channel.organizationId, organizationId))
								return (
									channelIds.length === 0
										? base
										: base.where(({ channel }) => not(inArray(channel.id, [...channelIds])))
								).select(({ channel }) => ({ ...channel }))
							},
							(rows) => Message.UpdatedUnjoinedChannels({ channels: rows.map(({ id, name }) => ({ id, name })) }),
						),
		},
	),
}))

const view = Submodel.defineView<Model, Message, ModalViewInputs>((model, _inputs, h) => {
	const query = model.searchQuery.toLowerCase()
	const filtered = (model.unjoinedChannels ?? []).filter((channel) => channel.name.toLowerCase().includes(query))
	const emptyText = model.searchQuery
		? "No channels found matching your search"
		: model.unjoinedChannels?.length === 0
			? "You've already joined all available channels"
			: "No channels available to join"
	return frameView(
		h,
		model.frame,
		{ size: "lg" },
		() => [
			dialogHeader(h, {}, [
				modalTitle(h, model.frame, "Browse Channels"),
				modalDescription(h, "Join a public channel in your organization"),
			]),
			dialogBody(
				h,
				[
					input(h, {
						placeholder: "Search channels...",
						attributes: [
							h.Id(SEARCH_ID),
							...(model.isSearchFocused ? [h.Attribute("data-focused", "true")] : []),
							h.Value(model.searchQuery),
							h.OnInput((value) => Message.ChangedSearch({ value })),
							h.OnFocus(Message.FocusedSearch()),
							h.OnBlur(Message.BlurredSearch()),
						],
					}),
					h.div(
						[h.Class("max-h-[400px] overflow-y-auto")],
						[
							filtered.length === 0
								? h.div(
										[h.Class("flex flex-col items-center justify-center py-8 text-center")],
										[
											IconHashtag(h, { className: "mb-3 size-12 text-muted-fg" }),
											h.p([h.Class("text-muted-fg text-sm")], [emptyText]),
										],
									)
								: h.div(
										[h.Class("space-y-2")],
										filtered.map((channel) =>
											h.keyed("div")(
												channel.id,
												[
													h.Class(
														"flex items-center justify-between rounded-lg border border-border p-3 transition-colors hover:bg-secondary",
													),
												],
												[
													h.div(
														[h.Class("flex items-center gap-3")],
														[
															IconHashtag(h, { className: "size-5 text-muted-fg" }),
															h.div([h.Class("font-medium")], [channel.name]),
														],
													),
													button(
														h,
														{ size: "sm", intent: "primary", onPress: Message.ClickedJoin({ channelId: channel.id }) },
														["Join"],
													),
												],
											),
										),
									),
						],
					),
				],
				"flex flex-col gap-4",
			),
			dialogFooter(h, [button(h, { intent: "outline", onPress: Message.ClickedClose() }, ["Close"])]),
		],
		(message) => Message.GotFrameMessage({ message }),
	)
})

export const modal = defineModal(
	"JoinChannel",
	{ request: Requests.JoinChannel, Model, Message },
	{
		init: () => ({
			model: {
				frame: initFrame("join-channel-modal"),
				searchQuery: "",
				isSearchFocused: false,
				memberChannelIds: null,
				unjoinedChannels: null,
			},
		}),
		update,
		view,
		subscriptions,
	},
)
