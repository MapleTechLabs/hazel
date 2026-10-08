import type { Html, HtmlBuilder } from "foldkit/html"
import { twJoin } from "tailwind-merge"
import {
	IconChevronUpDown,
	IconCirclePlus,
	IconEmoji1,
	IconFolderPlus,
	IconGear,
	IconIntegratio,
	IconLogout,
	IconPlus,
	IconProfiles2,
	IconServers,
	IconSupport,
	IconUsers,
	IconUsersPlus,
} from "../icons"
import { avatar } from "../ui/avatar"
import * as Menu from "../ui/menu"
import { menuLabel, menuTriggerClassName, view as menuView } from "../ui/menu-view"
import { sidebarFooter, sidebarHeader, sidebarLabel } from "../ui/sidebar"
import type { ShellContext } from "./context"
import type { UserStatus } from "./model"

/** The user menu (`sidebar/user-menu.tsx`) and the org switcher (`channels-sidebar.tsx` header). */

export const USER_MENU_ID = "user-menu"
export const ORG_SWITCHER_ID = "org-switcher"

export interface SwitcherOrg {
	readonly id: string
	readonly name: string
	readonly slug: string | null
	readonly logoUrl: string | null
}

// ENTRIES

export const userMenuEntries = (orgSlug: string, userId: string): ReadonlyArray<Menu.Entry> => [
	Menu.section(undefined, [], { header: { key: "header", hasSeparator: true } }),
	Menu.item("profile", { href: `/${orgSlug}/profile/${userId}` }),
	Menu.item("status"),
	Menu.item("my-settings", { href: `/${orgSlug}/my-settings` }),
	Menu.separator,
	Menu.item("feedback"),
	Menu.separator,
	Menu.item("logout"),
]

/** `SwitchServerMenu` at the root: the orgs section, a separator, then "Create server". */
const switchServerEntries = (organizations: ReadonlyArray<SwitcherOrg>): ReadonlyArray<Menu.Entry> => [
	Menu.section(
		undefined,
		organizations.map((organization) =>
			Menu.item(`org:${organization.id}`, { textValue: organization.name }),
		),
	),
	Menu.separator,
	Menu.item("create-server", { textValue: "Create server" }),
]

/** Chat routes get the full menu, settings and my-settings a shorter one; mobile only switches orgs. */
export const orgSwitcherEntries = (options: {
	readonly orgSlug: string
	readonly isChat: boolean
	readonly isMobile: boolean
	readonly canCreateChannel: boolean
	readonly organizations: ReadonlyArray<SwitcherOrg>
}): ReadonlyArray<Menu.Entry> => {
	if (options.isMobile) return switchServerEntries(options.organizations)
	const org = `/${options.orgSlug}`
	// NOTE: legacy renders the orgs as a single-selection section plus a separator; the kit submenu takes leaves.
	const switchServer = Menu.item("switch-server", {
		submenu: [
			...options.organizations.map((organization) =>
				Menu.leaf(`org:${organization.id}`, { textValue: organization.name }),
			),
			Menu.leaf("create-server", { textValue: "Create server" }),
		],
	})
	const people = Menu.section(undefined, [
		Menu.item("invite-people"),
		Menu.item("manage-members", { href: `${org}/settings/team` }),
	])
	if (!options.isChat)
		return [
			people,
			switchServer,
			Menu.separator,
			Menu.section(undefined, [Menu.item("server-settings", { href: `${org}/settings` })]),
		]
	return [
		people,
		switchServer,
		Menu.separator,
		Menu.section(undefined, [
			...(options.canCreateChannel ? [Menu.item("create-channel")] : []),
			Menu.item("create-category"),
		]),
		Menu.separator,
		Menu.section(undefined, [
			Menu.item("server-settings", { href: `${org}/settings` }),
			Menu.item("custom-emojis", { href: `${org}/settings/custom-emojis` }),
			Menu.item("integrations", { href: `${org}/settings/integrations` }),
		]),
	]
}

// VIEW

const label = <M>(h: HtmlBuilder<M>, id: string, key: string, text: string) => menuLabel(h, id, key, text)

