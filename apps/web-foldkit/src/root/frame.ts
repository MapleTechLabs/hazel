// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The page frame, drawn as today (`git show cd159551c:apps/web-foldkit/src/shell/app-shell.ts`,
 * `shell/mobile.ts`, `ui/sidebar.ts`): the nav rail and the sidebar dock beside the main column on a
 * wide screen; on a phone one column with a top bar and the tab bar. Same markup and classes.
 */
import { Mount } from "@effect/ui"
import type { Html } from "@effect/ui/html"
import { Effect, Schema, Stream } from "effect"
import { twJoin, twMerge } from "tailwind-merge"
import {
	IconBell,
	IconChevronLeft,
	IconDots,
	IconMagnifier3,
	IconMenu,
	IconMsgs,
	IconMsgUser,
	Logo,
} from "../icons"
import { hasDesktopTitlebar } from "../platform/desktop"
import { systemUi } from "../platform/system-ui"
import {
	AppRoute,
	hrefOf,
	isChatRoute,
	isCustomersRoute,
	isMySettingsRoute,
	isNotificationsRoute,
	isSettingsRoute,
} from "../route"
import { type DestinationId, destination, destinationHref, isAvailable } from "../shell/destinations"
import { type MobileTopBar, mobileChromeOf } from "../shell/mobile"
import { button } from "../ui/button"
import { countBadge } from "../ui/count-badge"
import { heading } from "../ui/heading"
import { linkClassName } from "../ui/link"
import { fromKit, kit } from "./kit"

type H<M> = Html.H<M>

// SIDEBAR KIT (`ui/sidebar.ts`, the same class compositions)

export const sidebarProvider = <M>(h: H<M>, className: string) =>
	h.div.class(
		twMerge(
			"@container **:data-[slot=icon]:shrink-0",
			"flex w-full text-sidebar-fg",
			"group/sidebar-root peer/sidebar-root",
			// In the class, not \`style\`: the widths exist on the first frame, so the dock's width
			// transition never runs from its unsized width while the app loads.
			"[--sidebar-width:350px] [--sidebar-width-dock:3.25rem]",
			className,
		),
	)

/**
 * The dock's width transitions wait for its first painted frame: it is inserted before its widths
 * resolve (0px, then 350px), and today's sidebar appears at its width. Toggles and resizes animate.
 */
export const SettleAfterPaint = Mount.makeStream("SettleAfterPaint", { args: {} }, (node: HTMLElement) =>
	Stream.unwrap(
		Effect.acquireRelease(
			Effect.sync(() => {
				const view = node.ownerDocument.defaultView
				let frame = view?.requestAnimationFrame(() => {
					frame = view.requestAnimationFrame(() => node.setAttribute("data-settled", ""))
				})
				return () => {
					if (frame !== undefined) view?.cancelAnimationFrame(frame)
				}
			}),
			(cancel) => Effect.sync(cancel),
		).pipe(Effect.as(Stream.never)),
	),
)

/** The dock's spacer and its fixed column; every transition waits for \`data-settled\`. */
export const SIDEBAR_GAP_CLASS = twMerge([
	"w-(--sidebar-width) group-data-[collapsible=hidden]:w-0",
	"group-data-[side=right]:rotate-180",
	"relative h-svh bg-transparent group-data-settled:transition-[width] group-data-settled:duration-200 group-data-settled:ease-linear",
	"group-data-[collapsible=dock]:w-(--sidebar-width-dock)",
])
export const SIDEBAR_CONTAINER_CLASS = twJoin(
	"fixed inset-y-0 z-10 hidden w-(--sidebar-width) bg-sidebar",
	"not-has-data-[slot=sidebar-footer]:pb-2",
	"group-data-settled:transition-[left,right,width] group-data-settled:duration-200 group-data-settled:ease-linear",
	"md:flex",
)

