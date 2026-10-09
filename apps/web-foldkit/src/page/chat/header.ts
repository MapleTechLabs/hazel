import type { Attribute, ChildAttribute, Html, HtmlBuilder } from "foldkit/html"
import { IconChevronRight, IconEye, IconHashtag, IconPin, IconThread } from "../../icons"
import { AppRoute, hrefOf } from "../../route"
import { avatar } from "../../ui/avatar"
import { button } from "../../ui/button"
import { type AuthorIdentity } from "./rows"
import type { ChannelInfo, ParentChannelInfo } from "./queries"

/** Port of `ChatHeader` (desktop): channel, thread breadcrumb, DM and the not-a-member fallback. */

/** `ChannelIcon`. */
export const channelIcon = <M>(h: HtmlBuilder<M>, icon: string | null, className: string): Html =>
	icon
		? h.span([h.Attribute("data-slot", "icon"), h.Class(className)], [icon])
		: IconHashtag(h, { className })

export interface HeaderInputs {
	readonly channel: ChannelInfo | null
	readonly parentChannel: ParentChannelInfo | null
	/** Null only before the org is known; the parent breadcrumb needs it for its link. */
	readonly orgSlug: string | null
	/** False renders the fallback header (no members row for the signed-in user). */
	readonly isMember: boolean
	/** DM participants other than the signed-in user, in member order. */
	readonly otherMembers: ReadonlyArray<AuthorIdentity>
	readonly isHiddenDm: boolean
	/** The pinned messages trigger (a popover trigger with its overlay). */
	readonly pinnedTrigger: Html
	/** The mobile menu button (`md:hidden`), with an extra className for the fallback header. */
	readonly mobileMenu: (className?: string) => Html
}

const ROW = "flex h-14 shrink-0 items-center justify-between border-border border-b bg-bg px-4"

export const pinnedButton = <M>(
	h: HtmlBuilder<M>,
	attributes: ReadonlyArray<Attribute<M> | ChildAttribute>,
	overlay: Html,
) =>
	button(
		h,
		{
			intent: "plain",
			size: "sm",
			attributes: [h.Attribute("aria-label", "View pinned messages"), ...attributes],
		},
		[IconPin(h, { attributes: { "data-slot": "icon" } }), overlay],
	)

const threadTitle = <M>(h: HtmlBuilder<M>, inputs: HeaderInputs, channel: ChannelInfo): Html =>
	h.div(
		[h.Class("flex items-center gap-2")],
		[
			inputs.parentChannel && channel.parentChannelId && inputs.orgSlug !== null
				? h.a(
						[
							h.Class(
								"flex items-center gap-1.5 text-muted-fg transition-colors hover:text-fg",
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
			IconChevronRight(h, { className: "size-4 shrink-0 text-muted-fg" }),
			h.div(
				[h.Class("flex items-center gap-1.5")],
				[
					IconThread(h, { className: "size-4 shrink-0 text-muted-fg" }),
					h.h2([h.Class("truncate font-semibold text-fg text-sm")], [channel.name]),
				],
			),
		],
	)

const dmTitle = <M>(h: HtmlBuilder<M>, members: ReadonlyArray<AuthorIdentity>): ReadonlyArray<Html> => [
	members[0]
		? avatar(h, {
				size: "sm",
				src: members[0].avatarUrl,
				seed: members[0].displayName || undefined,
				alt: members[0].displayName,
			})
		: h.empty,
	h.div(
		[],
		[
			h.h2(
				[h.Class("font-semibold text-fg text-sm")],
				[
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
				],
			),
		],
	),
]

export const chatHeaderView = <M>(h: HtmlBuilder<M>, inputs: HeaderInputs): Html => {
	const { channel } = inputs
	if (channel === null || !inputs.isMember)
		return h.div(
			[h.Class("flex h-14 shrink-0 items-center border-border border-b bg-bg px-4")],
			[
				inputs.mobileMenu("mr-3"),
				channel
					? h.div(
							[h.Class("flex items-center gap-3")],
							[
								channelIcon(h, channel.icon, "size-5 text-muted-fg"),
								h.h2([h.Class("font-semibold text-fg text-sm")], [channel.name]),
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
				[h.Class("flex items-center gap-3")],
				[
					inputs.mobileMenu(),
					...(channel.type === "thread"
						? [threadTitle(h, inputs, channel)]
						: isDirectMessage
							? dmTitle(h, inputs.otherMembers)
							: [
									channelIcon(h, channel.icon, "size-5 text-muted-fg"),
									h.div(
										[h.Class("flex items-center gap-2")],
										[h.h2([h.Class("font-semibold text-fg text-sm")], [channel.name])],
									),
								]),
				],
			),
			h.div(
				[h.Class("flex items-center gap-2")],
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
