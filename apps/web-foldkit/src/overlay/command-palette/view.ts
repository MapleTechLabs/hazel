import { Submodel } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { dropdownLabelBase } from "~/components/ui/dropdown.styles"
import { cn } from "~/lib/utils"
import {
	IconBell,
	IconCircleDottedUser,
	IconDashboard,
	IconGear,
	IconHashtag,
	IconIntegratio,
	IconMagnifier3,
	IconMsgs,
	IconPlus,
	IconServers,
	IconUsersPlus,
} from "../../icons"
import type { Shared } from "../../page/contract"
import type * as CommandMenu from "../../ui/command-menu"
import { commandMenuShortcut, view as commandMenuView } from "../../ui/command-menu-view"
import { labelId } from "../../ui/menu"
import { fallbackAvatar } from "../avatar"
import { createChannelPage, joinChannelPage } from "./form-pages"
import { dmDisplayName, HOTKEYS, NAVIGATION, parseKey, recentChannelsOf, SETTINGS, STATUS_OPTIONS } from "./menu"
import { Message } from "./message"
import { type ChannelSummary, type DmChannel, isFormPage, type Model } from "./model"
import { searchPage } from "./search-view"
import { MENU_ID } from "./update"

/** `CommandPalette` (`command-palette-root.tsx`): the CommandMenu with the current page inside. */

const toMenuMessage = (message: CommandMenu.Message): Message => Message.GotMenuMessage({ message })

const label = (h: HtmlBuilder<Message>, key: string, children: Array<Html | string>): Html =>
	h.span([h.Class(twMerge(dropdownLabelBase)), h.Id(labelId(MENU_ID, key)), h.Attribute("slot", "label")], children)

const current = (h: HtmlBuilder<Message>) => h.span([h.Class("ml-2 text-muted-fg text-xs")], ["(current)"])

const channelIcon = (h: HtmlBuilder<Message>, icon: string | null): Html =>
	icon ? h.span([h.Attribute("data-slot", "icon")], [icon]) : IconHashtag(h)

/** A DM's icon: the partner's avatar, or up to two stacked avatars and a "+N" for groups. */
const dmIcon = (h: HtmlBuilder<Message>, dm: DmChannel): Html => {
	const first = dm.otherMembers[0]
	if (dm.type === "single" && dm.otherMembers.length === 1 && first)
		return fallbackAvatar(h, { size: "xs", className: "mr-1", src: first.avatarUrl, alt: dmDisplayName(dm) })
	return h.div(
		[h.Attribute("data-slot", "icon"), h.Class("flex -space-x-2 mr-1")],
		[
			...dm.otherMembers.slice(0, 2).map((member) =>
				fallbackAvatar(h, {
					size: "xs",
					src: member.avatarUrl,
					alt: member.firstName,
					className: "ring-[1.5px] ring-overlay",
				}),
			),
			...(dm.otherMembers.length > 2
				? [
						fallbackAvatar(h, {
							size: "xs",
							className: "ring-[1.5px] ring-overlay",
							placeholder: h.span(
								[h.Class("flex items-center justify-center font-semibold text-quaternary text-xs")],
								[`+${dm.otherMembers.length - 2}`],
							),
						}),
					]
				: []),
		],
	)
}

const channelContent = (h: HtmlBuilder<Message>, key: string, channel: ChannelSummary | undefined) =>
	channel ? [channelIcon(h, channel.icon), label(h, key, [channel.name])] : []

const QUICK_ACTIONS: Readonly<
	Record<string, { icon: (h: HtmlBuilder<Message>) => Html; text: string; shortcut?: string }>
> = {
	"action:search": { icon: (h) => IconMagnifier3(h), text: "Search messages", shortcut: HOTKEYS.search },
	"action:create-channel": { icon: (h) => IconPlus(h), text: "Create channel", shortcut: HOTKEYS.createChannel },
	"action:start-dm": { icon: (h) => IconMsgs(h), text: "Start conversation", shortcut: HOTKEYS.createDm },
	"action:join-channel": { icon: (h) => IconPlus(h), text: "Join channel" },
	"action:invite": { icon: (h) => IconUsersPlus(h), text: "Invite members", shortcut: HOTKEYS.invite },
	"pref:status": { icon: (h) => IconCircleDottedUser(h), text: "Set status..." },
	"pref:appearance": { icon: (h) => IconGear(h), text: "Change appearance..." },
}

