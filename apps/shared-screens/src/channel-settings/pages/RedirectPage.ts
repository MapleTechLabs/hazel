// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * `/:org/channels/:channelId/settings` (the deleted Foldkit `page/channel-settings/redirect`): the
 * route's `beforeLoad` sends it on to the Overview tab, replacing the history entry. Draws nothing.
 */
import { Subscription, UiSchema, View } from "@effect/ui"
import { Hazel } from "@hazel/ui/vocabulary/index"
import { Schema, Stream } from "effect"
import { Navigate } from "../../app/requests"

export const RedirectProps = Schema.Struct({ overviewHref: Schema.String })

const RedirectMessage = UiSchema.TaggedEnum({ Mounted: {} })

export const RedirectPage = Hazel.component({
	name: "ChannelSettingsRedirect",
	props: RedirectProps,
	model: Schema.Struct({}),
	message: RedirectMessage,
}).make({
	init: () => ({}),
	update: {
		Mounted: ($) => $.run(Navigate.make({ href: $.props.overviewHref, replace: true })),
	},
	// One message as the page mounts: the navigation runs once per target.
	subscriptions: ({ props }) => [
		Subscription.make("redirect", [props.overviewHref], () => Stream.make(RedirectMessage.Mounted())),
	],
	view: () => View.text(""),
})
