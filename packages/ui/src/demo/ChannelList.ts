// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The spike's channel list (`apps/ios/effect-ui/ChannelList.ts`) in the `hazel` vocabulary:
 * one component that the web host draws as DOM and the native host sends to SwiftUI.
 */
import { Subscription, UiSchema } from "@effect/ui"
import { Duration, Schema, Stream } from "effect"
import { Hazel } from "../vocabulary/index.ts"
import { ActivityChart, MeshBackground } from "./extensions.ts"

export const Channel = Schema.Struct({
	id: Schema.String,
	title: Schema.String,
	/** `number` for a public channel, `lock` for a private one; absent for a person. */
	symbol: Schema.optionalKey(Schema.String),
	initials: Schema.optionalKey(Schema.String),
	unread: Schema.Finite,
})
export type Channel = typeof Channel.Type

export const Section = Schema.Struct({
	title: Schema.String,
	channels: Schema.Array(Channel),
})
export type Section = typeof Section.Type

export const ChannelListMessage = UiSchema.TaggedEnum({
	PressedChannel: { id: Schema.String },
	ReceivedMessage: { tick: Schema.Finite },
	PressedCreateChannel: { section: Schema.String },
	TappedBackground: {},
})

export const ChannelListProps = Schema.Struct({
	sections: Schema.Array(Section),
	/** Simulated traffic: a message lands on some channel this often (0: never). */
	tickMs: Schema.Finite,
})
export type ChannelListProps = typeof ChannelListProps.Type

export const ChannelList = Hazel.component({
	name: "ChannelList",
	props: ChannelListProps,
	model: Schema.Struct({
		selectedId: Schema.NullOr(Schema.String),
		unread: Schema.Record(Schema.String, Schema.Finite),
		/** Messages received per tick, newest last: what the web-only chart draws. */
		activity: Schema.Array(Schema.Finite),
	}),
	message: ChannelListMessage,
}).make({
	init: ({ props: { sections } }) => ({
		selectedId: null,
		unread: Object.fromEntries(
			sections.flatMap((section) => section.channels.map((channel) => [channel.id, channel.unread])),
		),
		activity: [3, 5, 2, 6, 4, 7, 5, 8],
	}),
	update: {
		PressedChannel: ($, { id }) =>
			$.evolve({ selectedId: id, unread: (unread) => ({ ...unread, [id]: 0 }) }),
		ReceivedMessage: ($, { tick }) => {
			const others = $.props.sections
				.flatMap((section) => section.channels)
				.filter((channel) => channel.id !== $.model.selectedId)
			const channel = others[tick % others.length]
			if (channel === undefined) return $.model
			return $.evolve({
				unread: (unread) => ({ ...unread, [channel.id]: (unread[channel.id] ?? 0) + 1 }),
				activity: (activity) => [...activity.slice(-11), (tick % 7) + 1],
			})
		},
		PressedCreateChannel: ($) => $.model,
		TappedBackground: ($) => $.model,
	},
	subscriptions: ({ props }) => [
		props.tickMs > 0 &&
			Subscription.make(
				"traffic",
				Stream.tick(Duration.millis(props.tickMs)).pipe(
					Stream.scan(
						() => 0,
						(n) => n + 1,
					),
					Stream.drop(1),
					Stream.map((tick) => ChannelListMessage.ReceivedMessage({ tick })),
				),
			),
	],
	view: (h, model) =>
		h.screen.title("Channels").children(
			h
				.extension(MeshBackground, { colors: ["brand.500", "brand.300"], speed: 0.4 })
				.on("Tapped", ChannelListMessage.TappedBackground())
				.fallback(h.text.role("caption").tone("muted").children("Mesh background: drawn on iOS")),
			h
				.extension(ActivityChart, { values: model.activity, color: "brand.500" })
				.fallback(h.text.role("caption").tone("muted").children("Activity chart: drawn on the web")),
			...h.props.sections.map((section) =>
				h.section
					.key(section.title)
					.title(section.title)
					.action(
						h.icon.name("plus"),
						ChannelListMessage.PressedCreateChannel({ section: section.title }),
						`New in ${section.title}`,
					)
					.children(
						...section.channels.map((channel) => {
							const unread = model.unread[channel.id] ?? 0
							const selected = model.selectedId === channel.id
							return (
								h.item
									.key(channel.id)
									.title(channel.title)
									.leading(
										channel.symbol === undefined
											? h.avatar.initials(channel.initials ?? "")
											: h.icon.name(channel.symbol === "lock" ? "lock" : "hashtag"),
									)
									.badge(unread)
									.emphasized(unread > 0)
									.selected(selected)
									// The open channel is not a link to itself: it becomes a button.
									.href(selected ? undefined : `#/chat/${channel.id}`)
									.on("press", ChannelListMessage.PressedChannel({ id: channel.id }))
							)
						}),
					),
			),
		),
})
