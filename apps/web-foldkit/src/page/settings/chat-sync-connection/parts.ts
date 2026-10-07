import type { ChildAttribute, Html, HtmlBuilder } from "foldkit/html"
import { IconCirclePause, IconDotsVertical, IconHashtag, IconPlay, IconTrash } from "../../../icons"
import type * as Menu from "../../../ui/menu"
import { menuLabel, menuTriggerClassName, view as menuView } from "../../../ui/menu-view"
import { discordLogo } from "../chat-sync/brand-icons"
import {
	type ChannelLink,
	DIRECTION_LABELS,
	linkMenuId,
	Message,
	type SyncDirection,
	type WebhookPermission,
} from "./model"

/** A heroicons-style outline `<svg>` with one path, as the legacy page inlines them. */
export const outlineIcon = <M>(
	h: HtmlBuilder<M>,
	options: Readonly<{ className: string; d: string; strokeWidth?: string; slot?: string }>,
): Html =>
	h.svg(
		[
			h.Class(options.className),
			...(options.slot ? [h.Attribute("data-slot", options.slot)] : []),
			h.Attribute("fill", "none"),
			h.Attribute("stroke", "currentColor"),
			h.Attribute("stroke-width", options.strokeWidth ?? "2"),
			h.Attribute("viewBox", "0 0 24 24"),
		],
		[
			h.path([
				h.Attribute("d", options.d),
				h.Attribute("stroke-linecap", "round"),
				h.Attribute("stroke-linejoin", "round"),
			]),
		],
	)

const DIRECTION_PATHS: Readonly<Record<SyncDirection, string>> = {
	both: "M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5",
	hazel_to_external: "M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3",
	external_to_hazel: "M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18",
}

/** `DirectionIcon` */
export const directionIcon = <M>(h: HtmlBuilder<M>, direction: SyncDirection, slot?: string): Html =>
	outlineIcon(h, { className: "size-4", d: DIRECTION_PATHS[direction], slot })

const WEBHOOK_PERMISSION_LABELS: Readonly<
	Record<WebhookPermission, { readonly label: string; readonly badgeClass: string }>
> = {
	allowed: { label: "Webhook", badgeClass: "bg-success-subtle text-success-subtle-fg" },
	denied: { label: "Bot fallback", badgeClass: "bg-warning-subtle text-warning-subtle-fg" },
	unknown: { label: "Checking", badgeClass: "bg-muted text-muted-fg" },
}

const isDirectionKey = (key: string): key is SyncDirection => key in DIRECTION_PATHS

const linkMenuContent =
	(h: HtmlBuilder<Message>, link: ChannelLink) =>
	(key: string): ReadonlyArray<Html> => {
		const id = linkMenuId(link.id)
		if (key === "direction")
			return [directionIcon(h, link.direction, "icon"), menuLabel(h, id, key, "Change direction")]
		if (key === "toggle")
			return [
				link.isActive
					? IconCirclePause(h, { className: "size-4" })
					: IconPlay(h, { className: "size-4" }),
				menuLabel(h, id, key, link.isActive ? "Pause sync" : "Resume sync"),
			]
		if (key === "remove")
			return [IconTrash(h, { className: "size-4" }), menuLabel(h, id, key, "Remove link")]
		if (isDirectionKey(key))
			return [directionIcon(h, key, "icon"), menuLabel(h, id, key, DIRECTION_LABELS[key])]
		return []
	}

