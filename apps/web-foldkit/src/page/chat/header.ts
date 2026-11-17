import type { Attribute, ChildAttribute, Html, HtmlBuilder } from "foldkit/html"
import { IconChevronRight, IconEye, IconHashtag, IconPin, IconThread } from "../../icons"
import { AppRoute, hrefOf } from "../../route"
import { avatar, type AvatarProps } from "../../ui/avatar"
import { button } from "../../ui/button"
import { presenceDot } from "../../ui/presence-dot"
import type { PresenceStatus } from "~/utils/presence"
import { type AuthorIdentity } from "./rows"
import type { ChannelInfo, ParentChannelInfo } from "./queries"
import { heading } from "../../ui/heading"
import { discordLogo, slackLogo } from "../settings/chat-sync/brand-icons"
import type { SyncProvider } from "./lookups"

/** Port of `ChatHeader` (desktop): channel, thread breadcrumb, DM and the not-a-member fallback. */

/** `ChannelIcon`. */
export const channelIcon = <M>(h: HtmlBuilder<M>, icon: string | null, className: string): Html =>
	icon
		? h.span([h.Attribute("data-slot", "icon"), h.Class(className)], [icon])
		: IconHashtag(h, { className })

/** The channel's icon with the Slack or Discord mark in its corner when chat sync bridges it. */
const syncedChannelIcon = <M>(
	h: HtmlBuilder<M>,
	icon: string | null,
	provider: SyncProvider | null,
): Html => {
	const base = channelIcon(h, icon, "size-5 text-muted-fg")
	if (provider === null) return h.span([h.Class("shrink-0")], [base])
	return h.span(
		[h.Class("relative shrink-0")],
		[
			base,
			h.span(
				[
					h.Class(
						"absolute -right-1 -bottom-0.5 flex size-3.5 items-center justify-center rounded-full bg-bg",
					),
					h.Attribute("title", provider === "slack" ? "Synced with Slack" : "Synced with Discord"),
				],
				[provider === "slack" ? slackLogo(h, "size-2.5") : discordLogo(h, "size-3")],
			),
		],
	)
}

export interface HeaderInputs {
	readonly channel: ChannelInfo | null
	/** The platform chat sync bridges the channel to, marked on its icon; null when it is not synced. */
	readonly syncProvider: SyncProvider | null
	readonly parentChannel: ParentChannelInfo | null
	/** Null only before the org is known; the parent breadcrumb needs it for its link. */
	readonly orgSlug: string | null
	/** False renders the fallback header (no members row for the signed-in user). */
	readonly isMember: boolean
	/** DM participants other than the signed-in user, in member order. */
	readonly otherMembers: ReadonlyArray<AuthorIdentity>
	readonly isHiddenDm: boolean
	/** The partner's presence in a one-on-one DM with a person; null otherwise (group DMs, bots). */
	readonly dmPresence: PresenceStatus | null
	/** The pinned messages trigger (a popover trigger with its overlay). */
	readonly pinnedTrigger: Html
	/** A phone's back button (`md:hidden`) to the chat list, or a thread's channel; empty elsewhere. */
	readonly mobileBack: Html
}

const ROW = "flex h-14 shrink-0 items-center justify-between border-border border-b bg-bg px-4"

export const pinnedButton = <M>(
	h: HtmlBuilder<M>,
	attributes: ReadonlyArray<Attribute<M> | ChildAttribute>,
) =>
	button(
		h,
		{
			intent: "plain",
			size: "sm",
			attributes: [h.Attribute("aria-label", "View pinned messages"), ...attributes],
		},
		[IconPin(h, { attributes: { "data-slot": "icon" } })],
	)

