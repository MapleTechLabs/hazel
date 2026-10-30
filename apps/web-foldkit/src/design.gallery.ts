import "@fontsource/inter/400.css"
import "@fontsource/inter/400-italic.css"
import "@fontsource/inter/500.css"
import "@fontsource/inter/600.css"
import "./styles.css"
import type { ChannelId } from "@hazel/schema"
import { Context } from "effect"
import type { Html, HtmlBuilder } from "foldkit/html"
import { MountTracker } from "foldkit/mount"
import { __clearRuntime, __htmlBuilder, __setRuntime } from "foldkit-internal/html/index.js"
import { Dispatch } from "foldkit-internal/runtime/dispatch.js"
import { patch } from "foldkit-internal/vdom.js"
import { twMerge } from "tailwind-merge"
import { afterEach, test } from "vitest"
import { page, userEvent } from "vitest/browser"
import { dropdownItemStyles, dropdownLabelBase, dropdownSeparatorBase } from "~/components/ui/dropdown.styles"
import { menuContentStyles, menuPopoverBase } from "~/components/ui/menu.styles"
import { popoverContentBase } from "~/components/ui/popover.styles"
import { IconBell, IconCopy, IconPlus, IconStar, IconTrash, IconUsers } from "./icons"
import type { ChannelEntry } from "./shell/channels-sidebar/rows"
import { channelItem } from "./shell/channels-sidebar/items"
import { sectionGroupHeader, sectionPlusButton } from "./shell/channels-sidebar/tree"
import { badge } from "./ui/badge"
import { button } from "./ui/button"
import { card, cardBody, cardDescription, cardHeader, cardTitle } from "./ui/card"
import { textField } from "./ui/text-field"

/**
 * The design gallery: a sidebar, a settings card, the button and badge sets and an open menu, built
 * from the kit's real views and the app stylesheet, screenshotted in light and dark. Not a test:
 * `VITE_GALLERY_LABEL=before bun run gallery` writes `src/before-light.png` and `src/before-dark.png`.
 */

type M = never

const render = (view: (h: HtmlBuilder<M>) => Html) => {
	const dispatch = Dispatch.of({ dispatchAsync: () => undefined as never, dispatchSync: () => undefined })
	__setRuntime(
		dispatch.dispatchSync,
		Context.make(Dispatch, dispatch).pipe(
			Context.add(MountTracker, { started: () => {}, ended: () => {} }),
		),
	)
	try {
		const vnode = view(__htmlBuilder<M>())
		const container = document.createElement("div")
		document.body.append(container)
		if (vnode) patch(container, vnode)
	} finally {
		__clearRuntime()
	}
}

afterEach(() => {
	document.body.innerHTML = ""
	document.documentElement.classList.remove("dark")
})

const entry = (id: string, name: string, notificationCount = 0): ChannelEntry =>
	({
		channel: { id: id as ChannelId, name, type: "public", icon: null, sectionId: null },
		member: { id, isMuted: false, isFavorite: false, notificationCount },
	}) as unknown as ChannelEntry

const channels: ReadonlyArray<readonly [ChannelEntry, boolean]> = [
	[entry("00000000-0000-4000-8000-000000000001", "general"), true],
	[entry("00000000-0000-4000-8000-000000000002", "design", 3), false],
	[entry("00000000-0000-4000-8000-000000000003", "engineering"), false],
	[entry("00000000-0000-4000-8000-000000000004", "product-updates", 12), false],
	[entry("00000000-0000-4000-8000-000000000005", "random"), false],
]

const sidebar = (h: HtmlBuilder<M>) =>
	h.aside(
		[
			h.Class(
				"flex w-60 shrink-0 flex-col gap-y-0.5 border-sidebar-border border-r bg-sidebar p-3 text-sidebar-fg",
			),
		],
		[
			h.div(
				[h.Class("grid grid-cols-[auto_1fr] gap-y-0.5")],
				[
					sectionGroupHeader(h, {
						name: "Channels",
						isCollapsed: false,
						action: sectionPlusButton(h, "Create channel", []),
					}),
					...channels.map(([channel, isActive]) =>
						channelItem(h, channel, channel.member.notificationCount, [], {
							orgSlug: "acme",
							isActive,
						}),
					),
				],
			),
		],
	)

