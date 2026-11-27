// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The channel settings layout's header (`channels/$channelId/settings/layout.tsx`): back to the
 * channel, the channel's icon and name, and the tabs, each a page of its own.
 */
import { Subscription, UiSchema } from "@effect/ui"
import { ChannelId } from "@hazel/schema"
import { Hazel } from "@hazel/ui/vocabulary/index"
import { Schema } from "effect"
import { Navigate } from "../app/requests"
import { ChannelSummary, channelStream } from "./queries"

export const ChannelSettingsTab = Schema.Struct({
	id: Schema.String,
	label: Schema.String,
	href: Schema.String,
})
export type ChannelSettingsTab = typeof ChannelSettingsTab.Type

export const ChannelSettingsHeaderProps = Schema.Struct({
	channelId: ChannelId,
	/** The channel's own page, where "Back to channel" goes. */
	channelHref: Schema.String,
	tabs: Schema.Array(ChannelSettingsTab),
	selected: Schema.String,
})
export type ChannelSettingsHeaderProps = typeof ChannelSettingsHeaderProps.Type

const HeaderMessage = UiSchema.TaggedEnum({
	UpdatedChannel: { channel: Schema.NullOr(ChannelSummary) },
	ChangedTab: { id: Schema.String },
})

export const ChannelSettingsHeader = Hazel.component({
	name: "ChannelSettingsHeader",
	props: ChannelSettingsHeaderProps,
	model: Schema.Struct({ channel: Schema.NullOr(ChannelSummary) }),
	message: HeaderMessage,
}).make({
	init: () => ({ channel: null }),
	update: {
		UpdatedChannel: ($, { channel }) => $.evolve({ channel: () => channel }),
		ChangedTab: ($, { id }) => {
			const tab = $.props.tabs.find((candidate) => candidate.id === id)
			return tab === undefined || id === $.props.selected
				? $.model
				: $.run(Navigate.make({ href: tab.href, replace: false }))
		},
	},
	subscriptions: ({ props }) => [
		Subscription.make("channel", [props.channelId], ([channelId]) =>
			channelStream(ChannelId.make(channelId), (channel) => HeaderMessage.UpdatedChannel({ channel })),
		),
	],
	view: (h, model) => {
		const { channel } = model
		// Today's 40px secondary tile; an emoji icon has no tile (HAZEL-GAP(channel-settings-icon-tile)), and
		// the customer, partner and sync marks need the root's channel links (HAZEL-GAP(channel-settings-links)).
		const icon = channel?.icon
			? h.channelIcon.private(channel.type === "private").emoji(channel.icon)
			: h.iconTile.name(channel?.type === "private" ? "lock" : "hashtag")
		// HAZEL-GAP(back-link): today's muted "Back to channel" with a leading arrow; `link` is the accent text link.
		return h.stack.children(
			h.link.label("Back to channel").href(h.props.channelHref),
			h.stack
				.axis("horizontal")
				.align("center")
				.children(
					icon,
					h.stack
						.density("tight")
						.children(
							h.heading.level("1").children(channel?.name ?? "Channel"),
							h.text.role("label").tone("muted").children("Channel settings"),
						),
				),
			h.tabBar
				.style("page")
				.tabs(h.props.tabs.map((tab) => ({ id: tab.id, label: tab.label, href: tab.href })))
				.selected(h.props.selected)
				.on("change", ({ id }) => HeaderMessage.ChangedTab({ id })),
		)
	},
})