/** On a phone the back button leads to the parent channel, so the breadcrumb shows the thread alone. */
const threadTitle = <M>(h: HtmlBuilder<M>, inputs: HeaderInputs, channel: ChannelInfo): Html =>
	h.div(
		[h.Class("flex min-w-0 items-center gap-2")],
		[
			inputs.parentChannel && channel.parentChannelId && inputs.orgSlug !== null
				? h.a(
						[
							h.Class(
								"flex items-center gap-1.5 text-muted-fg transition-colors hover:text-fg max-md:hidden",
							),
							h.Href(
								hrefOf(
									AppRoute.ChatChannel({
										orgSlug: inputs.orgSlug,
										channelId: channel.parentChannelId,
									}),
								),
							),
						],
						[
							channelIcon(h, inputs.parentChannel.icon, "size-4"),
							h.span([h.Class("text-sm")], [inputs.parentChannel.name]),
						],
					)
				: h.empty,
			IconChevronRight(h, { className: "size-4 shrink-0 text-muted-fg max-md:hidden" }),
			h.div(
				[h.Class("flex min-w-0 items-center gap-1.5")],
				[
					IconThread(h, { className: "size-4 shrink-0 text-muted-fg" }),
					heading(h, { variant: "subsection", level: 2, className: "truncate" }, [channel.name]),
				],
			),
		],
	)

const dmAvatar = <M>(h: HtmlBuilder<M>, member: AuthorIdentity, presence: PresenceStatus | null): Html => {
	const props = {
		size: "sm",
		src: member.avatarUrl,
		seed: member.displayName || undefined,
		alt: member.displayName,
	} satisfies AvatarProps
	if (presence === null) return avatar(h, props)
	return avatar(h, { ...props, badge: presenceDot(h, presence, "sm") })
}

const dmTitle = <M>(
	h: HtmlBuilder<M>,
	members: ReadonlyArray<AuthorIdentity>,
	presence: PresenceStatus | null,
): ReadonlyArray<Html> => [
	members[0] ? dmAvatar(h, members[0], presence) : h.empty,
	h.div(
		[h.Class("max-md:min-w-0")],
		[
			heading(h, { variant: "subsection", level: 2, className: "max-md:truncate" }, [
				...(members.length > 0
					? members
							.slice(0, 3)
							.map((member, index) =>
								h.span([], [...(index > 0 ? [", "] : []), member.displayName]),
							)
					: ["Direct Message"]),
				" ",
				...(members.length > 3
					? [
							h.span(
								[h.Class("font-normal text-muted-fg text-xs")],
								[` +${members.length - 3} more`],
							),
						]
					: []),
			]),
		],
	),
]

export const chatHeaderView = <M>(h: HtmlBuilder<M>, inputs: HeaderInputs): Html => {
	const { channel } = inputs
	if (channel === null || !inputs.isMember)
		return h.div(
			[h.Class("flex h-14 shrink-0 items-center border-border border-b bg-bg px-4")],
			[
				inputs.mobileBack,
				channel
					? h.div(
							[h.Class("flex items-center gap-3 max-md:min-w-0")],
							[
								channelIcon(h, channel.icon, "size-5 text-muted-fg max-md:shrink-0"),
								heading(
									h,
									{ variant: "subsection", level: 2, className: "max-md:truncate" },
									[channel.name],
								),
							],
						)
					: h.div([h.Class("h-4 w-32 animate-pulse rounded-sm bg-secondary")]),
			],
		)
	const isDirectMessage = channel.type === "direct" || channel.type === "single"
	return h.div(
		[h.Class(ROW)],
		[
			h.div(
				[h.Class("flex min-w-0 items-center gap-3")],
				[
					inputs.mobileBack,
					...(channel.type === "thread"
						? [threadTitle(h, inputs, channel)]
						: isDirectMessage
							? dmTitle(h, inputs.otherMembers, inputs.dmPresence)
							: [
									syncedChannelIcon(h, channel.icon, inputs.syncProvider),
									h.div(
										[h.Class("flex items-center gap-2 max-md:min-w-0")],
										[
											heading(
												h,
												{ variant: "subsection", level: 2, className: "truncate" },
												[channel.name],
											),
										],
									),
								]),
				],
			),
			h.div(
				[h.Class("flex items-center gap-2 max-md:shrink-0")],
				[
					isDirectMessage && inputs.isHiddenDm
						? button(
								h,
								{
									intent: "plain",
									attributes: [h.Attribute("aria-label", "Unhide conversation")],
								},
								[IconEye(h, {})],
							)
						: h.empty,
					inputs.pinnedTrigger,
				],
			),
		],
	)
}