/** Legacy `formatStatusExpiration` (`utils/status.ts`) at `nowMs` instead of `new Date()`. */
export const formatStatusExpirationAt = (expiresAtMs: number | null, nowMs: number): string | null => {
	if (expiresAtMs === null || expiresAtMs <= nowMs) return null
	const expiry = new Date(expiresAtMs)
	const diffMs = expiresAtMs - nowMs
	const diffMins = Math.round(diffMs / (1000 * 60))
	const diffHours = Math.round(diffMs / (1000 * 60 * 60))
	if (diffMins < 60) return `${diffMins} min`
	if (diffHours < 24) {
		const timeStr = expiry.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
		return expiry.toDateString() === new Date(nowMs).toDateString() ? timeStr : `tomorrow ${timeStr}`
	}
	return expiry.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })
}

/** `StatusEmojiWithTooltip` with `interactive={false}`: the emoji with a native title (no quiet hours). */
const statusEmojiTitled = <M>(
	h: HtmlBuilder<M>,
	status: UserStatus | null,
	expiration: string | null,
): ReadonlyArray<Html> => {
	if (!status?.emoji) return []
	const { emoji, message } = status
	const title = message
		? `${emoji} ${message}${expiration ? ` • Until ${expiration}` : ""}`
		: expiration
			? `${emoji} • Until ${expiration}`
			: emoji
	return [h.span([h.Class("text-sm ml-1"), h.Attribute("title", title)], [emoji])]
}

const userMenuContent =
	<M>(h: HtmlBuilder<M>, context: ShellContext, status: UserStatus | null) =>
	(key: string): ReadonlyArray<Html> => {
		const displayName = context.currentUser?.displayName ?? "User"
		const item = (icon: Html, text: string) => [icon, label(h, USER_MENU_ID, key, text)]
		if (key === "header")
			return [
				h.span([h.Class("block")], [displayName]),
				...(context.currentUser?.email
					? [
							h.span(
								[h.Class("block truncate font-normal text-muted-fg")],
								[context.currentUser.email],
							),
						]
					: []),
			]
		if (key === "profile") return item(IconProfiles2(h), "Profile")
		if (key === "status")
			return [
				IconEmoji1(h),
				menuLabel(h, USER_MENU_ID, key, [
					"Set status",
					...(status?.emoji ? [h.span([h.Class("ml-1")], [status.emoji])] : []),
				]),
			]
		if (key === "my-settings") return item(IconGear(h), "My Settings")
		if (key === "feedback") return item(IconSupport(h), "Feedback")
		if (key === "logout") return item(IconLogout(h), "Log out")
		return []
	}

/** `SidebarFooter` > `UserMenu`. */
export const userMenuFooter = <M>(
	h: HtmlBuilder<M>,
	menu: Menu.Model,
	context: ShellContext,
	toMenuMessage: (message: Menu.Message) => M,
	status: UserStatus | null,
	/** `formatStatusExpirationAt` of the status, computed by the root from its clock. */
	statusExpiration: string | null,
): Html => {
	const displayName = context.currentUser?.displayName ?? "User"
	return sidebarFooter(h, "flex flex-row justify-between gap-4 group-data-[state=collapsed]:flex-col", [
		h.submodel({
			slotId: USER_MENU_ID,
			model: menu,
			view: menuView,
			viewInputs: {
				toTrigger: (attributes, overlay) =>
					h.button(
						[
							...attributes,
							h.Attribute("data-slot", "menu-trigger"),
							h.Class(
								menuTriggerClassName(
									"flex w-full items-center justify-between rounded-lg border bg-accent/20 px-2 py-1 hover:bg-accent/50",
								),
							),
							h.Attribute("type", "button"),
							h.Attribute("tabindex", "0"),
							h.Attribute("data-react-aria-pressable", "true"),
							h.Attribute("aria-label", "Profile"),
						],
						[
							h.div(
								[h.Class("flex min-w-0 items-center gap-x-2")],
								[
									avatar(h, {
										className: twJoin([
											"[--avatar-radius:7%] group-data-[state=collapsed]:size-6 group-data-[state=collapsed]:*:size-6",
											"size-8 *:size-8",
										]),
										isSquare: true,
										src: context.currentUser?.avatarUrl,
										seed: displayName,
									}),
									h.div(
										[h.Class("in-data-[collapsible=dock]:hidden min-w-0 text-sm")],
										[
											sidebarLabel(h, [displayName, ...statusEmojiTitled(h, status, statusExpiration)]),
											...(context.currentUser?.email
												? [
														h.span(
															[
																h.Class(
																	"-mt-0.5 block max-w-36 truncate text-muted-fg",
																),
															],
															[context.currentUser.email],
														),
													]
												: []),
										],
									),
								],
							),
							IconChevronUpDown(h, {
								className: "size-4",
								attributes: { "data-slot": "chevron" },
							}),
							overlay,
						],
					),
				content: userMenuContent(h, context, status),
				className: "in-data-[collapsible=collapsed]:min-w-56 min-w-(--trigger-width)",
			},
			toParentMessage: toMenuMessage,
		}),
	])
}

