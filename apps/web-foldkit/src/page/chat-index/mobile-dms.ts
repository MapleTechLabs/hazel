import type { Html, HtmlBuilder } from "foldkit/html"
import { cn } from "~/lib/utils"
import { getEffectivePresenceStatus } from "~/utils/presence"
import { IconMsgs, IconPlus } from "../../icons"
import { AppRoute, hrefOf } from "../../route"
import { avatar } from "../../ui/avatar"
import { button } from "../../ui/button"
import { countBadge } from "../../ui/count-badge"
import { emptyState } from "../../ui/empty-state"
import { heading } from "../../ui/heading"
import { nativeIsland } from "../../platform/native-island"
import { mobileTopBar } from "../../ui/mobile-top-bar"
import { presenceDot } from "../../ui/presence-dot"
import { toggleChip } from "../../ui/toggle-chip"
import { Message } from "./message"
import { type ChannelSummary, type DmFilter, type DmParticipant, type Model, otherMembers } from "./model"

/**
 * The phone's DMs tab, laid out as Slack's: a strip of the people you talk to, `All` / `Unreads`
 * chips, then full-width rows, newest message first (unreads under their own heading), each with
 * its last message and time, and a round compose button floating over the list's end.
 */

type Context = Readonly<{ orgSlug: string; currentUserId: string | undefined; nowMs: number; model: Model }>

const isUnread = (channel: ChannelSummary) => channel.notificationCount > 0

const fullName = (member: DmParticipant) => `${member.firstName} ${member.lastName}`

/** The other member of a one-to-one DM, or none for a group DM. */
const partnerOf = (channel: ChannelSummary, currentUserId: string | undefined) => {
	const others = otherMembers(channel, currentUserId)
	return channel.type === "single" && others.length === 1 ? others[0] : undefined
}

const presenceOf = (context: Context, member: DmParticipant) =>
	getEffectivePresenceStatus(context.model.presence[member.userId])

const hrefTo = (context: Context, channel: ChannelSummary) =>
	hrefOf(AppRoute.ChatChannel({ orgSlug: context.orgSlug, channelId: channel.id }))

/** The people strip: one-to-one DMs, newest first, each a large avatar with its presence and first name. */
const peopleStrip = (h: HtmlBuilder<Message>, context: Context, channels: ReadonlyArray<ChannelSummary>) => {
	const people = channels.flatMap((channel) => {
		const partner = partnerOf(channel, context.currentUserId)
		return partner === undefined ? [] : [{ channel, partner }]
	})
	if (people.length === 0) return h.empty
	return h.nav(
		[
			h.AriaLabel("People"),
			h.Class("flex snap-x gap-3 overflow-x-auto px-4 pt-4 pb-1 [scrollbar-width:none]"),
		],
		people.slice(0, 12).map(({ channel, partner }) =>
			h.keyed("a")(
				`strip-${channel.id}`,
				[
					h.Href(hrefTo(context, channel)),
					h.Class(
						"flex w-14 shrink-0 snap-start flex-col items-center gap-1.5 transition-opacity duration-100 active:opacity-60",
					),
				],
				[
					avatar(h, {
						size: "xl",
						src: partner.avatarUrl,
						alt: fullName(partner),
						seed: fullName(partner),
						fallbackIcon: true,
						badge: presenceDot(h, presenceOf(context, partner), "sm"),
					}),
					h.span(
						[
							h.Class(
								cn(
									"w-full truncate text-center text-xs",
									isUnread(channel) ? "font-semibold text-fg" : "text-muted-fg",
								),
							),
						],
						[partner.firstName],
					),
				],
			),
		),
	)
}

const filters = (h: HtmlBuilder<Message>, filter: DmFilter, unreadCount: number) =>
	h.div(
		[h.Class("flex gap-2 px-4 pt-3 pb-1"), h.Attribute("role", "group"), h.AriaLabel("Filter")],
		[
			toggleChip(h, {
				label: "All",
				isPressed: filter === "all",
				onPress: Message.PressedDmFilter({ filter: "all" }),
				className: "h-8 rounded-full px-3.5",
			}),
			toggleChip(h, {
				label: unreadCount > 0 ? `Unreads · ${unreadCount}` : "Unreads",
				isPressed: filter === "unreads",
				onPress: Message.PressedDmFilter({ filter: "unreads" }),
				className: "h-8 rounded-full px-3.5",
			}),
		],
	)

