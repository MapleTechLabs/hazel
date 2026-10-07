import type { Html, HtmlBuilder } from "foldkit/html"
import { cn } from "~/lib/utils"
import { getEffectivePresenceStatus } from "~/utils/presence"
import { IconHashtag, IconLock, IconUsers, IconVolumeMute } from "../../icons"
import { avatar } from "../../ui/avatar"
import { badge } from "../../ui/badge"
import { type ChannelSummary, type DmParticipant, otherMembers, type Presence } from "./model"

/** `ChannelCard`, `DmCard` and `SingleDmCard` from `routes/_app/$orgSlug/chat/index.tsx`. */

const cardLinkClass =
	"group flex items-center justify-between gap-4 px-4 py-3 transition-all duration-200 hover:bg-secondary/50"

const titleClass = (channel: ChannelSummary) =>
	cn("truncate font-semibold text-fg text-sm", channel.isMuted && "text-muted-fg")

const notificationBadge = <M>(h: HtmlBuilder<M>, count: number): Html =>
	count <= 0
		? h.empty
		: badge(h, { intent: "danger", className: "min-w-5 justify-center" }, [
				count > 99 ? "99+" : `${count}`,
			])

const cardLink = <M>(h: HtmlBuilder<M>, orgSlug: string, channel: ChannelSummary, left: Array<Html>): Html =>
	h.keyed("a")(
		channel.id,
		[h.Class(cardLinkClass), h.Href(`/${orgSlug}/chat/${channel.id}`)],
		[
			h.div([h.Class("flex min-w-0 items-center gap-3")], left),
			notificationBadge(h, channel.notificationCount),
		],
	)

export const channelCard = <M>(
	h: HtmlBuilder<M>,
	orgSlug: string,
	channel: ChannelSummary,
	isPrivate: boolean,
): Html =>
	cardLink(h, orgSlug, channel, [
		h.div(
			[h.Class("flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary")],
			[
				isPrivate
					? IconLock(h, { className: "size-5 text-muted-fg" })
					: IconHashtag(h, { className: "size-5 text-muted-fg" }),
			],
		),
		h.div(
			[h.Class("min-w-0")],
			[
				h.div(
					[h.Class("flex items-center gap-2")],
					[
						h.h3([h.Class(titleClass(channel))], [channel.name]),
						channel.isFavorite ? h.span([h.Class("shrink-0 text-favorite")], ["★"]) : h.empty,
					],
				),
				h.div(
					[h.Class("mt-0.5 flex items-center gap-3 text-muted-fg text-xs")],
					[
						h.span(
							[h.Class("flex items-center gap-1")],
							[IconUsers(h, { className: "size-3.5" }), `${channel.memberCount || 0}`],
						),
						channel.isMuted
							? h.span(
									[h.Class("flex items-center gap-1")],
									[IconVolumeMute(h, { className: "size-3.5" }), "Muted"],
								)
							: h.empty,
					],
				),
			],
		),
	])

const statusTextOf = (presence: Presence | undefined, nowMs: number) => {
	const status = getEffectivePresenceStatus(
		presence === undefined || presence.lastSeenMs === null
			? null
			: { status: presence.status, lastSeenAt: new Date(presence.lastSeenMs) },
		nowMs,
	)
	// Legacy order: any non-offline status is "online" first, so the later labels never show.
	const isOnline = status !== "offline"
	const labels: Record<string, string> = { away: "Away", busy: "Busy", dnd: "Do not disturb" }
	return { isOnline, text: isOnline ? "Active now" : (labels[status] ?? "Offline") }
}

const singleDmCard = <M>(
	h: HtmlBuilder<M>,
	orgSlug: string,
	channel: ChannelSummary,
	member: DmParticipant,
	presence: Presence | undefined,
	nowMs: number,
): Html => {
	const { isOnline, text } = statusTextOf(presence, nowMs)
	return cardLink(h, orgSlug, channel, [
		h.div(
			[h.Class("relative shrink-0")],
			[
				avatar(h, {
					size: "md",
					src: member.avatarUrl,
					alt: `${member.firstName} ${member.lastName}`,
					fallbackIcon: true,
				}),
				h.span(
					[
						h.Class(
							cn(
								"absolute right-0 bottom-0 size-3 rounded-full border-2 border-bg",
								isOnline ? "bg-success" : "bg-muted",
							),
						),
					],
					[],
				),
			],
		),
		h.div(
			[h.Class("min-w-0")],
			[
				h.h3([h.Class(titleClass(channel))], [member.firstName, " ", member.lastName]),
				h.p([h.Class("text-muted-fg text-xs")], [text]),
			],
		),
	])
}

export const dmCard = <M>(
	h: HtmlBuilder<M>,
	orgSlug: string,
	channel: ChannelSummary,
	context: {
		readonly currentUserId: string | undefined
		readonly presence: Readonly<Record<string, Presence>>
		readonly nowMs: number
	},
): Html => {
	const others = otherMembers(channel, context.currentUserId)
	const only = others[0]
	if (channel.type === "single" && others.length === 1 && only) {
		return singleDmCard(h, orgSlug, channel, only, context.presence[only.userId], context.nowMs)
	}
	const shown = others.slice(0, 3)
	return cardLink(h, orgSlug, channel, [
		h.div(
			[h.Class("flex shrink-0 -space-x-3")],
			shown.map((member) =>
				avatar(h, {
					size: "sm",
					src: member.avatarUrl,
					alt: member.firstName,
					className: "ring-2 ring-bg",
					fallbackIcon: true,
				}),
			),
		),
		h.div(
			[h.Class("min-w-0")],
			[
				h.h3(
					[h.Class(titleClass(channel))],
					[
						shown.map((member) => member.firstName).join(", "),
						others.length > 3
							? h.span([h.Class("text-muted-fg")], [` +${others.length - 3}`])
							: h.empty,
					],
				),
				h.p([h.Class("text-muted-fg text-xs")], [`${others.length} participants`]),
			],
		),
	])
}