const switcherContent =
	<M>(h: HtmlBuilder<M>, organizations: ReadonlyArray<SwitcherOrg>) =>
	(key: string): ReadonlyArray<Html> => {
		const item = (icon: Html, text: string) => [icon, label(h, ORG_SWITCHER_ID, key, text)]
		const organization = organizations.find((candidate) => `org:${candidate.id}` === key)
		if (organization)
			return [
				avatar(h, {
					size: "xs",
					src: organization.logoUrl,
					seed: organization.name,
					alt: organization.name,
				}),
				sidebarLabel(h, [organization.name]),
			]
		if (key === "create-server")
			return [IconPlus(h, { attributes: { "data-slot": "icon" } }), sidebarLabel(h, ["Create server"])]
		if (key === "invite-people") return item(IconUsersPlus(h), "Invite people")
		if (key === "manage-members") return item(IconUsers(h), "Manage members")
		if (key === "switch-server") return item(IconServers(h), "Switch Server")
		if (key === "create-channel") return item(IconCirclePlus(h), "Create channel")
		if (key === "create-category") return item(IconFolderPlus(h), "Create category")
		if (key === "server-settings") return item(IconGear(h), "Server settings")
		if (key === "custom-emojis") return item(IconEmoji1(h), "Custom emojis")
		if (key === "integrations") return item(IconIntegratio(h), "Integrations")
		return []
	}

/** `SidebarHeader` > org switcher `Menu` (channels, settings and my-settings sidebars). */
export const orgSwitcherHeader = <M>(
	h: HtmlBuilder<M>,
	menu: Menu.Model,
	context: ShellContext,
	organizations: ReadonlyArray<SwitcherOrg>,
	toMenuMessage: (message: Menu.Message) => M,
): Html =>
	sidebarHeader(h, { state: "expanded", className: "border-b h-14" }, [
		h.submodel({
			slotId: ORG_SWITCHER_ID,
			model: menu,
			view: menuView,
			viewInputs: {
				toTrigger: (attributes, overlay) =>
					h.button(
						[
							...attributes,
							h.Class(
								"group/switcher relative flex items-center justify-between gap-x-2 font-semibold outline-hidden text-fg/80 hover:text-fg transition-colors focus-visible:ring focus-visible:ring-primary",
							),
							h.Attribute("type", "button"),
							h.Attribute("tabindex", "0"),
							h.Attribute("data-react-aria-pressable", "true"),
						],
						[
							h.div(
								[h.Class("flex w-full items-center gap-1")],
								[
									h.span(
										[h.Class("flex gap-x-2 font-medium text-sm/6")],
										[
											avatar(h, {
												isSquare: true,
												size: "sm",
												src: context.organization?.logoUrl,
												seed: context.organization?.name,
											}),
											context.organization?.name ?? "",
										],
									),
									IconChevronUpDown(h, {
										className:
											"ml-auto size-4 text-muted-fg group-hover/switcher:text-fg transition-colors",
									}),
								],
							),
							overlay,
						],
					),
				content: switcherContent(h, organizations),
				className: "min-w-(--trigger-width)",
			},
			toParentMessage: toMenuMessage,
		}),
	])