export const sidebarDock = <M>(h: H<M>, isCollapsed: boolean, className: string, inner: unknown) =>
	h.div
		.onMount(SettleAfterPaint())
		.attrs({
			"data-state": isCollapsed ? "collapsed" : "expanded",
			"data-collapsible": isCollapsed ? "dock" : "",
			"data-intent": "default",
			"data-side": "left",
			"data-slot": "sidebar",
		})
		.class("group peer hidden text-sidebar-fg md:block")
		.children(
			h.div.attrs({ "data-slot": "sidebar-gap", "aria-hidden": "true" }).class(SIDEBAR_GAP_CLASS),
			h.div
				.attr("data-slot", "sidebar-container")
				.class(
					twMerge(
						SIDEBAR_CONTAINER_CLASS,
						"left-0 group-data-[collapsible=hidden]:left-[calc(var(--sidebar-width)*-1)]",
						[
							"group-data-[collapsible=dock]:w-(--sidebar-width-dock)",
							"border-sidebar-border group-data-[side=left]:border-r group-data-[side=right]:border-l",
						],
						className,
					),
				)
				.children(inner as never),
		)

/** The dock's inner column, where the nav rail and the secondary sidebar sit side by side. */
export const sidebarInner = <M>(h: H<M>) =>
	h.div
		.attrs({ "data-sidebar": "default", "data-slot": "sidebar-inner" })
		.class(
			twJoin(
				"flex h-full w-full flex-col text-sidebar-fg",
				"group-data-[intent=inset]:bg-sidebar dark:group-data-[intent=inset]:bg-bg",
				"group-data-[intent=float]:rounded-lg group-data-[intent=float]:border group-data-[intent=float]:border-sidebar-border group-data-[intent=float]:bg-sidebar group-data-[intent=float]:shadow-xs",
			),
		)

export const sidebarInset = <M>(h: H<M>, className: string) =>
	h.main
		.attr("data-slot", "sidebar-inset")
		.class(twMerge("relative flex w-full flex-1 flex-col bg-bg lg:min-w-0", className))

// NAV RAIL (`NavSidebar`)

const NAV_ACTIVE = "bg-sidebar-accent font-medium text-sidebar-accent-fg"

const itemClass = linkClassName({
	hasHref: false,
	className: twMerge([
		"cursor-default",
		"w-full min-w-0 items-center rounded-lg text-left font-normal text-base/6 text-fg-3",
		"group/sidebar-item relative col-span-full overflow-hidden focus-visible:outline-hidden",
		"**:data-[slot=menu-trigger]:rounded-none **:data-[slot=menu-trigger]:focus-visible:outline-0 **:data-[slot=menu-trigger]:focus-visible:ring-0 **:data-[slot=menu-trigger]:focus-visible:ring-offset-0 **:data-[slot=menu-trigger]:focus-visible:text-fg **:data-[slot=menu-trigger]:data-pressed:text-fg **:data-[slot=menu-trigger]:hover:text-fg has-[[data-slot=menu-trigger]:focus-visible]:bg-wash has-[[data-slot=menu-trigger][data-pressed]]:bg-wash",
		"**:data-[slot=menu-trigger]:absolute **:data-[slot=menu-trigger]:right-0 **:data-[slot=menu-trigger]:flex **:data-[slot=menu-trigger]:h-full **:data-[slot=menu-trigger]:w-auto **:data-[slot=menu-trigger]:items-center **:data-[slot=menu-trigger]:justify-end **:data-[slot=menu-trigger]:px-2.5 **:data-[slot=menu-trigger]:opacity-0 **:data-[slot=menu-trigger]:data-pressed:opacity-100 **:data-[slot=menu-trigger]:has-data-focus:opacity-100 **:data-[slot=menu-trigger]:focus-visible:opacity-100 hover:**:data-[slot=menu-trigger]:opacity-100",
		"**:data-[slot=icon]:size-5 **:data-[slot=icon]:shrink-0 **:data-[slot=icon]:text-fg-2 sm:**:data-[slot=icon]:size-4",
		"**:last:data-[slot=icon]:size-5 sm:**:last:data-[slot=icon]:size-4",
		"has-[[data-slot=avatar]]:has-[[data-slot=sidebar-label]]:gap-2 has-[[data-slot=icon]]:has-[[data-slot=sidebar-label]]:gap-2",
		"grid grid-cols-[auto_1fr_1.5rem_0.5rem_auto] **:last:data-[slot=icon]:ml-auto supports-[grid-template-columns:subgrid]:grid-cols-subgrid sm:text-sm/5",
		"p-2 has-[a]:p-0",
		"[--sidebar-current-bg:var(--color-sidebar-primary)] [--sidebar-current-fg:var(--color-sidebar-primary-fg)]",
		"hover:bg-wash hover:text-fg hover:**:data-[slot=icon]:text-fg-3 active:bg-wash active:text-fg active:**:data-[slot=icon]:text-fg-3",
		"size-9 justify-items-center",
	]),
})

