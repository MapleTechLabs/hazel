// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * A channel's details on a phone (Slack's): its icon and name, then a row for each settings page,
 * each pushed with the system's back. The web shows the same pages as tabs under its own header
 * (`shell/ChannelSettingsHeader`), which keeps its "Back to channel" link.
 */
import { Subscription, UiSchema } from "@effect/ui"
import { ChannelId } from "@hazel/schema"
import { Hazel } from "@hazel/ui/vocabulary/index"
import type { IconName } from "@hazel/ui/vocabulary/options"
import { Schema } from "effect"
import { AppRoute, hrefOf } from "../app/route"
import { ChannelSummary, channelStream } from "../shell/queries"

export const ChannelDetailsProps = Schema.Struct({ orgSlug: Schema.String, channelId: ChannelId })
export type ChannelDetailsProps = typeof ChannelDetailsProps.Type

const DetailsMessage = UiSchema.TaggedEnum({ UpdatedChannel: { channel: Schema.NullOr(ChannelSummary) } })

interface Row {
	readonly title: string
	readonly subtitle: string
	readonly href: string
	readonly icon: IconName
}

/** The settings pages, in the web's tab order (`channelSettingsTabsOf`). */
export const detailRowsOf = (orgSlug: string, channelId: ChannelId): ReadonlyArray<Row> => [
	{
		title: "Overview",
		subtitle: "Name, icon and customer",
		href: hrefOf(AppRoute.ChannelSettingsOverview({ orgSlug, channelId })),
		icon: "gear",
	},
	{
		title: "Integrations",
		subtitle: "Apps posting here",
		href: hrefOf(AppRoute.ChannelSettingsIntegrations({ orgSlug, channelId })),
		icon: "integration",
	},
	{
		title: "Connect",
		subtitle: "Share with another workspace",
		href: hrefOf(AppRoute.ChannelSettingsConnect({ orgSlug, channelId })),
		icon: "connect",
	},
]

export const ChannelDetails = Hazel.component({
	name: "ChannelDetails",
	props: ChannelDetailsProps,
	model: Schema.Struct({ channel: Schema.NullOr(ChannelSummary) }),
	message: DetailsMessage,
}).make({
	init: () => ({ channel: null }),
	update: {
		UpdatedChannel: ($, { channel }) => $.evolve({ channel: () => channel }),
	},
	subscriptions: ({ props }) => [
		Subscription.make("channel", [props.channelId], ([channelId]) =>
			channelStream(ChannelId.make(channelId), (channel) => DetailsMessage.UpdatedChannel({ channel })),
		),
	],
	view: (h, model) => {
		const { channel } = model
		const name = channel?.name ?? "Channel"
		return h.stack
			.key("details")
			.density("relaxed")
			.children(
				h.stack
					.key("header")
					.axis("horizontal")
					.density("cozy")
					.align("center")
					.children(
						h.channelIcon
							.tile(true)
							.private(channel?.type === "private")
							.emoji(channel?.icon ?? undefined),
						h.stack.density("none").children(
							h.heading.level("1").size("large").children(name),
							h.text
								.role("label")
								.tone("muted")
								.children(channel?.type === "private" ? "Private channel" : "Public channel"),
						),
					),
				h.section
					.key("pages")
					.style("list")
					.children(
						...detailRowsOf(h.props.orgSlug, h.props.channelId).map((row) =>
							h.item
								.key(row.href)
								.title(row.title)
								.subtitle(row.subtitle)
								.href(row.href)
								.leading(h.icon.name(row.icon))
								.trailing(h.icon.name("chevron-right")),
						),
					),
			)
	},
})
