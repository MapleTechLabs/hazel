// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The `hazel` channel list on live data (G3): the same sections and rows as the demo `ChannelList`
 * (`packages/ui/src/demo/ChannelList.ts`), fed by a stream of sections from `@hazel/client-data`.
 */
import { Subscription, UiSchema } from "@effect/ui"
import { Schema, Stream } from "effect"
import { Section } from "../../../packages/ui/src/demo/ChannelList.ts"
import { Hazel } from "../../../packages/ui/src/vocabulary/index.ts"

export const LiveChannelListMessage = UiSchema.TaggedEnum({
	ReceivedSections: { sections: Schema.Array(Section) },
	PressedChannel: { id: Schema.String },
	PressedCreateChannel: { section: Schema.String },
})

/** A channel list over `sections`, which emits the whole sidebar on every change. */
export const makeLiveChannelList = (sections: Stream.Stream<ReadonlyArray<Section>>) =>
	Hazel.component({
		name: "LiveChannelList",
		props: Schema.Struct({}),
		model: Schema.Struct({
			selectedId: Schema.NullOr(Schema.String),
			sections: Schema.Array(Section),
		}),
		message: LiveChannelListMessage,
	}).make({
		init: () => ({ selectedId: null, sections: [] }),
		update: {
			ReceivedSections: ($, { sections }) => $.evolve({ sections: () => sections }),
			PressedChannel: ($, { id }) => $.evolve({ selectedId: () => id }),
			PressedCreateChannel: ($) => $.model,
		},
		subscriptions: () => [
			Subscription.make(
				"sidebar",
				Stream.map(sections, (next) => LiveChannelListMessage.ReceivedSections({ sections: next })),
			),
		],
		view: (h, model) =>
			h.screen.title("Channels").children(
				...(model.sections.length === 0
					? [h.text.role("caption").tone("muted").children("Connecting…")]
					: model.sections.map((section) =>
							h.section
								.key(section.title)
								.title(section.title)
								.action(
									h.icon.name("plus"),
									LiveChannelListMessage.PressedCreateChannel({ section: section.title }),
									`New in ${section.title}`,
								)
								.children(
									...section.channels.map((channel) => {
										const selected = model.selectedId === channel.id
										return h.item
											.key(channel.id)
											.title(channel.title)
											.leading(
												channel.symbol === undefined
													? h.avatar.initials(channel.initials ?? "")
													: h.icon.name(channel.symbol === "lock" ? "lock" : "hashtag"),
											)
											.badge(channel.unread)
											.emphasized(channel.unread > 0)
											.selected(selected)
											.href(selected ? undefined : `#/chat/${channel.id}`)
											.on("press", LiveChannelListMessage.PressedChannel({ id: channel.id }))
									}),
								),
						)),
			),
	})