const LINK_ICONS: Readonly<Record<string, (h: HtmlBuilder<Message>) => Html>> = {
	"nav:dashboard": (h) => IconDashboard(h),
	"nav:chat": (h) => IconMsgs(h),
	"nav:notifications": (h) => IconBell(h),
	"nav:my-settings": (h) => IconGear(h),
	"nav:profile": (h) => IconCircleDottedUser(h),
	"settings:general": (h) => IconGear(h),
	"settings:team": (h) => IconDashboard(h),
	"settings:integrations": (h) => IconIntegratio(h),
	"settings:invitations": (h) => IconUsersPlus(h),
	"settings:debug": (h) => IconServers(h),
}

const THEME_ICONS: Readonly<Record<string, (h: HtmlBuilder<Message>) => Html>> = {
	system: (h) =>
		h.div(
			[h.Class("flex size-4 overflow-hidden rounded-sm"), h.Attribute("data-slot", "icon")],
			[h.div([h.Class("w-1/2 bg-white")], []), h.div([h.Class("w-1/2 bg-zinc-900")], [])],
		),
	light: (h) => h.div([h.Class("size-4 rounded-sm border border-zinc-200 bg-white"), h.Attribute("data-slot", "icon")], []),
	dark: (h) => h.div([h.Class("size-4 rounded-sm border border-zinc-700 bg-zinc-900"), h.Attribute("data-slot", "icon")], []),
}

const THEME_LABELS: Readonly<Record<string, string>> = { system: "System", light: "Light", dark: "Dark" }

/** The children of one `CommandMenuItem`, by key. */
const itemContent = (h: HtmlBuilder<Message>, model: Model, key: string): ReadonlyArray<Html> => {
	const action = QUICK_ACTIONS[key]
	if (action)
		return [
			action.icon(h),
			label(h, key, [action.text]),
			...(action.shortcut ? [commandMenuShortcut(h, MENU_ID, key, action.shortcut)] : []),
		]
	const link = [...NAVIGATION, ...SETTINGS].find((entry) => entry.key === key)
	if (link) return [LINK_ICONS[key]?.(h) ?? h.empty, label(h, key, [link.label])]
	const { kind, value } = parseKey(key)
	if (kind === "channel") return channelContent(h, key, model.channels.find((channel) => channel.id === value))
	const dm = model.dmChannels.find((candidate) => candidate.id === value)
	if (kind === "dm") return dm ? [dmIcon(h, dm), label(h, key, [dmDisplayName(dm)])] : []
	if (kind === "recent") {
		const channel = recentChannelsOf(model).find((candidate) => candidate.id === value)
		return dm && channel && channel.type !== "public" && channel.type !== "private"
			? [dmIcon(h, dm), label(h, key, [dmDisplayName(dm)])]
			: channelContent(h, key, channel)
	}
	const status = STATUS_OPTIONS.find((option) => option.value === value)
	if (kind === "status" && status)
		return [
			h.span([h.Class(cn("size-3 shrink-0 rounded-full", status.color)), h.Attribute("data-slot", "icon")], []),
			label(h, key, [status.label, ...(model.presenceStatus === value ? [current(h)] : [])]),
		]
	if (kind === "theme")
		return [
			THEME_ICONS[value]?.(h) ?? h.empty,
			label(h, key, [THEME_LABELS[value] ?? value, ...(model.theme === value ? [current(h)] : [])]),
		]
	return []
}

const PLACEHOLDERS: Readonly<Record<string, string>> = {
	Status: "Set your status...",
	Appearance: "Change appearance...",
}

export interface ViewInputs {
	readonly shared: Shared
}

export const view = Submodel.defineView<Model, Message, ViewInputs>((model, _inputs, h) => {
	if (!model.isOpen) return h.empty
	const page = model.page
	return h.submodel({
		slotId: "command-palette-menu",
		model: model.menu,
		view: commandMenuView,
		viewInputs: {
			content: (key) => itemContent(h, model, key),
			placeholder: PLACEHOLDERS[page._tag] ?? "Where would you like to go?",
			...(isFormPage(page)
				? {
						toFormPage: () => [
							page._tag === "CreateChannel"
								? createChannelPage(h, page)
								: page._tag === "JoinChannel"
									? joinChannelPage(h, model, page)
									: page._tag === "Search"
										? searchPage(h, model, page)
										: h.empty,
						],
					}
				: {}),
		},
		toParentMessage: toMenuMessage,
	})
})
