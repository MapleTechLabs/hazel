import type { ChildAttribute, Html, HtmlBuilder } from "foldkit/html"
import { IconCirclePause, IconDotsVertical, IconHashtag, IconPlay, IconTrash } from "../../../icons"
import { badge } from "../../../ui/badge"
import { ariaButton } from "../../../ui/button"
import { card, cardBody, cardHeader } from "../../../ui/card"
import type * as Menu from "../../../ui/menu"
import { menuLabel, menuTriggerClassName, view as menuView } from "../../../ui/menu-view"
import { type ChatSyncProvider, PROVIDERS } from "../chat-sync/providers"
import {
	type ChannelLink,
	directionLabel,
	linkMenuId,
	linkMenuEntries,
	Message,
	type SyncDirection,
	type WebhookPermission,
} from "./model"
import { heading } from "../../../ui/heading"

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
	Record<WebhookPermission, { readonly label: string; readonly intent: "success" | "warning" | "muted" }>
> = {
	allowed: { label: "Webhook", intent: "success" },
	denied: { label: "Bot fallback", intent: "warning" },
	unknown: { label: "Checking", intent: "muted" },
}

const isDirectionKey = (key: string): key is SyncDirection => key in DIRECTION_PATHS

const linkMenuContent =
	(h: HtmlBuilder<Message>, link: ChannelLink, provider: ChatSyncProvider) =>
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
			return [directionIcon(h, key, "icon"), menuLabel(h, id, key, directionLabel(key, provider))]
		return []
	}

/** `ChannelLinkRow` */
export const channelLinkRow = (
	h: HtmlBuilder<Message>,
	link: ChannelLink,
	provider: ChatSyncProvider,
	channelName: string | undefined,
	menu: Menu.Model | undefined,
): Html => {
	const permission = WEBHOOK_PERMISSION_LABELS[link.webhookPermission]
	const direction = directionLabel(link.direction, provider)
	const { logo, hasWebhookIdentity } = PROVIDERS[provider]
	return h.keyed("div")(
		link.id,
		// A phone gives the row two lines: the Hazel channel with its status and menu, then the
		// direction and the external channel.
		[
			h.Class(
				"flex items-center gap-4 px-5 py-3 max-md:flex-wrap max-md:gap-x-3 max-md:gap-y-1 max-md:px-4",
			),
		],
		[
			h.div(
				[h.Class("flex min-w-0 flex-1 items-center gap-2 max-md:order-1")],
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
						"flex shrink-0 items-center gap-1.5 rounded-sm bg-bg-muted/50 px-2.5 py-1 text-muted-fg max-md:order-4",
					),
					h.Title(direction),
				],
				[directionIcon(h, link.direction), h.span([h.Class("text-xs")], [direction])],
			),
			h.div(
				[h.Class("flex min-w-0 flex-1 items-center gap-2 max-md:order-5")],
				[
					logo(h, "size-4 shrink-0"),
					h.span([h.Class("truncate text-fg text-sm")], [link.externalName]),
				],
			),
			// The phone's line break (`display: none` from `md` up, so the desktop row is untouched).
			h.div([h.Class("hidden max-md:order-3 max-md:block max-md:basis-full"), h.AriaHidden(true)]),
			h.div(
				[h.Class("flex shrink-0 items-center gap-2 max-md:order-2")],
				[
					// How Discord posts for this link; Slack always posts as the author.
					...(hasWebhookIdentity
						? [badge(h, { intent: permission.intent }, [permission.label])]
						: []),
					badge(h, { intent: link.isActive ? "success" : "muted" }, [
						link.isActive ? "Active" : "Paused",
					]),
					...(menu === undefined
						? []
						: [
								h.submodel({
									slotId: menu.id,
									model: menu,
									view: menuView,
									viewInputs: {
										entries: linkMenuEntries,
										toTrigger: (
											attributes: ReadonlyArray<ChildAttribute>,
											overlay: Html,
										) =>
											ariaButton(
												h,
												{
													className: menuTriggerClassName(
														"inline-flex size-7 items-center justify-center rounded-lg text-muted-fg hover:bg-secondary hover:text-fg max-md:-my-1.5 max-md:size-10",
													),
													attributes: [
														...attributes,
														h.AriaLabel("Channel link actions"),
														h.Attribute("data-slot", "menu-trigger"),
													],
												},
												[IconDotsVertical(h, { className: "size-4" }), overlay],
											),
										content: linkMenuContent(h, link, provider),
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
export const aboutCard = <M>(h: HtmlBuilder<M>, provider: ChatSyncProvider): Html =>
	h.div(
		[h.Class("lg:sticky lg:top-6 lg:self-start")],
		[
			card(h, {}, [
				cardHeader(h, [heading(h, { variant: "subsection" }, ["About Chat Sync"])], "py-3"),
				cardBody(h, [
					h.p(
						[h.Class("mb-4 text-muted-fg text-sm leading-relaxed")],
						[
							`Chat Sync keeps messages in sync between Hazel and ${PROVIDERS[provider].name}. Messages sent in either platform are automatically mirrored to the linked channel, including edits and deletions.`,
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
				]),
			]),
		],
	)