const DAY_MS = 86_400_000
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

const startOfDay = (ms: number) => {
	const date = new Date(ms)
	date.setHours(0, 0, 0, 0)
	return date.getTime()
}

/** A row's time, short as Slack's: `now`, `12m`, `3h`, `Yesterday`, `Mon`, `Mar 3`, `Mar 3, 2025`. */
export const dmTimeOf = (atMs: number, nowMs: number): string => {
	const minutes = Math.floor((nowMs - atMs) / 60_000)
	if (minutes < 1) return "now"
	if (minutes < 60) return `${minutes}m`
	const today = startOfDay(nowMs)
	if (atMs >= today) return `${Math.floor(minutes / 60)}h`
	if (atMs >= today - DAY_MS) return "Yesterday"
	const date = new Date(atMs)
	if (atMs >= today - 6 * DAY_MS) return WEEKDAYS[date.getDay()] ?? ""
	const day = `${MONTHS[date.getMonth()]} ${date.getDate()}`
	return date.getFullYear() === new Date(nowMs).getFullYear() ? day : `${day}, ${date.getFullYear()}`
}

/** The last message as the row's second line: `You: …`, a group DM's `Ada: …`, or who the DM is with. */
const previewOf = (context: Context, channel: ChannelSummary, fallback: string): string => {
	if (channel.lastMessageAtMs === null) return fallback
	const text = channel.lastMessagePreview ?? "Sent an attachment"
	if (channel.lastMessageAuthorId === context.currentUserId) return `You: ${text}`
	if (channel.type === "single") return text
	const author = channel.members.find((member) => member.userId === channel.lastMessageAuthorId)
	return author === undefined ? text : `${author.firstName}: ${text}`
}

/**
 * A row, as Slack's: avatar with presence; the name and the time over the last message (two lines
 * at most); both bold while unread, with the unread count under the time.
 */
const row = (h: HtmlBuilder<Message>, context: Context, channel: ChannelSummary): Html => {
	const others = otherMembers(channel, context.currentUserId)
	const partner = partnerOf(channel, context.currentUserId)
	const unread = isUnread(channel)
	const shown = others.slice(0, 2)
	const leading =
		partner !== undefined
			? avatar(h, {
					size: "md",
					src: partner.avatarUrl,
					alt: fullName(partner),
					seed: fullName(partner),
					fallbackIcon: true,
					badge: presenceDot(h, presenceOf(context, partner), "xs"),
				})
			: h.div(
					[h.Class("relative size-10 shrink-0")],
					shown.map((member, index) =>
						avatar(h, {
							size: "xs",
							className: cn(
								"absolute size-7 ring-2 ring-bg",
								index === 0 ? "top-0 left-0" : "right-0 bottom-0",
							),
							src: member.avatarUrl,
							alt: member.firstName,
							seed: fullName(member),
							fallbackIcon: true,
						}),
					),
				)
	const name =
		partner !== undefined
			? fullName(partner).trim()
			: others.map((member) => member.firstName).join(", ") || channel.name
	const fallback = partner === undefined ? `${others.length + 1} people` : "Say hello 👋"
	return h.keyed("a")(
		channel.id,
		[
			h.Href(hrefTo(context, channel)),
			h.Class("flex items-start gap-3 px-4 py-2.5 transition-colors duration-100 active:bg-secondary"),
		],
		[
			h.div([h.Class("shrink-0 pt-0.5")], [leading]),
			h.div(
				[h.Class("min-w-0 flex-1")],
				[
					h.div(
						[h.Class("flex items-baseline gap-2")],
						[
							h.span(
								[
									h.Class(
										cn(
											"min-w-0 flex-1 truncate text-sm text-fg",
											unread ? "font-semibold" : "font-medium",
											channel.isMuted && "text-muted-fg",
										),
									),
								],
								[name],
							),
							channel.lastMessageAtMs === null
								? h.empty
								: h.span(
										[
											h.Class(
												cn(
													"shrink-0 text-xs tabular-nums",
													unread ? "font-medium text-fg" : "text-muted-fg",
												),
											),
										],
										[dmTimeOf(channel.lastMessageAtMs, context.nowMs)],
									),
						],
					),
					h.div(
						[h.Class("mt-0.5 flex items-start gap-2")],
						[
							h.p(
								[
									h.Class(
										cn(
											"line-clamp-2 min-w-0 flex-1 break-words text-sm leading-snug",
											unread ? "text-fg" : "text-muted-fg",
										),
									),
								],
								[previewOf(context, channel, fallback)],
							),
							unread
								? countBadge(h, {
										count: channel.notificationCount,
										isCapped: true,
										className: "mt-0.5",
									})
								: h.empty,
						],
					),
				],
			),
		],
	)
}

