import type { Html, HtmlBuilder } from "foldkit/html"
import { IconCheck, IconHashtag } from "../../../../apps/web-foldkit/src/icons/index.ts"
import {
	sectionGroupHeader,
	sectionPlusButton,
	treeSection,
} from "../../../../apps/web-foldkit/src/ui/sidebar-tree.ts"
import { avatar } from "../../../../apps/web-foldkit/src/ui/avatar.ts"
import { iconButton } from "../../../../apps/web-foldkit/src/ui/button.ts"
import { countBadge } from "../../../../apps/web-foldkit/src/ui/count-badge.ts"
import {
	sidebarItem,
	sidebarLabel,
	sidebarLink,
	sidebarSection,
	sidebarUnreadPip,
} from "../../../../apps/web-foldkit/src/ui/sidebar.ts"
import { statusDot } from "../../../../apps/web-foldkit/src/ui/status-dot.ts"

/**
 * The kit side of lane A4's row specimens: today's collapsible section (`treeSection` with its
 * `sectionGroupHeader`), unread channel row (`channelItem`), activity row
 * (`notificationItem`, `page/notifications/inbox/view.ts`) and DM row (`page/chat-index/mobile-dms.ts`),
 * with the content of `fixtures/section/collapsible.json` and `fixtures/item/{unread-pip,badge-*,activity,dm}.json`.
 * Avatars have no image or seed.
 */

type H = HtmlBuilder<never>

/** Each channel row is a `sidebarLink` inside its `sidebarItem`, as `channelItem` draws it. */
const link = { href: "#", isActive: false, activeClassName: "" }

/** The unread name: full ink and medium (`channelItem`'s `label`). */
const emphasizedLabel = (h: H, name: string): Html =>
	h.span(
		[
			h.Class(
				"col-start-2 min-w-0 overflow-hidden whitespace-nowrap text-ellipsis outline-hidden font-medium text-fg",
			),
			h.Attribute("data-slot", "sidebar-label"),
		],
		[name],
	)

/** A collapsible section: the chevron leads its name, the "+" ends the header (`sectionGroupHeader`). */
const collapsibleSection = (h: H): Html =>
	h.div(
		[h.Class("frame-sidebar"), h.Attribute("data-specimen", "section-collapsible")],
		[
			treeSection(h, {
				id: "kit-channels",
				title: "Channels",
				ariaLabel: "Channels",
				header: sectionGroupHeader(h, {
					name: "Channels",
					isCollapsed: false,
					action: sectionPlusButton(h, "New in Channels", []),
				}),
				allowsDragging: false,
				rows: [
					sidebarItem(h, {}, [
						sidebarLink(h, link, [IconHashtag(h), sidebarLabel(h, ["general"])]),
					]),
				],
			}),
		],
	)

/** An unread channel: the pip, the hashtag and the emphasized name (`channelItem`, `label`). */
const unreadChannel = (h: H): Html =>
	h.div(
		[h.Class("frame-sidebar"), h.Attribute("data-specimen", "section-unread")],
		[
			sidebarSection(h, { label: "Channels" }, [
				sidebarItem(h, { attributes: [h.Attribute("data-specimen", "item-unread-pip")] }, [
					sidebarUnreadPip(h),
					sidebarLink(h, link, [IconHashtag(h), emphasizedLabel(h, "design")]),
				]),
			]),
		],
	)

/**
 * An unread channel with its count (`channelItem` and `sidebarBadge`, `shell/channels-sidebar/items.ts`):
 * the solid brand pill, round at one digit, 6px from the row's end.
 */