/** `ChannelLinkRow` */
export const channelLinkRow = (
	h: HtmlBuilder<Message>,
	link: ChannelLink,
	channelName: string | undefined,
	menu: Menu.Model | undefined,
): Html => {
	const permission = WEBHOOK_PERMISSION_LABELS[link.webhookPermission]
	const directionLabel = DIRECTION_LABELS[link.direction]
	return h.keyed("div")(
		link.id,
		[h.Class("flex items-center gap-4 px-5 py-3")],
		[
			h.div(
				[h.Class("flex min-w-0 flex-1 items-center gap-2")],
				[
					IconHashtag(h, { className: "size-4 shrink-0 text-muted-fg" }),
					h.span(
						[h.Class("truncate font-medium text-fg text-sm")],
						[channelName || "Unknown channel"],
					),
				],
			),
			h.div(
				[
					h.Class(
						"flex shrink-0 items-center gap-1.5 rounded-sm bg-bg-muted/50 px-2.5 py-1 text-muted-fg",
					),
					h.Title(directionLabel),
				],
				[directionIcon(h, link.direction), h.span([h.Class("text-xs")], [directionLabel])],
			),
			h.div(
				[h.Class("flex min-w-0 flex-1 items-center gap-2")],
				[
					discordLogo(h, "size-4 shrink-0"),
					h.span([h.Class("truncate text-fg text-sm")], [link.externalName]),
				],
			),
			h.div(
				[h.Class("flex shrink-0 items-center gap-2")],
				[
					h.span(
						[h.Class(`inline-flex rounded-sm px-2 py-0.5 text-xs ${permission.badgeClass}`)],
						[permission.label],
					),
					h.span(
						[
							h.Class(
								`inline-flex rounded-sm px-2 py-0.5 text-xs ${
									link.isActive
										? "bg-success-subtle font-medium text-success-subtle-fg"
										: "bg-muted text-muted-fg"
								}`,
							),
						],
						[link.isActive ? "Active" : "Paused"],
					),
					...(menu === undefined
						? []
						: [
								h.submodel({
									slotId: menu.id,
									model: menu,
									view: menuView,
									viewInputs: {
										toTrigger: (
											attributes: ReadonlyArray<ChildAttribute>,
											overlay: Html,
										) =>
											h.button(
												[
													...attributes,
													h.AriaLabel("Channel link actions"),
													h.Class(
														menuTriggerClassName(
															"inline-flex size-7 items-center justify-center rounded-lg text-muted-fg hover:bg-secondary hover:text-fg",
														),
													),
													h.Attribute("data-rac", ""),
													h.Attribute("data-react-aria-pressable", "true"),
													h.Attribute("data-slot", "menu-trigger"),
													h.Attribute("tabindex", "0"),
													h.Attribute("type", "button"),
												],
												[IconDotsVertical(h, { className: "size-4" }), overlay],
											),
										content: linkMenuContent(h, link),
									},
									toParentMessage: (message: Menu.Message) =>
										Message.GotLinkMenuMessage({ linkId: link.id, message }),
								}),
							]),
				],
			),
		],
	)
}

export const FEATURES = [
	"Bidirectional message sync",
	"Thread and reply support",
	"Real-time message delivery",
	"Per-channel direction control",
	"Automatic deduplication",
	"Edit and delete sync",
]

/** The "About Chat Sync" card in the right column. */
export const aboutCard = <M>(h: HtmlBuilder<M>): Html =>
	h.div(
		[h.Class("lg:sticky lg:top-6 lg:self-start")],
		[
			h.div(
				[h.Class("overflow-hidden rounded-xl border border-border bg-bg")],
				[
					h.div(
						[h.Class("border-border border-b bg-bg-muted/30 px-5 py-3")],
						[h.h3([h.Class("font-semibold text-fg text-sm")], ["About Chat Sync"])],
					),
					h.div(
						[h.Class("p-5")],
						[
							h.p(
								[h.Class("mb-4 text-muted-fg text-sm leading-relaxed")],
								[
									"Chat Sync keeps messages in sync between Hazel and Discord. Messages sent in either platform are automatically mirrored to the linked channel, including edits and deletions.",
								],
							),
							h.ul(
								[h.Class("flex flex-col gap-2.5")],
								FEATURES.map((feature) =>
									h.li(
										[h.Class("flex items-center gap-2.5 text-sm")],
										[
											h.div(
												[
													h.Class(
														"flex size-5 shrink-0 items-center justify-center rounded-sm bg-success-subtle",
													),
												],
												[
													outlineIcon(h, {
														className: "size-3 text-success-subtle-fg",
														d: "M5 13l4 4L19 7",
														strokeWidth: "3",
													}),
												],
											),
											h.span([h.Class("text-fg")], [feature]),
										],
									),
								),
							),
						],
					),
				],
			),
		],
	)