const linkClass = (isActive: boolean) =>
	linkClassName({
		hasHref: true,
		className: twMerge(
			"col-span-full min-w-0 shrink-0 items-center p-2 focus:outline-hidden",
			"grid grid-cols-[auto_1fr_1.5rem_0.5rem_auto] supports-[grid-template-columns:subgrid]:grid-cols-subgrid",
			isActive ? NAV_ACTIVE : undefined,
		),
	})

/** `useUnreadNotificationCount` badge on the bell; the item's label carries the count for screen readers. */
const bellIcon = <M>(h: H<M>, unreadCount: number) =>
	h.div.class("relative").children(
		fromKit(h, IconBell(kit, { className: "size-5" })),
		unreadCount > 0 &&
			fromKit(
				h,
				countBadge(kit, {
					count: unreadCount,
					isCapped: true,
					className:
						"absolute -top-1.5 -right-2 h-4 min-w-4 bg-danger px-1 text-3xs text-danger-fg leading-none",
					attributes: [kit.AriaHidden(true)],
				}),
			),
	)

export interface RailInputs {
	readonly orgSlug: string
	readonly route: AppRoute
	readonly unreadCount: number
	readonly appVersion: string
}

const navItem = <M>(
	h: H<M>,
	orgSlug: string,
	id: DestinationId,
	isActive: boolean,
	icon?: unknown,
	ariaLabel?: string,
) => {
	if (!isAvailable(id)) return null
	const page = destination(id)
	return h.span
		.attrs({
			"data-slot": "sidebar-item",
			class: itemClass,
			"aria-label": ariaLabel ?? page.label,
			tabindex: "0",
			role: "link",
			"data-react-aria-pressable": "true",
		})
		.children(
			h.a
				.attrs({
					"data-status": isActive ? "active" : undefined,
					class: linkClass(isActive),
					href: destinationHref(id, orgSlug),
					tabindex: "0",
					"data-react-aria-pressable": "true",
					"aria-current": isActive ? "page" : undefined,
					"data-current": isActive ? "true" : undefined,
				})
				.children((icon as never) ?? fromKit(h, page.icon(kit, { className: "size-5" }))),
		)
}

