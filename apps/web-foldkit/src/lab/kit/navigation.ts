import type { Html, HtmlBuilder } from "foldkit/html"
import {
	IconBell,
	IconChevronLeft,
	IconCode,
	IconFolders,
	IconHashtag,
	IconLink,
	IconMsgs,
	IconPin,
	IconPlus,
	IconThread,
} from "../../icons"
import { badge } from "../../ui/badge"
import { button } from "../../ui/button"
import { mobileTopBar } from "../../ui/mobile-top-bar"
import {
	sectionHeaderActions,
	sectionHeaderGroup,
	sectionHeaderHeading,
	sectionHeaderRoot,
	sectionHeaderSubheading,
} from "../../ui/section-header"
import { sidebarItem, sidebarLabel, sidebarSection, sidebarStatic } from "../../ui/sidebar"
import { tabStrip, tabView } from "../../ui/tab-strip"
import * as Tabs from "../../ui/tabs"
import * as Toolbar from "../../ui/toolbar"
import { kitSection, pair, specimen } from "./chrome"
import { Message, type Model, type SettingsTab, SettingsTabs } from "./model"

type H = HtmlBuilder<Message>

const TAB_LABELS = {
	general: "General",
	members: "Members",
	billing: "Billing",
} as const satisfies Record<SettingsTab, string>

const TAB_PANELS = {
	general: "Name, topic and who can join.",
	members: "42 people, 3 guests.",
	billing: "Pro, billed yearly.",
} as const satisfies Record<SettingsTab, string>

const ROUTE_TABS = [
	{ id: "messages", label: "Messages", icon: IconMsgs },
	{ id: "threads", label: "Threads", icon: IconThread },
	{ id: "files", label: "Files", icon: IconFolders },
	{ id: "pins", label: "Pins", icon: IconPin },
] as const

const FORMATS = [
	{ label: "Code", icon: IconCode },
	{ label: "Link", icon: IconLink },
	{ label: "Pin", icon: IconPin },
] as const

const CHANNELS = [
	{ name: "general", unread: 0 },
	{ name: "design", unread: 3 },
	{ name: "engineering", unread: 0 },
	{ name: "product-updates", unread: 12 },
] as const

const tabs = (h: H, model: Model): Html =>
	specimen(
		h,
		{
			name: "Tabs",
			file: "ui/tabs.ts",
			note: "Views of one thing, switched in place. Arrow keys move between them.",
			className: "flex-col items-stretch",
		},
		[
			h.submodel({
				slotId: model.tabs.id,
				model: model.tabs,
				view: SettingsTabs.view,
				viewInputs: {
					tabs: ["general", "members", "billing"],
					selectedValue: model.tab,
					ariaLabel: "Channel settings",
					toView: (render) =>
						Tabs.layout(h, render, {
							tab: (value) => [TAB_LABELS[value]],
							panel: (value) => [h.p([h.Class("text-fg-3")], [TAB_PANELS[value]])],
						}),
				},
				toParentMessage: (message) => Message.GotTabsMessage({ message }),
			}),
		],
	)

const strip = (h: H, model: Model): Html =>
	specimen(
		h,
		{
			name: "Tab strip",
			file: "ui/tab-strip.ts",
			note: "The same tabs when the selection is the route: the chat's tab bar, a settings page.",
			className: "flex-col items-stretch",
		},
		[
			tabStrip(
				h,
				{},
				ROUTE_TABS.map((entry) =>
					tabView(h, {
						id: entry.id,
						label: entry.label,
						icon: entry.icon(h),
						isSelected: model.routeTab === entry.id,
						attributes: [h.OnClick(Message.ChoseRouteTab({ key: entry.id }))],
					}),
				),
			),
		],
	)

