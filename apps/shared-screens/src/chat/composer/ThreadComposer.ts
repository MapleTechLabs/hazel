// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The thread panel's composer: follows the open panel's thread (`ComposerHost.thread`) and draws a
 * `ChannelComposer` for it, keyed by the thread, so another thread starts its own draft. While the
 * thread is still being created its sends wait (`ready`).
 */
import { Subscription, UiSchema } from "@effect/ui"
import { OrganizationId, UserId } from "@hazel/schema"
import { Hazel } from "@hazel/ui/vocabulary/index"
import { Effect, Schema, Stream } from "effect"
import { ChannelComposer } from "./ChannelComposer"
import { ComposerHost, ThreadTarget } from "./host"

export const ThreadComposerProps = Schema.Struct({ organizationId: OrganizationId, userId: UserId })

export const ThreadComposerModel = Schema.Struct({ thread: Schema.NullOr(ThreadTarget) })

export const ThreadComposerMessage = UiSchema.TaggedEnum({
	ChangedThread: { thread: Schema.NullOr(ThreadTarget) },
})

export const ThreadComposer = Hazel.component({
	name: "ThreadComposer",
	props: ThreadComposerProps,
	model: ThreadComposerModel,
	message: ThreadComposerMessage,
}).make({
	init: () => ({ thread: null }),
	update: { ChangedThread: ($, { thread }) => $.evolve({ thread }) },
	subscriptions: () => [
		Subscription.make("thread", [], () =>
			Stream.unwrap(
				Effect.map(Effect.service(ComposerHost), (host) =>
					host.thread.pipe(Stream.map((thread) => ThreadComposerMessage.ChangedThread({ thread }))),
				),
			),
		),
	],
	view: (h, model) =>
		h.stack.children(
			model.thread === null
				? null
				: ChannelComposer(h, {
					key: model.thread.threadChannelId,
					props: {
						channelId: model.thread.threadChannelId,
						organizationId: h.props.organizationId,
						userId: h.props.userId,
						placeholder: "Reply in thread...",
						ready: model.thread.ready,
						autoFocus: true,
					},
				}),
		),
})
