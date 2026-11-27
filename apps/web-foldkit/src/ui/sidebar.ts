import type { Attribute, Html, HtmlBuilder } from "foldkit/html"
import { twJoin, twMerge } from "tailwind-merge"
import { linkClassName } from "./link"

/**
 * Port of `components/ui/sidebar.tsx`, desktop + expanded state only for now.
 * Each function copies the legacy `twMerge` arguments verbatim so class strings match.
 */

export const sidebarSection = <Message>(
	h: HtmlBuilder<Message>,
	options: {
		readonly label?: string
		readonly className?: string
		/** On the list of items (e.g. a drop target). */
		readonly listAttributes?: ReadonlyArray<Attribute<Message>>
	},
	children: Html[],
): Html =>
	h.div(
		[
			h.Attribute("data-slot", "sidebar-section"),
			h.Class(
				twMerge(
					"col-span-full flex min-w-0 flex-col gap-y-0.5 **:data-[slot=sidebar-section]:**:gap-y-0",
					"in-data-[state=collapsed]:p-2 p-4",
					options.className,
				),
			),
			// React spreads the `label` prop onto the div as an attribute.
			...(options.label ? [h.Attribute("label", options.label)] : []),
		],
		[
			...(options.label
				? [
						h.header(
							[
								h.Class(
									"mb-1 flex shrink-0 items-center rounded-md px-2 font-medium text-sidebar-fg/70 text-xs/6 outline-none ring-sidebar-ring transition-[margin,opa] duration-200 ease-linear *:data-[slot=icon]:size-4 *:data-[slot=icon]:shrink-0 group-data-[collapsible=dock]:-mt-8 group-data-[collapsible=dock]:opacity-0",
								),
							],
							[options.label],
						),
					]
				: []),
			h.div(
				[
					...(options.listAttributes ?? []),
					h.Attribute("data-slot", "sidebar-section-inner"),
					h.Class("grid grid-cols-[auto_1fr] gap-y-0.5 in-data-[state=collapsed]:gap-y-1.5"),
				],
				children,
			),
		],
	)

/**
 * `<SidebarItem>`: a React Aria Link without href (renders a `span role=link`) that
 * wraps a `<SidebarLink>`.
 */
export const sidebarItem = <Message>(
	h: HtmlBuilder<Message>,
	options: {
		readonly isCurrent?: boolean
		readonly ariaLabel?: string
		readonly className?: string
		readonly attributes?: ReadonlyArray<Attribute<Message>>
	},
	children: Html[],
): Html =>
	h.span(
		[
			...(options.attributes ?? []),
			h.Attribute("data-slot", "sidebar-item"),
			h.Class(
				linkClassName({
					hasHref: false,
					className: twMerge([
						"cursor-default",
						"w-full min-w-0 items-center rounded-lg text-left font-normal text-base/6 text-fg-3",
						"group/sidebar-item relative col-span-full overflow-hidden focus-visible:outline-hidden",
						// The trigger fills the row's right edge, so the button's offset ring would be clipped into a
						// bracket by the row's overflow: a focused trigger lights the row and its dots instead.
						"**:data-[slot=menu-trigger]:rounded-none **:data-[slot=menu-trigger]:focus-visible:outline-0 **:data-[slot=menu-trigger]:focus-visible:ring-0 **:data-[slot=menu-trigger]:focus-visible:ring-offset-0 **:data-[slot=menu-trigger]:focus-visible:text-fg **:data-[slot=menu-trigger]:data-pressed:text-fg **:data-[slot=menu-trigger]:hover:text-fg has-[[data-slot=menu-trigger]:focus-visible]:bg-wash has-[[data-slot=menu-trigger][data-pressed]]:bg-wash",
						"**:data-[slot=menu-trigger]:absolute **:data-[slot=menu-trigger]:right-0 **:data-[slot=menu-trigger]:flex **:data-[slot=menu-trigger]:h-full **:data-[slot=menu-trigger]:w-auto **:data-[slot=menu-trigger]:items-center **:data-[slot=menu-trigger]:justify-end **:data-[slot=menu-trigger]:px-2.5 **:data-[slot=menu-trigger]:opacity-0 **:data-[slot=menu-trigger]:data-pressed:opacity-100 **:data-[slot=menu-trigger]:has-data-focus:opacity-100 **:data-[slot=menu-trigger]:focus-visible:opacity-100 hover:**:data-[slot=menu-trigger]:opacity-100",
						"**:data-[slot=icon]:size-5 **:data-[slot=icon]:shrink-0 **:data-[slot=icon]:text-fg-2 sm:**:data-[slot=icon]:size-4",
						"**:last:data-[slot=icon]:size-5 sm:**:last:data-[slot=icon]:size-4",
						"has-[[data-slot=avatar]]:has-[[data-slot=sidebar-label]]:gap-2 has-[[data-slot=icon]]:has-[[data-slot=sidebar-label]]:gap-2",
						"grid grid-cols-[auto_1fr_1.5rem_0.5rem_auto] **:last:data-[slot=icon]:ml-auto supports-[grid-template-columns:subgrid]:grid-cols-subgrid sm:text-sm/5",
						"p-2 has-[a]:p-0",
						"[--sidebar-current-bg:var(--color-sidebar-primary)] [--sidebar-current-fg:var(--color-sidebar-primary-fg)]",
						options.isCurrent &&
							"font-medium text-(--sidebar-current-fg) hover:bg-(--sidebar-current-bg) hover:text-(--sidebar-current-fg) **:data-[slot=icon]:text-(--sidebar-current-fg) hover:**:data-[slot=icon]:text-(--sidebar-current-fg) [&_.text-muted-fg]:text-fg/80",
						"hover:bg-wash hover:text-fg hover:**:data-[slot=icon]:text-fg-3 active:bg-wash active:text-fg active:**:data-[slot=icon]:text-fg-3",
						options.className,
					]),
				}),
			),
			...(options.ariaLabel ? [h.Attribute("aria-label", options.ariaLabel)] : []),
			// React Aria sets data-current whenever aria-current is present.
			...(options.isCurrent
				? [h.Attribute("aria-current", "page"), h.Attribute("data-current", "true")]
				: []),
			h.Attribute("tabindex", "0"),
			h.Attribute("role", "link"),
			h.Attribute("data-react-aria-pressable", "true"),
		],
		children,
	)

