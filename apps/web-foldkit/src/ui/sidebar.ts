import type { Attribute, Html, HtmlBuilder } from "foldkit/html"
import { twJoin, twMerge } from "tailwind-merge"
import { linkClassName } from "./link"

/**
 * Port of `components/ui/sidebar.tsx`, desktop + expanded state only for now.
 * Each function copies the legacy `twMerge` arguments verbatim so class strings match.
 */

export type SidebarState = "expanded" | "collapsed"

export const sidebarProvider = <Message>(
	h: HtmlBuilder<Message>,
	options: { readonly width?: string; readonly className?: string },
	children: Html[],
): Html =>
	h.div(
		[
			h.Class(
				twMerge(
					"@container **:data-[slot=icon]:shrink-0",
					"flex w-full text-sidebar-fg",
					// Legacy's `has-data-[intent=inset]:*` variants are dropped: no sidebar here is inset, and a
					// `:has()` on the shell root restyles the whole page on every DOM insertion below it.
					"group/sidebar-root peer/sidebar-root",
					options.className,
				),
			),
			h.Style({ "--sidebar-width": options.width ?? "17rem", "--sidebar-width-dock": "3.25rem" }),
		],
		children,
	)

/** `<Sidebar collapsible="dock">` (desktop): gap + fixed container. */
export const sidebarDock = <Message>(
	h: HtmlBuilder<Message>,
	options: { readonly state: SidebarState; readonly className?: string },
	children: Html[],
): Html =>
	h.div(
		[
			h.Attribute("data-state", options.state),
			h.Attribute("data-collapsible", options.state === "collapsed" ? "dock" : ""),
			h.Attribute("data-intent", "default"),
			h.Attribute("data-side", "left"),
			h.Attribute("data-slot", "sidebar"),
			h.Class("group peer hidden text-sidebar-fg md:block"),
		],
		[
			h.div(
				[
					h.Attribute("data-slot", "sidebar-gap"),
					h.Attribute("aria-hidden", "true"),
					h.Class(
						twMerge([
							"w-(--sidebar-width) group-data-[collapsible=hidden]:w-0",
							"group-data-[side=right]:rotate-180",
							"relative h-svh bg-transparent transition-[width] duration-200 ease-linear",
							"group-data-[collapsible=dock]:w-(--sidebar-width-dock)",
						]),
					),
				],
				[],
			),
			h.div(
				[
					h.Attribute("data-slot", "sidebar-container"),
					h.Class(
						twMerge(
							"fixed inset-y-0 z-10 hidden w-(--sidebar-width) bg-sidebar",
							"not-has-data-[slot=sidebar-footer]:pb-2",
							"transition-[left,right,width] duration-200 ease-linear",
							"md:flex",
							"left-0 group-data-[collapsible=hidden]:left-[calc(var(--sidebar-width)*-1)]",
							[
								"group-data-[collapsible=dock]:w-(--sidebar-width-dock)",
								"border-sidebar-border group-data-[side=left]:border-r group-data-[side=right]:border-l",
							],
							options.className,
						),
					),
				],
				[
					h.div(
						[
							h.Attribute("data-sidebar", "default"),
							h.Attribute("data-slot", "sidebar-inner"),
							h.Class(
								twJoin(
									"flex h-full w-full flex-col text-sidebar-fg",
									"group-data-[intent=inset]:bg-sidebar dark:group-data-[intent=inset]:bg-bg",
									"group-data-[intent=float]:rounded-lg group-data-[intent=float]:border group-data-[intent=float]:border-sidebar-border group-data-[intent=float]:bg-sidebar group-data-[intent=float]:shadow-xs",
								),
							),
						],
						children,
					),
				],
			),
		],
	)

/** `<Sidebar collapsible="none">` */
export const sidebarStatic = <Message>(h: HtmlBuilder<Message>, className: string, children: Html[]): Html =>
	h.div(
		[
			h.Attribute("data-intent", "default"),
			h.Attribute("data-collapsible", "none"),
			h.Attribute("data-slot", "sidebar"),
			h.Class(
				twMerge("flex h-full w-(--sidebar-width) flex-col bg-sidebar text-sidebar-fg", className),
			),
		],
		children,
	)

export const sidebarHeader = <Message>(
	h: HtmlBuilder<Message>,
	options: { readonly state: SidebarState; readonly className?: string },
	children: Html[],
): Html =>
	h.div(
		[
			h.Attribute("data-slot", "sidebar-header"),
			h.Class(
				twMerge(
					"flex flex-col gap-2 [.border-b]:border-sidebar-border",
					"in-data-[intent=inset]:p-4",
					options.state === "collapsed" ? "items-center p-2.5" : "p-4",
					options.className,
				),
			),
			h.Attribute("data-tauri-drag-region", "true"),
		],
		children,
	)