/** `NavSidebar`; `assistantToggle` is the AI panel's button (still the Foldkit host's). */
export const navRail = <M>(h: H<M>, inputs: RailInputs, assistantToggle: unknown) => {
	const { orgSlug, route, unreadCount } = inputs
	return h.div
		.attrs({ "data-intent": "default", "data-collapsible": "none", "data-slot": "sidebar" })
		.class(
			twMerge(
				"flex h-full w-(--sidebar-width) flex-col bg-sidebar text-sidebar-fg",
				`hidden w-[calc(var(--sidebar-width-dock)+1px)] md:flex ${hasDesktopTitlebar ? "" : "md:border-r"}`,
			),
		)
		.children(
			h.div
				.attrs({ "data-slot": "sidebar-header", "data-tauri-drag-region": "true" })
				.class(
					twMerge(
						"flex flex-col gap-2 [.border-b]:border-sidebar-border",
						"in-data-[intent=inset]:p-4",
						"p-4",
						`px-3 py-4  border-b ${hasDesktopTitlebar ? "pt-14 relative before:absolute before:top-10 before:left-0 before:right-0 before:bottom-0 before:border-t before:border-r before:border-sidebar-border" : "h-14"}`,
					),
				)
				.children(
					h.a
						.attrs({
							class: linkClassName({
								hasHref: true,
								className: "flex items-center justify-center",
							}),
							href: hrefOf(AppRoute.Root()),
							tabindex: "0",
							"data-react-aria-pressable": "true",
						})
						.children(fromKit(h, Logo(kit, { className: "size-7" }))),
				),
			h.div
				.attr("data-slot", "sidebar-content")
				.class(
					twMerge(
						"flex min-h-0 flex-1 scroll-mb-96 flex-col overflow-auto overscroll-none *:data-[slot=sidebar-section]:border-l-0",
						"mask-b-from-95%",
						`mask-none ${hasDesktopTitlebar ? "border-r border-sidebar-border" : ""}`,
					),
				)
				.children(
					h.section
						.attr("data-slot", "sidebar-section-group")
						.class(twMerge("flex w-full min-w-0 flex-col gap-y-0.5"))
						.children(
							h.div
								.attr("data-slot", "sidebar-section")
								.class(
									twMerge(
										"col-span-full flex min-w-0 flex-col gap-y-0.5 **:data-[slot=sidebar-section]:**:gap-y-0",
										"in-data-[state=collapsed]:p-2 p-4",
										"p-2! *:data-[slot=sidebar-section-inner]:gap-y-2",
									),
								)
								.children(
									h.div
										.attr("data-slot", "sidebar-section-inner")
										.class(
											"grid grid-cols-[auto_1fr] gap-y-0.5 in-data-[state=collapsed]:gap-y-1.5",
										)
										.children(
											navItem(h, orgSlug, "home", route._tag === "OrgHome"),
											navItem(h, orgSlug, "chat", isChatRoute(route)),
											navItem(h, orgSlug, "customers", isCustomersRoute(route)),
											navItem(
												h,
												orgSlug,
												"notifications",
												isNotificationsRoute(route),
												bellIcon(h, unreadCount),
												unreadCount > 0
													? `${destination("notifications").label}, ${unreadCount} unread`
													: undefined,
											),
											navItem(
												h,
												orgSlug,
												"settings",
												isSettingsRoute(route) || isMySettingsRoute(route),
											),
										),
								),
						),
				),
			h.div
				.attr("data-slot", "sidebar-footer")
				.class(
					twMerge([
						"mt-auto flex shrink-0 items-center justify-center p-4 **:data-[slot=chevron]:text-muted-fg",
						"in-data-[intent=inset]:px-6 in-data-[intent=inset]:py-4",
						"flex-col gap-2 p-2",
					]),
				)
				.children(
					assistantToggle as never,
					h.span
						.class("text-center text-3xs font-mono text-muted-fg")
						.children("v", inputs.appVersion),
				),
		)
}

// PHONE (`shell/mobile.ts`)

const NAV_ITEM =
	"flex flex-1 flex-col items-center justify-center gap-1 rounded-full transition-[opacity,background-color] duration-100 active:opacity-60"

/** `nativeItem`: what the iOS shell's own tab bar reads from each tab. */
const nativeItemAttrs = (item: {
	readonly id: string
	readonly symbol?: string
	readonly isSelected?: boolean
	readonly badge?: number | undefined
	readonly role?: "search"
}): Record<string, string | undefined> => ({
	"data-native-role": item.role,
	"data-native-item": item.id,
	"data-native-symbol": item.symbol,
	"data-native-selected": item.isSelected ? "true" : undefined,
	"data-native-badge": item.badge === undefined ? undefined : String(item.badge),
})

