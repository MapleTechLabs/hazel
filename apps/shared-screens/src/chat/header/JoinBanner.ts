// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * What a channel shows someone who is not in it (today's `ChannelJoinBanner`, `page/chat/banners.ts`):
 * the channel, a line that this is a preview, and "Join #name". Joining is optimistic: the
 * membership arrives at once and the channel page gives way to the list and the composer.
 */
import { Command, Subscription, UiSchema } from "@effect/ui"
import { ClientData, HazelRpc } from "@hazel/client-data"
import { ChannelId, UserId } from "@hazel/schema"
import { Hazel } from "@hazel/ui/vocabulary/index"
import { Effect, Layer, Schema } from "effect"
import { ShowToast } from "../../app/requests"
import { HeaderChannel } from "./model"
import { channelStream } from "./queries"

export const JoinBannerMessage = UiSchema.TaggedEnum({
	UpdatedChannel: { channel: Schema.NullOr(HeaderChannel) },
	PressedJoin: {},
	SucceededJoin: {},
	FailedJoin: { reason: Schema.Literals(["NotFound", "Other"]) },
})
export type JoinBannerMessage = typeof JoinBannerMessage.Type

export const JoinBannerProps = Schema.Struct({ channelId: ChannelId, userId: UserId })
export type JoinBannerProps = typeof JoinBannerProps.Type

export const JoinBannerModel = Schema.Struct({
	channel: Schema.NullOr(HeaderChannel),
	isJoining: Schema.Boolean,
})
export type JoinBannerModel = typeof JoinBannerModel.Type

/** `channelMember.create`, optimistic. */
export class JoinChannel extends Command.Service<JoinChannel>()("hazel/chat/header/JoinChannel", {
	args: { channelId: ChannelId, userId: UserId },
	success: JoinBannerMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const data = yield* ClientData
			const rpc = yield* HazelRpc
			return (args) =>
				data.actions.joinChannelAction(args).pipe(
					Effect.provideService(HazelRpc, rpc),
					Effect.as(JoinBannerMessage.SucceededJoin()),
					Effect.tapError((error) => Effect.logWarning("join channel failed", error)),
					Effect.catch((error) =>
						Effect.succeed(
							JoinBannerMessage.FailedJoin({
								reason: error._tag === "ChannelNotFoundError" ? "NotFound" : "Other",
							}),
						),
					),
				)
		}),
	)
}

export const JoinBanner = Hazel.component({
	name: "JoinBanner",
	props: JoinBannerProps,
	model: JoinBannerModel,
	message: JoinBannerMessage,
}).make({
	init: () => ({ channel: null, isJoining: false }),
	update: {
		UpdatedChannel: ($, { channel }) => $.evolve({ channel: () => channel }),
		PressedJoin: ($) =>
			$.model.isJoining
				? $.model
				: $.evolve({ isJoining: () => true }).run(
						JoinChannel.make({ channelId: $.props.channelId, userId: $.props.userId }),
					),
		SucceededJoin: ($) =>
			$.evolve({ isJoining: () => false }).run(
				ShowToast.make({
					toast: { intent: "success", title: "Successfully joined channel", description: null },
				}),
			),
		FailedJoin: ($, { reason }) =>
			$.evolve({ isJoining: () => false }).run(
				ShowToast.make({
					toast:
						reason === "NotFound"
							? {
									intent: "error",
									title: "Channel not found",
									description: "This channel may have been deleted.",
								}
							: {
									intent: "error",
									title: "Something went wrong",
									description: "Please try again.",
								},
				}),
			),
	},
	subscriptions: ({ props }) => [
		Subscription.make("channel", [props.channelId], ([channelId]) =>
			channelStream(channelId, (channel) => JoinBannerMessage.UpdatedChannel({ channel })),
		),
	],
	view: (h, model) => {
		const channel = model.channel
		if (channel === null) return h.stack
		// HAZEL-GAP(p4-empty-channel-icon): today's banner leads with the channel's icon on a 64px tile.
		return h.emptyState
			.title(channel.name)
			.description("You're previewing this channel. Join to start chatting.")
			.icon(channel.type === "private" ? "lock" : "hashtag")
			.action(
				h.button
					.label(`Join #${channel.name}`)
					.size("large")
					.loading(model.isJoining)
					.on("press", JoinBannerMessage.PressedJoin()),
			)
	},
})

export const joinBannerLayer = (data: ClientData["Service"], rpc: HazelRpc["Service"]) =>
	JoinChannel.layer.pipe(
		Layer.provideMerge(Layer.mergeAll(Layer.succeed(ClientData, data), Layer.succeed(HazelRpc, rpc))),
	)