/** `<SidebarLink>`: TanStack `createLink` over React Aria Link, with `activeProps`. */
export const sidebarLink = <Message>(
	h: HtmlBuilder<Message>,
	options: {
		readonly href: string
		readonly isActive: boolean
		readonly activeClassName: string
		readonly className?: string
		readonly attributes?: ReadonlyArray<Attribute<Message>>
	},
	children: Html[],
): Html =>
	h.a(
		[
			...(options.attributes ?? []),
			...(options.isActive ? [h.Attribute("data-status", "active")] : []),
			h.Class(
				linkClassName({
					hasHref: true,
					className: twMerge(
						"col-span-full min-w-0 shrink-0 items-center p-2 focus:outline-hidden",
						"grid grid-cols-[auto_1fr_1.5rem_0.5rem_auto] supports-[grid-template-columns:subgrid]:grid-cols-subgrid",
						options.isActive ? options.activeClassName : undefined,
						options.className,
					),
				}),
			),
			h.Href(options.href),
			h.Attribute("tabindex", "0"),
			h.Attribute("data-react-aria-pressable", "true"),
			...(options.isActive
				? [h.Attribute("aria-current", "page"), h.Attribute("data-current", "true")]
				: []),
		],
		children,
	)

export const sidebarLabel = <Message>(h: HtmlBuilder<Message>, children: Array<Html | string>): Html =>
	h.span(
		[
			h.Class(
				twMerge("col-start-2 min-w-0 overflow-hidden whitespace-nowrap text-ellipsis outline-hidden"),
			),
			h.Attribute("data-slot", "sidebar-label"),
			h.Attribute("tabindex", "-1"),
			h.Attribute("slot", "label"),
		],
		children,
	)

/**
 * Discord's unread pill: a short bar on a row's left edge while its channel has messages the user
 * has not read. The row's rounded, clipped edge cuts its left side, so it reads as a tab.
 */
export const sidebarUnreadPip = <Message>(h: HtmlBuilder<Message>): Html =>
	h.span([
		h.AriaHidden(true),
		h.Attribute("data-slot", "sidebar-unread"),
		h.Class("pointer-events-none absolute top-1/2 left-0 h-2 w-1 -translate-y-1/2 rounded-r-full bg-fg"),
	])