const toolbar = (h: H, model: Model): Html =>
	specimen(
		h,
		{
			name: "Toolbar",
			file: "ui/toolbar.ts",
			note: "A row of related actions that is one stop in the tab order. Arrow keys move inside it.",
		},
		[
			h.submodel({
				slotId: "kit-toolbar",
				model: model.toolbar,
				view: Toolbar.view,
				viewInputs: {
					className: "rounded-lg border border-border p-0.5",
					// A function: the buttons carry handlers, which only a top-level viewInput scopes.
					content: () =>
						FORMATS.map((entry) =>
							button(
								h,
								{
									intent: "plain",
									size: "sq-sm",
									onPress: Message.PressedAction({ label: entry.label }),
									attributes: [h.AriaLabel(entry.label)],
								},
								[entry.icon(h)],
							),
						),
				},
				toParentMessage: (message: Toolbar.Message) => Message.GotToolbarMessage({ message }),
			}),
		],
	)

const sectionHeader = (h: H): Html =>
	specimen(
		h,
		{
			name: "Section header",
			file: "ui/section-header.ts",
			note: "A settings page's title, what it is for, and its one action.",
			className: "flex-col items-stretch",
		},
		[
			sectionHeaderRoot(h, {}, [
				sectionHeaderGroup(h, {}, [
					h.div(
						[h.Class("flex flex-1 flex-col gap-0.5")],
						[
							sectionHeaderHeading(h, {}, ["Members"]),
							sectionHeaderSubheading(h, {}, ["Who can read and post in this workspace."]),
						],
					),
					sectionHeaderActions(h, {}, [
						button(
							h,
							{
								intent: "primary",
								size: "sm",
								onPress: Message.PressedAction({ label: "Invite" }),
							},
							[IconPlus(h), "Invite"],
						),
					]),
				]),
			]),
		],
	)

const sidebar = (h: H): Html =>
	specimen(
		h,
		{
			name: "Sidebar",
			file: "ui/sidebar.ts",
			note: "The current row is a tint, a hovered one a wash. Unread counts sit at the row's end.",
			className: "bg-muted/40 p-4",
		},
		[
			sidebarStatic(h, "h-auto w-60 rounded-lg border border-sidebar-border", [
				sidebarSection(
					h,
					{ label: "Channels", className: "p-2" },
					CHANNELS.map((channel) =>
						sidebarItem(h, { isCurrent: channel.name === "general" }, [
							IconHashtag(h),
							sidebarLabel(h, [channel.name]),
							...(channel.unread === 0
								? []
								: [
										badge(
											h,
											{
												intent: "secondary",
												size: "sm",
												isPill: true,
												className: "absolute top-1/2 right-1.5 -translate-y-1/2",
											},
											[String(channel.unread)],
										),
									]),
						]),
					),
				),
			]),
		],
	)

const topBar = (h: H): Html =>
	specimen(
		h,
		{
			name: "Mobile top bar",
			file: "ui/mobile-top-bar.ts",
			note: "A phone screen's bar: 56pt high, a 44pt target at each end, the title between.",
			className: "bg-muted/40 p-4",
		},
		[
			h.div(
				[h.Class("w-full max-w-sm overflow-hidden rounded-lg border border-border")],
				[
					mobileTopBar(h, {
						title: "general",
						leading: button(
							h,
							{
								intent: "plain",
								size: "sq-md",
								onPress: Message.PressedAction({ label: "Back" }),
								attributes: [h.AriaLabel("Back")],
							},
							[IconChevronLeft(h)],
						),
						trailing: button(
							h,
							{
								intent: "plain",
								size: "sq-md",
								onPress: Message.PressedAction({ label: "Notifications" }),
								attributes: [h.AriaLabel("Notifications")],
							},
							[IconBell(h)],
						),
					}),
				],
			),
		],
	)

export const navigation = (h: H, model: Model): Html =>
	kitSection(h, "navigation", [
		pair(h, [tabs(h, model), strip(h, model)]),
		pair(h, [toolbar(h, model), sectionHeader(h)]),
		pair(h, [sidebar(h), topBar(h)]),
	])
