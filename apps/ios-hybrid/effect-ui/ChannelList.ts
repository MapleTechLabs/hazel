// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The channel list (spike): the web sidebar's semantic screen (`web-foldkit/src/shell/channels-sidebar`)
 * as an Effect UI component. It is plain `Html` with the same `data-ui` annotations, so a browser
 * would draw it and the native host reads it.
 */
import { Subscription, UiSchema } from "@effect/ui"
import { Html } from "@effect/ui/html"
import { Duration, Schema, Stream } from "effect"

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
})

/** What `data-ui` / `data-ui-props` carry (`web-foldkit/src/ui/semantic.ts`). */
const semantic = (kind: string, props: Record<string, unknown>) => ({
	"data-ui": kind,
	"data-ui-props": JSON.stringify(props),
})

export const ChannelList = Html.component({
	name: "ChannelList",
	props: Schema.Struct({
		sections: Schema.Array(Section),
		/** Simulated traffic: a message lands on some channel this often (0: never). */
		tickMs: Schema.Finite,
	}),
	model: Schema.Struct({
		selectedId: Schema.NullOr(Schema.String),
		unread: Schema.Record(Schema.String, Schema.Finite),
	}),
	message: ChannelListMessage,
}).make({
	init: ({ props: { sections } }) => ({
		selectedId: null,
		unread: Object.fromEntries(
			sections.flatMap((section) => section.channels.map((channel) => [channel.id, channel.unread])),
		),
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
			})
		},
		PressedCreateChannel: ($) => $.model,
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
		h.nav
			.attrs(semantic("screen", { title: "Channels" }))
			.class("flex flex-col")
			.children(
				...h.props.sections.map((section) =>
					h.div
						.key(section.title)
						.attrs(semantic("section", { title: section.title }))
						.class("flex flex-col gap-y-0.5 p-4")
						.children(
							h.button
								.attrs(
									semantic("action", { label: `New in ${section.title}`, symbol: "plus" }),
								)
								.on(
									"click",
									ChannelListMessage.PressedCreateChannel({ section: section.title }),
								)
								.children("+"),
							...section.channels.map((channel) => {
								const unread = model.unread[channel.id] ?? 0
								return h.a
									.key(channel.id)
									.attrs(
										semantic("item", {
											title: channel.title,
											...(channel.symbol === undefined
												? { avatar: { url: null, initials: channel.initials ?? "" } }
												: { symbol: channel.symbol }),
											...(unread > 0 ? { badge: unread, isEmphasized: true } : {}),
											...(model.selectedId === channel.id ? { isSelected: true } : {}),
										}),
									)
									.attr("href", `#/chat/${channel.id}`)
									.class("flex items-center gap-2 rounded-lg px-2 py-1.5")
									.on("click", ChannelListMessage.PressedChannel({ id: channel.id }))
									.children(channel.title)
							}),
						),
				),
			),
})
