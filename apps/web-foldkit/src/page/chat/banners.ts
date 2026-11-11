import type { Html, HtmlBuilder } from "foldkit/html"
import { IconHashtag } from "../../icons"
import { button } from "../../ui/button"
import type { ChannelMemberInfo, TypingInfo, UserInfo } from "./lookups"
import type { ChannelInfo } from "./queries"

/** `ChannelJoinBanner` and `TypingIndicator`. */

export interface JoinBannerInputs<M> {
	readonly isJoining: boolean
	readonly onJoin: M
}

export const joinBannerView = <M>(
	h: HtmlBuilder<M>,
	channel: ChannelInfo | null,
	inputs: JoinBannerInputs<M>,
): Html =>
	channel === null
		? h.empty
		: h.div(
				[h.Class("flex flex-1 flex-col items-center justify-center gap-6 p-8")],
				[
					h.div(
						[h.Class("flex flex-col items-center gap-3")],
						[
							h.div(
								[
									h.Class(
										"flex size-16 items-center justify-center rounded-2xl bg-secondary text-3xl text-muted-fg",
									),
								],
								[
									channel.icon
										? h.span([], [channel.icon])
										: IconHashtag(h, { className: "size-8" }),
								],
							),
							h.div(
								[h.Class("flex flex-col items-center gap-1")],
								[
									h.h2([h.Class("font-semibold text-fg text-xl")], [channel.name]),
									h.p(
										[h.Class("max-w-sm text-center text-muted-fg text-sm")],
										["You're previewing this channel. Join to start chatting."],
									),
								],
							),
						],
					),
					button(
						h,
						{
							intent: "primary",
							size: "lg",
							onPress: inputs.onJoin,
							isPending: inputs.isJoining,
						},
						["Join #", channel.name],
					),
				],
			)

const STALE_THRESHOLD_MS = 6000

/** `useTypingIndicators`: fresh indicators of other members, resolved to users. */
export const typingUsersOf = (
	typing: ReadonlyArray<TypingInfo>,
	members: ReadonlyArray<ChannelMemberInfo> | null,
	users: ReadonlyArray<UserInfo>,
	currentUserId: string | null,
	nowMs: number,
): ReadonlyArray<UserInfo> => {
	if (members === null || typing.length === 0) return []
	const currentMember = members.find((member) => member.userId === currentUserId)
	const threshold = nowMs - STALE_THRESHOLD_MS
	return typing.flatMap((indicator) => {
		if (indicator.lastTyped < threshold) return []
		if (currentMember && indicator.memberId === currentMember.id) return []
		const member = members.find((m) => m.id === indicator.memberId)
		const user = member ? users.find((u) => u.id === member.userId) : undefined
		return user ? [user] : []
	})
}

const DOT = "inline-block size-1.5 animate-bounce rounded-full bg-muted-fg"

/** The typing users' first names, reusing `previous` when they did not change (the composer's memo reads it). */
export const typingNamesOf = (previous: ReadonlyArray<string>, typingUsers: ReadonlyArray<UserInfo>) => {
	const next = typingUsers.map((user) => user.firstName)
	return next.length === previous.length && next.every((name, index) => name === previous[index])
		? previous
		: next
}

/** A polite live region that is always there, so screen readers announce who starts typing. */
export const typingIndicatorView = <M>(h: HtmlBuilder<M>, firstNames: ReadonlyArray<string>): Html => {
	const text =
		firstNames.length === 1
			? `${firstNames[0]} is typing...`
			: firstNames.length === 2
				? `${firstNames[0]} and ${firstNames[1]} are typing...`
				: `${firstNames[0]} and ${firstNames.length - 1} others are typing...`
	return h.div(
		[h.Class("absolute bottom-full left-4 pb-1"), h.AriaLive("polite")],
		firstNames.length === 0
			? []
			: [
					h.div(
						[h.Class("flex h-3 items-center gap-2 text-muted-fg text-xs")],
						[
							h.div(
								[h.Class("flex gap-1")],
								[
									h.span([h.Class(`${DOT} [animation-delay:-0.3s]`)]),
									h.span([h.Class(`${DOT} [animation-delay:-0.15s]`)]),
									h.span([h.Class(DOT)]),
								],
							),
							h.span([], [text]),
						],
					),
				],
	)
}