export const sidebarContent = <Message>(
	h: HtmlBuilder<Message>,
	options: { readonly state: SidebarState; readonly className?: string },
	children: Html[],
): Html =>
	h.div(
		[
			h.Attribute("data-slot", "sidebar-content"),
			h.Class(
				twMerge(
					"flex min-h-0 flex-1 scroll-mb-96 flex-col overflow-auto overscroll-none *:data-[slot=sidebar-section]:border-l-0",
					options.state === "collapsed" ? "items-center" : "mask-b-from-95%",
					options.className,
				),
			),
		],
		children,
	)

export const sidebarFooter = <Message>(
	h: HtmlBuilder<Message>,
	className: string | undefined,
	children: Html[],
): Html =>
	h.div(
		[
			h.Attribute("data-slot", "sidebar-footer"),
			h.Class(
				twMerge([
					"mt-auto flex shrink-0 items-center justify-center p-4 **:data-[slot=chevron]:text-muted-fg",
					"in-data-[intent=inset]:px-6 in-data-[intent=inset]:py-4",
					className,
				]),
			),
		],
		children,
	)

export const sidebarSectionGroup = <Message>(h: HtmlBuilder<Message>, children: Html[]): Html =>
	h.section(
		[
			h.Attribute("data-slot", "sidebar-section-group"),
			h.Class(twMerge("flex w-full min-w-0 flex-col gap-y-0.5")),
		],
		children,
	)

export const sidebarSection = <Message>(
	h: HtmlBuilder<Message>,
	options: { readonly label?: string; readonly className?: string },
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
						"w-full min-w-0 items-center rounded-lg text-left font-medium text-base/6 text-sidebar-fg",
						"group/sidebar-item relative col-span-full overflow-hidden focus-visible:outline-hidden",
						"**:data-[slot=menu-trigger]:absolute **:data-[slot=menu-trigger]:right-0 **:data-[slot=menu-trigger]:flex **:data-[slot=menu-trigger]:h-full **:data-[slot=menu-trigger]:w-auto **:data-[slot=menu-trigger]:items-center **:data-[slot=menu-trigger]:justify-end **:data-[slot=menu-trigger]:px-2.5 **:data-[slot=menu-trigger]:opacity-0 **:data-[slot=menu-trigger]:pressed:opacity-100 **:data-[slot=menu-trigger]:has-data-focus:opacity-100 **:data-[slot=menu-trigger]:focus-visible:opacity-100 hover:**:data-[slot=menu-trigger]:opacity-100",
						"**:data-[slot=icon]:size-5 **:data-[slot=icon]:shrink-0 **:data-[slot=icon]:text-muted-fg sm:**:data-[slot=icon]:size-4",
						"**:last:data-[slot=icon]:size-5 sm:**:last:data-[slot=icon]:size-4",
						"has-[[data-slot=avatar]]:has-[[data-slot=sidebar-label]]:gap-2 has-[[data-slot=icon]]:has-[[data-slot=sidebar-label]]:gap-2",
						"grid grid-cols-[auto_1fr_1.5rem_0.5rem_auto] **:last:data-[slot=icon]:ml-auto supports-[grid-template-columns:subgrid]:grid-cols-subgrid sm:text-sm/5",
						"p-2 has-[a]:p-0",
						"[--sidebar-current-bg:var(--color-sidebar-primary)] [--sidebar-current-fg:var(--color-sidebar-primary-fg)]",
						options.isCurrent &&
							"font-medium text-(--sidebar-current-fg) hover:bg-(--sidebar-current-bg) hover:text-(--sidebar-current-fg) **:data-[slot=icon]:text-(--sidebar-current-fg) hover:**:data-[slot=icon]:text-(--sidebar-current-fg) [&_.text-muted-fg]:text-fg/80",
						"hover:bg-sidebar-accent hover:text-sidebar-accent-fg hover:**:data-[slot=icon]:text-sidebar-accent-fg",
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
	options: { readonly href: string; readonly isActive: boolean; readonly activeClassName: string },
	children: Html[],
): Html =>
	h.a(
		[
			...(options.isActive ? [h.Attribute("data-status", "active")] : []),
			h.Class(
				linkClassName({
					hasHref: true,
					className: twMerge(
						"col-span-full min-w-0 shrink-0 items-center p-2 focus:outline-hidden",
						"grid grid-cols-[auto_1fr_1.5rem_0.5rem_auto] supports-[grid-template-columns:subgrid]:grid-cols-subgrid",
						options.isActive ? options.activeClassName : undefined,
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

export const sidebarInset = <Message>(h: HtmlBuilder<Message>, className: string, children: Html[]): Html =>
	h.main(
		[
			h.Attribute("data-slot", "sidebar-inset"),
			h.Class(
				twMerge(
					// The inset-only `group-has-*` variants are dropped like on `sidebarProvider` (never inset).
					"relative flex w-full flex-1 flex-col bg-bg lg:min-w-0",
					className,
				),
			),
		],
		children,
	)