const menuItem = (
	h: HtmlBuilder<M>,
	icon: Html,
	text: string,
	options: { isFocused?: boolean; intent?: "danger"; keys?: string } = {},
) =>
	h.div(
		[
			h.Class(dropdownItemStyles({ isFocused: options.isFocused, intent: options.intent })),
			h.Attribute("role", "menuitem"),
			...(options.isFocused ? [h.DataAttribute("focused", "true")] : []),
		],
		[
			icon,
			h.span([h.Class(twMerge(dropdownLabelBase)), h.Attribute("slot", "label")], [text]),
			...(options.keys ? [h.kbd([h.Class("col-start-5 text-muted-fg text-xs")], [options.keys])] : []),
		],
	)

const menu = (h: HtmlBuilder<M>) =>
	h.div(
		[h.Class(twMerge(twMerge(...popoverContentBase), menuPopoverBase, "w-56"))],
		[
			h.div(
				[h.Class(menuContentStyles()), h.Attribute("role", "menu")],
				[
					menuItem(h, IconBell(h), "Mute channel", { isFocused: true }),
					menuItem(h, IconCopy(h), "Copy link"),
					menuItem(h, IconStar(h), "Add to favorites"),
					menuItem(h, IconUsers(h), "Members"),
					h.div([h.Class(dropdownSeparatorBase), h.Attribute("role", "separator")], []),
					menuItem(h, IconTrash(h), "Delete channel", { intent: "danger" }),
				],
			),
		],
	)

const settings = (h: HtmlBuilder<M>) =>
	card(h, {}, [
		cardHeader(h, [
			cardTitle(h, {}, ["Channel settings"]),
			cardDescription(h, {}, ["Name, topic and who can join #general."]),
		]),
		cardBody(
			h,
			[
				textField(h, { id: "name", value: "general" }, (parts) => [
					parts.label(["Name"]),
					parts.input({}),
				]),
				textField(h, { id: "topic", value: "" }, (parts) => [
					parts.label(["Topic"]),
					parts.input({ placeholder: "What is this channel about?" }),
					parts.description(["Shown under the channel name."]),
				]),
				h.div(
					[h.Class("flex justify-end gap-2")],
					[
						button(h, { intent: "secondary", size: "sm" }, ["Keep it"]),
						button(h, { intent: "primary", size: "sm" }, ["Save changes"]),
					],
				),
			],
			"flex flex-col gap-4",
		),
	])

const controls = (h: HtmlBuilder<M>) =>
	h.div(
		[h.Class("flex flex-col gap-4")],
		[
			h.div(
				[h.Class("flex flex-wrap items-center gap-2")],
				[
					button(h, { intent: "primary", size: "sm" }, [IconPlus(h), "New channel"]),
					button(h, { intent: "secondary", size: "sm" }, ["Invite people"]),
					button(h, { intent: "outline", size: "sm" }, ["Export"]),
					button(h, { intent: "plain", size: "sm" }, ["Archive"]),
					button(h, { intent: "danger", size: "sm" }, ["Delete"]),
				],
			),
			h.div(
				[h.Class("flex flex-wrap items-center gap-2")],
				[
					badge(h, { intent: "primary" }, ["New"]),
					badge(h, { intent: "secondary" }, ["Guest"]),
					badge(h, { intent: "success" }, ["Online"]),
					badge(h, { intent: "warning" }, ["Away"]),
					badge(h, { intent: "danger" }, ["Blocked"]),
					badge(h, { intent: "outline" }, ["Bot"]),
				],
			),
			menu(h),
		],
	)

const screen = (h: HtmlBuilder<M>) =>
	h.div(
		[h.Id("gallery"), h.Class("flex h-[640px] w-[1180px] bg-bg font-sans text-fg antialiased")],
		[
			sidebar(h),
			h.main(
				[h.Class("grid flex-1 grid-cols-[1fr_17rem] items-start gap-8 p-8")],
				[settings(h), controls(h)],
			),
		],
	)

for (const theme of ["light", "dark"] as const) {
	test(theme, async () => {
		if (theme === "dark") document.documentElement.classList.add("dark")
		render(screen)
		await document.fonts.ready
		// One sidebar row under the pointer, so its hover state shows.
		await userEvent.hover(page.getByText("engineering"))
		const label = import.meta.env.VITE_GALLERY_LABEL ?? "gallery"
		await page.screenshot({ path: `${label}-${theme}.png`, element: document.getElementById("gallery")! })
	})
}
