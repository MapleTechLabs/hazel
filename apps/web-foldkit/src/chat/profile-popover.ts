import type { Html, HtmlBuilder } from "foldkit/html"
import { formatTimezoneDelta } from "@hazel/shared-screens/lib/utils/timezone"
import type { ProfileAction } from "@hazel/shared-screens/chat/components/ProfileCard"
import { cn } from "~/lib/utils"
import { getEffectivePresenceStatus } from "~/utils/presence"
import { formatStatusExpiration } from "~/utils/status"
import { formatUserLocalTime, getTimezoneAbbreviation } from "~/utils/timezone"
import { IconChatBubble, IconClock, IconCopy, IconEdit, IconEnvelope, IconMsgPen, IconUser } from "../icons"
import type { PresenceInfo, SyncProvider, UserInfo } from "../page/chat/lookups"
import { avatar } from "../ui/avatar"
import { badge } from "../ui/badge"
import { button, buttonClassName } from "../ui/button"
import { presenceDot } from "../ui/presence-dot"
import { syncMark } from "./message/parts"

/**
 * `UserProfilePopover`'s `PopoverBody` (the trigger is the message avatar), as the thread panel's
 * rows draw it. The shared message list draws the same card (`shared-screens` `ProfileCard`): who
 * they are, their custom status and clock, and what you can do.
 */

export interface ProfileInputs<M> {
	readonly user: UserInfo
	readonly displayName: string
	readonly avatarUrl: string | null
	readonly isBot: boolean
	/** A Slack or Discord person (a chat sync shadow user): no presence, no Hazel email. */
	readonly syncProvider: SyncProvider | null
	readonly presence: PresenceInfo | null
	readonly isOwnProfile: boolean
	/** Where "Edit profile" (own profile only) leads: the settings profile page. */
	readonly editProfileHref: string
	readonly nowMs: number
	/** A card action's message; null while there is no viewer to act as. */
	readonly toAction: ((action: ProfileAction) => M) | null
}

const providerLabel = (provider: SyncProvider) => (provider === "discord" ? "Discord" : "Slack")

/** Under the name: the email for a person, the platform for a synced person, "App" for a bot. */
const subtitleOf = <M>({ user, isBot, syncProvider }: ProfileInputs<M>): string | null =>
	syncProvider !== null ? `${providerLabel(syncProvider)} member` : isBot ? "App" : user.email || null

/** A quiet icon button with its name as the tooltip. */
const iconAction = <M>(h: HtmlBuilder<M>, label: string, icon: Html, onPress: M): Html =>
	button(
		h,
		{
			size: "sq-sm",
			intent: "plain",
			onPress,
			attributes: [h.Attribute("aria-label", label), h.Attribute("title", label)],
		},
		[icon],
	)

/**
 * Your own card: "Edit profile". A Hazel person or an app: "Message". A Slack or Discord person has
 * no Hazel DM, so "Mention" leads. The rest are icon buttons at the end.
 */
const actionBar = <M>(h: HtmlBuilder<M>, inputs: ProfileInputs<M>): ReadonlyArray<Html> => {
	const { toAction, isOwnProfile, isBot, syncProvider, user } = inputs
	const canMessage = !isOwnProfile && syncProvider === null
	const slot = { attributes: { "data-slot": "icon" } }
	const primary = isOwnProfile
		? h.a(
				[h.Class(buttonClassName({ size: "sm", intent: "primary" })), h.Href(inputs.editProfileHref)],
				[IconEdit(h, slot), "Edit profile"],
			)
		: toAction === null
			? h.empty
			: canMessage
				? button(h, { size: "sm", intent: "primary", onPress: toAction("message") }, [
						IconChatBubble(h, slot),
						"Message",
					])
				: button(h, { size: "sm", intent: "secondary", onPress: toAction("mention") }, [
						IconMsgPen(h, slot),
						"Mention",
					])
	const hasEmail = syncProvider === null && !isBot && user.email !== ""
	const secondary =
		toAction === null
			? []
			: [
					canMessage ? iconAction(h, "Mention", IconMsgPen(h, slot), toAction("mention")) : h.empty,
					canMessage || isOwnProfile
						? iconAction(h, "View profile", IconUser(h, slot), toAction("viewProfile"))
						: h.empty,
					hasEmail
						? iconAction(h, "Copy email", IconEnvelope(h, slot), toAction("copyEmail"))
						: h.empty,
					iconAction(h, "Copy user ID", IconCopy(h, slot), toAction("copyId")),
				]
	return [primary, h.div([h.Class("flex-1")]), ...secondary]
}