const section = (h: HtmlBuilder<Message>, title: string, rows: ReadonlyArray<Html>): Html =>
	rows.length === 0
		? h.empty
		: h.section(
				[h.Class("pt-3")],
				[heading(h, { variant: "label", className: "px-4 pb-1" }, [title]), h.div([], [...rows])],
			)

const composeButton = (h: HtmlBuilder<Message>) =>
	h.div(
		[h.Class("pointer-events-none sticky bottom-4 mt-auto flex justify-end px-4 pt-4")],
		[
			button(
				h,
				{
					intent: "primary",
					size: "sq-lg",
					className: "pointer-events-auto size-14 rounded-full shadow-lg",
					onPress: Message.PressedStartConversation(),
					// The iOS shell draws it as its own Liquid Glass button over the tab bar.
					attributes: [
						h.AriaLabel("New message"),
						...nativeIsland(h, "screen-action", { label: "New message", symbol: "plus" }),
					],
				},
				[IconPlus(h, { className: "size-6" })],
			),
		],
	)

export const mobileDmList = (
	h: HtmlBuilder<Message>,
	context: Context,
	channels: ReadonlyArray<ChannelSummary>,
): Html => {
	// Newest message first, as Slack's; DMs with no message yet after them.
	const ordered = [...channels].sort((a, b) => (b.lastMessageAtMs ?? 0) - (a.lastMessageAtMs ?? 0))
	const unread = ordered.filter(isUnread)
	const rest = ordered.filter((channel) => !isUnread(channel))
	const filter = context.model.dmFilter
	const body =
		channels.length === 0
			? h.div(
					[h.Class("p-4")],
					[
						emptyState(h, {
							icon: (className) => IconMsgs(h, { className }),
							title: "No direct messages",
							description: "Start a conversation with someone in your organization.",
						}),
					],
				)
			: filter === "unreads"
				? unread.length === 0
					? h.div(
							[h.Class("p-4")],
							[
								emptyState(h, {
									icon: (className) => IconMsgs(h, { className }),
									title: "You're all caught up",
									description: "No unread direct messages.",
								}),
							],
						)
					: h.div(
							[h.Class("pt-2")],
							unread.map((channel) => row(h, context, channel)),
						)
				: h.div(
						[],
						unread.length === 0
							? [
									h.div(
										[h.Class("pt-2")],
										rest.map((channel) => row(h, context, channel)),
									),
								]
							: [
									section(
										h,
										"Unreads",
										unread.map((channel) => row(h, context, channel)),
									),
									section(
										h,
										"Everything else",
										rest.map((channel) => row(h, context, channel)),
									),
								],
					)
	return h.div(
		[h.Class("flex min-h-full flex-col")],
		[
			mobileTopBar(h, { title: "DMs", isSticky: true }),
			peopleStrip(h, context, ordered),
			channels.length === 0 ? h.empty : filters(h, filter, unread.length),
			body,
			composeButton(h),
		],
	)
}
