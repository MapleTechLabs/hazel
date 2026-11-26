/**
 * Re-exports `@hazel/shared-screens/customers/data/channels` at its old path, bound to the app's `clientData`, and keeps the
 * channel mark (a Foldkit view).
 */
import { type ChannelOption, makeChannelData } from "@hazel/shared-screens/customers/data/channels"
import type { Html, HtmlBuilder } from "foldkit/html"
import { clientData } from "~/db/client"
import { IconHashtag, IconLock } from "../icons"
import { discordLogo, slackLogo } from "../page/settings/chat-sync/brand-icons"

export * from "@hazel/shared-screens/customers/data/channels"

export const {
	channelOptionsStream,
	channelLinksStream,
	channelCustomerStream,
	optimisticLinkAction,
	linkChannelAction,
	unlinkChannelAction,
} = makeChannelData(clientData)

// VIEW

/** The channel's mark: its platform's logo, or `#` / a lock for a Hazel or Connect channel. */
export const channelMark = <Message>(
	h: HtmlBuilder<Message>,
	channel: Pick<ChannelOption, "origin" | "isPrivate">,
	className = "size-3.5",
): Html => {
	switch (channel.origin) {
		case "slack":
			return slackLogo(h, `${className} shrink-0`)
		case "discord":
			return discordLogo(h, `${className} shrink-0`)
		default:
			return (channel.isPrivate ? IconLock : IconHashtag)(h, {
				className: `${className} shrink-0 text-muted-fg`,
			})
	}
}