export const profilePopoverContent = <M>(
	h: HtmlBuilder<M>,
	inputs: ProfileInputs<M>,
): ReadonlyArray<Html> => {
	const { user, presence, isBot, syncProvider } = inputs
	// Neither an app nor a Slack or Discord person has Hazel presence, a status or a local time.
	const isExternal = isBot || syncProvider !== null
	const status = getEffectivePresenceStatus(presence)
	const localTime = !isExternal && user.timezone ? formatUserLocalTime(user.timezone) : ""
	const delta = localTime === "" ? "" : formatTimezoneDelta(user.timezone, new Date(inputs.nowMs))
	const expiration =
		presence?.statusExpiresAtMs != null
			? formatStatusExpiration(new Date(presence.statusExpiresAtMs))
			: null
	const subtitle = subtitleOf(inputs)
	return [
		h.div(
			[h.Class("flex flex-col gap-3 p-3")],
			[
				// Who: the avatar beside the name, read left to right like a message row; presence is
				// the avatar's dot.
				h.div(
					[h.Class("flex items-center gap-3")],
					[
						avatar(h, {
							size: "lg",
							alt: inputs.displayName,
							src: inputs.avatarUrl,
							seed: inputs.displayName || undefined,
							isSquare: true,
							badge:
								syncProvider !== null
									? syncMark(h, syncProvider)
									: isExternal
										? undefined
										: presenceDot(h, status, "sm"),
						}),
						h.div(
							[h.Class("flex min-w-0 flex-col")],
							[
								h.div(
									[h.Class("flex min-w-0 items-center gap-2")],
									[
										h.span(
											[h.Class("truncate font-semibold text-base text-fg")],
											[inputs.displayName],
										),
										isBot
											? badge(h, { intent: "primary", size: "sm" }, ["APP"])
											: h.empty,
									],
								),
								subtitle === null
									? h.empty
									: h.span([h.Class("truncate text-muted-fg text-sm")], [subtitle]),
							],
						),
					],
				),
				// Their custom status, as they wrote it.
				!isExternal && (presence?.statusEmoji || presence?.customMessage)
					? h.div(
							[h.Class("flex items-center gap-2 rounded-lg bg-secondary/50 px-3 py-2")],
							[
								presence.statusEmoji
									? h.span([h.Class("text-lg")], [presence.statusEmoji])
									: h.empty,
								h.div(
									[h.Class("flex min-w-0 flex-col")],
									[
										presence.customMessage
											? h.span([h.Class("text-fg text-sm")], [presence.customMessage])
											: h.empty,
										presence.statusExpiresAtMs !== null
											? h.span(
													[h.Class("text-muted-fg text-xs")],
													["Until ", expiration ?? ""],
												)
											: h.empty,
									],
								),
							],
						)
					: h.empty,
				// Their clock: how far it is from yours, else (same clock) its zone.
				localTime === ""
					? h.empty
					: h.div(
							[h.Class("flex items-center gap-2 text-muted-fg text-sm")],
							[
								IconClock(h, { className: "size-4 shrink-0 opacity-60" }),
								h.span(
									[],
									[
										[
											localTime,
											delta === "" ? getTimezoneAbbreviation(user.timezone) : delta,
										]
											.filter(Boolean)
											.join(" · "),
									],
								),
							],
						),
				h.div(
					[h.Class(cn("flex items-center gap-1 border-border border-t pt-3"))],
					[...actionBar(h, inputs)],
				),
			],
		),
	]
}