const badgedChannel = (h: H, count: number): Html =>
	h.div(
		[h.Class("frame-sidebar"), h.Attribute("data-specimen", `section-badge-${count}`)],
		[
			sidebarSection(h, { label: "Channels" }, [
				sidebarItem(h, { attributes: [h.Attribute("data-specimen", `item-badge-${count}`)] }, [
					sidebarUnreadPip(h),
					sidebarLink(h, link, [IconHashtag(h), emphasizedLabel(h, "design")]),
					// `sidebarBadge`'s classes (not exported from `items.ts`).
					countBadge(h, {
						count,
						className:
							"absolute inset-y-1/2 right-1.5 -translate-y-1/2 group-hover/sidebar-item:right-8",
						attributes: [h.Attribute("data-slot", "sidebar-badge")],
					}),
				]),
			]),
		],
	)

/** An unread mention with its author, its time and "Mark as read" (`notificationItem`, `rowAction`). */
const activityRow = (h: H): Html =>
	h.div(
		[h.Class("group flex items-center transition-colors"), h.Attribute("data-specimen", "item-activity")],
		[
			h.a(
				[
					h.Class("flex min-w-0 flex-1 cursor-pointer items-start gap-3 px-4 py-3 outline-hidden"),
					h.Href("#"),
				],
				[
					h.div(
						[h.Class("flex h-10 w-2 shrink-0 items-center justify-center")],
						[statusDot(h, { tone: "primary", className: "size-2" })],
					),
					h.div([h.Class("shrink-0")], [avatar(h, { size: "md" })]),
					h.div(
						[h.Class("min-w-0 flex-1")],
						[
							h.div(
								[h.Class("flex items-start justify-between gap-2")],
								[
									h.p(
										[
											h.Class(
												"line-clamp-2 min-w-0 text-sm wrap-anywhere font-medium text-fg",
											),
										],
										[
											"@Ada Lovelace can you look at the new sidebar spacing before Friday?",
										],
									),
									h.span([h.Class("shrink-0 text-muted-fg text-xs")], ["20 days ago"]),
								],
							),
							h.p(
								[h.Class("mt-0.5 truncate text-muted-fg text-xs")],
								["New message in #design"],
							),
						],
					),
				],
			),
			iconButton(
				h,
				{
					label: "Mark as read: New message in #design",
					size: "sq-xs",
					className:
						"mr-3 shrink-0 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 max-md:opacity-100",
				},
				IconCheck(h),
			),
		],
	)

/** An unread DM: name and time, then a two-line preview and the count (`row`). */
const dmRow = (h: H): Html =>
	h.a(
		[
			h.Href("#"),
			h.Class("flex items-start gap-3 px-4 py-2.5 transition-colors duration-100 active:bg-secondary"),
			h.Attribute("data-specimen", "item-dm"),
		],
		[
			h.div([h.Class("shrink-0 pt-0.5")], [avatar(h, { size: "md" })]),
			h.div(
				[h.Class("min-w-0 flex-1")],
				[
					h.div(
						[h.Class("flex items-baseline gap-2")],
						[
							h.span(
								[h.Class("min-w-0 flex-1 truncate text-sm text-fg font-semibold")],
								["Grace Hopper"],
							),
							h.span([h.Class("shrink-0 text-xs tabular-nums font-medium text-fg")], ["14:05"]),
						],
					),
					h.div(
						[h.Class("mt-0.5 flex items-start gap-2")],
						[
							h.p(
								[
									h.Class(
										"line-clamp-2 min-w-0 flex-1 break-words text-sm leading-snug text-fg",
									),
								],
								[
									"Sure, send it over. I will read the draft tonight and leave comments on the open questions.",
								],
							),
							countBadge(h, { count: 2, isCapped: true, className: "mt-0.5" }),
						],
					),
				],
			),
		],
	)

/** One frame per specimen: the sidebar column, and rows as wide as the fixture gallery's `screen` frame. */
export const rowSpecimens = (h: H): Html =>
	h.div(
		[h.Class("frames")],
		[
			collapsibleSection(h),
			unreadChannel(h),
			badgedChannel(h, 1),
			badgedChannel(h, 12),
			h.div([h.Attribute("style", "flex: 1 1 100%; max-width: 720px;")], [activityRow(h), dmRow(h)]),
		],
	)