/** The tab bar, as Slack's: Home, DMs, Activity, More, and Search beside them (`mobileNav`). */
export const tabBar = <M>(h: H<M>, inputs: RailInputs, onSearch: M) => {
	const { orgSlug, route, unreadCount } = inputs
	const tab = (
		label: string,
		href: string,
		isActive: boolean,
		icon: unknown,
		symbol: string,
		badge?: { readonly html: unknown; readonly count: number },
	) =>
		h.a
			.attrs({
				...nativeItemAttrs({ id: label, symbol, isSelected: isActive, badge: badge?.count }),
				class: twMerge(
					NAV_ITEM,
					isActive ? "bg-primary-subtle/60 text-primary" : "text-muted-fg",
					isActive && "active",
				),
				href,
				"aria-current": isActive ? "page" : undefined,
				"data-status": isActive ? "active" : undefined,
			})
			.children(
				h.span.class("relative").children(icon as never, (badge?.html as never) ?? null),
				h.span.class("font-medium text-3xs leading-none").children(label),
			)
	const unread =
		unreadCount > 0
			? {
					count: unreadCount,
					html: fromKit(
						h,
						countBadge(kit, {
							count: unreadCount,
							isCapped: true,
							className:
								"absolute -top-1 -right-2 h-4 min-w-4 bg-danger px-1 font-semibold text-3xs text-danger-fg leading-none",
							attributes: [kit.Attribute("data-native-skip", "")],
						}),
					),
				}
			: undefined
	const isMore =
		route._tag === "OrgMore" ||
		isCustomersRoute(route) ||
		isSettingsRoute(route) ||
		isMySettingsRoute(route)
	const icon = (render: typeof IconBell) => fromKit(h, render(kit, { className: "size-5" }))
	return h.nav
		.attrs({ "aria-label": "Tabs", "data-native": "tab-bar" })
		.class("shrink-0 bg-bg pb-[env(safe-area-inset-bottom)] md:hidden")
		.children(
			h.div.class("flex items-center gap-2 px-3 pt-1.5 pb-2").children(
				h.div
					.class(
						"flex h-14 flex-1 items-stretch gap-0.5 rounded-full border border-border bg-overlay p-1 shadow-md",
					)
					.children(
						tab(
							"Home",
							hrefOf(AppRoute.ChatIndex({ orgSlug })),
							// Members (`OrgHome`) opens from the channel list, so it stays under Home.
							(isChatRoute(route) && route._tag !== "ChatDms") || route._tag === "OrgHome",
							icon(IconMsgs),
							"house",
						),
						tab(
							"DMs",
							hrefOf(AppRoute.ChatDms({ orgSlug })),
							route._tag === "ChatDms",
							icon(IconMsgUser),
							"bubble.left.and.bubble.right",
						),
						tab(
							"Activity",
							hrefOf(AppRoute.NotificationsMentions({ orgSlug })),
							isNotificationsRoute(route),
							icon(IconBell),
							"bell",
							unread,
						),
						tab(
							"More",
							hrefOf(AppRoute.OrgMore({ orgSlug })),
							isMore,
							icon(IconDots),
							"ellipsis",
						),
					),
				fromKit(
					h,
					button(
						kit,
						{
							intent: "plain",
							size: "sq-lg",
							className:
								"size-14 shrink-0 rounded-full border border-border bg-overlay text-fg shadow-md",
							attributes: [
								kit.AriaLabel("Search"),
								kit.Attribute("data-native-role", "search"),
								kit.Attribute("data-native-item", "Search"),
								kit.Attribute("data-native-symbol", "magnifyingglass"),
							],
						},
						[IconMagnifier3(kit, { className: "size-5" })],
					),
					{ press: onSearch },
				),
			),
		)
}

/** While a back chevron shows, the shell's edge swipe goes where it leads (`platform/system-ui.ts`). */
const SwipeBack = Mount.makeStream(
	"SwipeBack",
	{ args: { href: Schema.String } },
	(_node: HTMLElement, { href }) =>
		Stream.unwrap(
			Effect.acquireRelease(
				Effect.sync(() => systemUi()?.setSwipeBack(href)),
				(release) => Effect.sync(() => release?.()),
			).pipe(Effect.as(Stream.never)),
		),
)

/** The top bar a page without its own header gets on a phone (`mobileTopBar`). */
export const topBar = <M>(h: H<M>, bar: MobileTopBar, onMenu: M) => {
	const back = (href: string) => {
		const link = h.a.key(`back:${href}`).attrs({
			href,
			"aria-label": "Back to Chats",
			class: "-ml-1 flex size-11 shrink-0 items-center justify-center rounded-lg text-primary transition-opacity duration-100 active:opacity-60 md:hidden",
		})
		// Only a shell with the swipe (installed before the app starts) gets the Mount.
		return (systemUi() === undefined ? link : link.onMount(SwipeBack({ href }))).children(
			fromKit(h, IconChevronLeft(kit, { className: "size-6" })),
		)
	}
	const leading =
		bar._tag === "Back"
			? back(bar.href)
			: fromKit(
					h,
					button(
						kit,
						{
							intent: "plain",
							size: "sq-md",
							className: "size-11",
							attributes: [kit.AriaLabel(`${bar.title} menu`)],
						},
						[IconMenu(kit, { className: "size-5" })],
					),
					{ press: onMenu },
				)
	return h.header
		.class(twMerge("flex h-14 shrink-0 items-center gap-1 border-border border-b bg-bg px-2", "pr-4"))
		.children(
			leading,
			fromKit(
				h,
				heading(kit, { variant: "section", level: 1, className: "min-w-0 flex-1 truncate" }, [
					bar.title,
				]),
			),
		)
}

export { mobileChromeOf }
