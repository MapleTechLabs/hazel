import type { Html, HtmlBuilder } from "foldkit/html"
import { cn } from "~/lib/utils"
import { getEffectivePresenceStatus, type PresenceStatus } from "~/utils/presence"
import { formatStatusExpiration, getStatusDotColor, getStatusLabel } from "~/utils/status"
import { formatUserLocalTime, getTimezoneAbbreviation } from "~/utils/timezone"
import { IconChatBubble, IconClock, IconDotsVertical, IconPhone } from "../icons"
import type { PresenceInfo, UserInfo } from "../page/chat/lookups"
import { avatar } from "../ui/avatar"
import { badge } from "../ui/badge"
import { button } from "../ui/button"
import { menuTriggerClassName } from "../ui/menu-view"

/** `UserProfilePopover`'s `PopoverBody` (the trigger is the message avatar). */

export interface ProfileInputs {
	readonly user: UserInfo
	readonly displayName: string
	readonly avatarUrl: string | null
	readonly isBot: boolean
	readonly presence: PresenceInfo | null
	readonly isOwnProfile: boolean
	readonly nowMs: number
}

const statusIntent = (status: PresenceStatus) =>
	status === "online"
		? "success"
		: status === "away"
			? "warning"
			: status === "dnd"
				? "danger"
				: "secondary"

const actionBar = <M>(h: HtmlBuilder<M>, inputs: ProfileInputs): ReadonlyArray<Html> =>
	inputs.isOwnProfile
		? [button(h, { size: "sm", intent: "primary", className: "flex-1" }, ["Edit profile"])]
		: [
				button(h, { size: "sm", intent: "primary", className: "flex-1" }, [
					IconChatBubble(h, { attributes: { "data-slot": "icon" } }),
					"Message",
				]),
				...(inputs.isBot
					? []
					: [
							button(
								h,
								{
									size: "sq-sm",
									intent: "secondary",
									attributes: [h.Attribute("aria-label", "Call")],
								},
								[IconPhone(h, { attributes: { "data-slot": "icon" } })],
							),
						]),
				// MenuTrigger renders its own button around the Button child.
				h.button(
					[
						h.Attribute("aria-expanded", "false"),
						h.Attribute("aria-haspopup", "true"),
						h.Class(menuTriggerClassName()),
						h.Attribute("data-rac", ""),
						h.Attribute("data-react-aria-pressable", "true"),
						h.Attribute("data-slot", "menu-trigger"),
						h.Attribute("tabindex", "0"),
						h.Attribute("type", "button"),
					],
					[
						button(
							h,
							{
								size: "sq-sm",
								intent: "secondary",
								attributes: [
									h.Attribute("aria-expanded", "false"),
									h.Attribute("aria-haspopup", "true"),
									h.Attribute("aria-label", "More options"),
								],
							},
							[IconDotsVertical(h, { attributes: { "data-slot": "icon" } })],
						),
					],
				),
			]

export const profilePopoverContent = <M>(h: HtmlBuilder<M>, inputs: ProfileInputs): ReadonlyArray<Html> => {
	const { user, presence, isBot } = inputs
	const status = getEffectivePresenceStatus(
		presence
			? {
					status: presence.status,
					lastSeenAt: presence.lastSeenAtMs === null ? null : new Date(presence.lastSeenAtMs),
				}
			: null,
		inputs.nowMs,
	)
	const localTime = user.timezone ? formatUserLocalTime(user.timezone) : ""
	const expiration =
		presence?.statusExpiresAtMs != null
			? formatStatusExpiration(new Date(presence.statusExpiresAtMs))
			: null
	return [
		h.div([
			h.Class(
				cn(
					"relative h-20 overflow-hidden rounded-t-xl",
					"bg-gradient-to-br from-primary/20 via-accent/10 to-transparent",
					"before:absolute before:inset-0 before:bg-[radial-gradient(circle_at_30%_20%,var(--color-primary)/15_0%,transparent_50%)]",
				),
			),
		]),
		h.div(
			[h.Class("relative rounded-t-xl border border-border bg-bg shadow-md")],
			[
				h.div(
					[h.Class("absolute left-1/2 -top-10 -translate-x-1/2")],
					[
						h.div(
							[h.Class("relative")],
							[
								avatar(h, {
									size: "3xl",
									className: "shadow-lg shadow-black/5 ring-[5px] ring-bg",
									alt: inputs.displayName,
									src: inputs.avatarUrl,
									seed: inputs.displayName || undefined,
									isSquare: isBot,
								}),
								isBot
									? h.empty
									: h.span([
											h.Class(
												cn(
													"absolute right-1 bottom-1 size-4 rounded-full border-[3px] border-bg",
													getStatusDotColor(status),
												),
											),
										]),
							],
						),
					],
				),
				h.div(
					[h.Class("flex flex-col items-center gap-1 pt-12 text-center")],
					[
						h.div(
							[h.Class("flex items-center gap-2")],
							[
								h.span([h.Class("text-lg font-semibold text-fg")], [inputs.displayName]),
								isBot ? badge(h, { intent: "primary", size: "sm" }, ["APP"]) : h.empty,
							],
						),
						isBot ? h.empty : h.span([h.Class("text-sm text-muted-fg")], [user.email]),
						!isBot && status !== "online"
							? badge(h, { intent: statusIntent(status), size: "sm", className: "mt-1" }, [
									getStatusLabel(status),
								])
							: h.empty,
					],
				),
				!isBot && (presence?.statusEmoji || presence?.customMessage)
					? h.div(
							[h.Class("mx-4 mt-3 rounded-lg bg-secondary/50 p-3")],
							[
								h.div(
									[h.Class("flex items-start gap-2")],
									[
										presence.statusEmoji
											? h.span([h.Class("text-lg")], [presence.statusEmoji])
											: h.empty,
										h.div(
											[h.Class("flex flex-col gap-0.5")],
											[
												presence.customMessage
													? h.span(
															[h.Class("text-sm text-fg")],
															[presence.customMessage],
														)
													: h.empty,
												presence.statusExpiresAtMs !== null
													? h.span(
															[h.Class("text-xs text-muted-fg")],
															["Until ", expiration ?? ""],
														)
													: h.empty,
											],
										),
									],
								),
							],
						)
					: h.empty,
				!isBot && user.timezone && localTime
					? h.div(
							[h.Class("mt-3 px-4")],
							[
								h.div(
									[h.Class("flex items-center justify-center gap-2 text-sm text-muted-fg")],
									[
										IconClock(h, { className: "size-4 opacity-60" }),
										h.span(
											[],
											[localTime, " (", getTimezoneAbbreviation(user.timezone), ")"],
										),
									],
								),
							],
						)
					: h.empty,
				h.div(
					[h.Class("mt-4 flex items-center gap-2 border-t border-border px-4 py-3")],
					[...actionBar(h, inputs)],
				),
			],
		),
	]
}
