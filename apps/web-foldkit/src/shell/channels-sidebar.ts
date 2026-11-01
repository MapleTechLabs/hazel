import type { ChannelId, OrganizationId, UserId } from "@hazel/schema"
import { Effect } from "effect"
import { Mount } from "foldkit"
import { createLazy, type Html, type HtmlBuilder } from "foldkit/html"
import { modifyFields } from "foldkit/struct"
import { failureMessage } from "~/lib/error-messages"
import { errorToastOf, successToast } from "../data/actions"
import type { AppRoute } from "../route"
import type * as Menu from "../ui/menu"
import { sidebarContent, sidebarSectionGroup, sidebarStatic } from "../ui/sidebar"
import type { ShellContext } from "./context"
import type { SwitcherOrg, UserStatus } from "./model"
import { orgSwitcherHeader, userMenuFooter } from "./menus"
import { emptyData, Message, type Model, type SidebarOutcome } from "./channels-sidebar/model"
import { PageOutMessage } from "../page/out-message"
import { PersistDismissedHint } from "./channels-sidebar/hints"
import {
	requestedSectionAction,
	sectionActionsOf,
	sectionMenuOf,
	type SidebarReturn,
	updateRowMenu,
	updateSectionMenu,
} from "./channels-sidebar/menu-update"
import { sectionActionLabel, sectionMenuEntries, sectionMenuView } from "./channels-sidebar/menus"
import { dragDescription, sectionPlusButton } from "./channels-sidebar/tree"
import { sectionGroupContent } from "./channels-sidebar/view"

/**
 * Chat sidebar next to the nav rail (`components/sidebar/channels-sidebar.tsx`): channel
 * sections, favorites and direct messages. Shell state, so it survives navigation between channels.
 */

// MODEL AND MESSAGE

export { Message, Model, OpenMenu, SidebarFailure, SidebarOutcome } from "./channels-sidebar/model"

// INIT

/** `isCreateChannelHintDismissed` is read from storage at boot (`loadIsCreateChannelHintDismissed`). */
export const init = (options: { readonly isCreateChannelHintDismissed: boolean }): Model => ({
	organizationId: null,
	currentUserId: null,
	...emptyData,
	isCreateChannelHintDismissed: options.isCreateChannelHintDismissed,
})

export { loadIsCreateChannelHintDismissed } from "./channels-sidebar/hints"

// UPDATE

export type { SidebarReturn } from "./channels-sidebar/menu-update"

const outcomeTitles: { readonly [O in SidebarOutcome]: string } = {
	Muted: "Channel muted",
	Unmuted: "Channel unmuted",
	Favorited: "Added to favorites",
	Unfavorited: "Removed from favorites",
	Left: "Left channel successfully",
	MovedToSection: "Channel moved to section",
	MovedToDefault: "Channel moved to default",
	SectionDeleted: "Section deleted",
}

export const update = (model: Model, message: Message): SidebarReturn =>
	Message.match<SidebarReturn>(message, {
		CompletedScrollActiveIntoView: () => ({ model }),
		UpdatedMembership: ({ membership }) => ({
			model: modifyFields(model, { membership: () => membership }),
		}),
		UpdatedSections: ({ sections }) => ({ model: modifyFields(model, { sections: () => sections }) }),
		UpdatedSectionChannels: ({ sectionKey, channels }) => ({
			model: modifyFields(model, {
				sectionChannels: (previous) => ({ ...previous, [sectionKey]: channels }),
			}),
		}),
		UpdatedFavorites: ({ channels }) => ({ model: modifyFields(model, { favorites: () => channels }) }),
		UpdatedThreads: ({ threads }) => ({ model: modifyFields(model, { threads: () => threads }) }),
		UpdatedDmChannelIds: ({ channelIds }) => ({
			model: modifyFields(model, { dmChannelIds: () => channelIds }),
		}),
		UpdatedDmChannel: ({ channelId, channel }) => ({
			model: modifyFields(model, { dmChannels: (previous) => ({ ...previous, [channelId]: channel }) }),
		}),
		UpdatedPresence: ({ presence }) => ({ model: modifyFields(model, { presence: () => presence }) }),
		UpdatedUnreadCounts: ({ counts }) => ({ model: modifyFields(model, { unreadCounts: () => counts }) }),
		UpdatedConnectMounts: ({ mounts }) => ({
			model: modifyFields(model, { connectMounts: () => mounts }),
		}),
		UpdatedOrganizations: ({ organizations }) => ({
			model: modifyFields(model, { organizations: () => organizations }),
		}),
		UpdatedMemberChannelIds: ({ channelIds }) => ({
			model: modifyFields(model, { memberChannelIds: () => channelIds }),
		}),
		UpdatedDiscoverableChannels: ({ channels }) => ({
			model: modifyFields(model, { discoverableChannels: () => channels }),
		}),
		ClickedDismissCreateChannelHint: () => ({
			model: modifyFields(model, { isCreateChannelHintDismissed: () => true }),
			commands: [PersistDismissedHint({ hintId: "create-channel" })],
		}),
		CompletedPersistDismissedHint: () => ({ model }),
		// Storage is full or blocked: the hint is already hidden for this session, it only comes back next boot.
		FailedPersistDismissedHint: () => ({ model }),
		GotRowMenuMessage: ({ channelId, orgSlug, message }) =>
			updateRowMenu(model, channelId, orgSlug, message),
		GotSectionMenuMessage: ({ sectionId: sectionKey, message }) =>
			updateSectionMenu(model, sectionKey, message),
		// `openChannelsBrowser` passes `initialPage`, which the palette never reads: it opens home.
		ClickedBrowseChannels: () => ({
			model,
			outMessage: PageOutMessage.RequestedCommandPalette({ page: "home" }),
		}),
		ClickedSectionAction: ({ action }) => requestedSectionAction(model, action),
		SucceededSidebarAction: ({ outcome }) => ({
			model,
			outMessage: PageOutMessage.RequestedToast({ toast: successToast(outcomeTitles[outcome]) }),
		}),
		FailedSidebarAction: ({ reason }) => ({
			model,
			outMessage: PageOutMessage.RequestedToast({
				toast: errorToastOf(
					failureMessage(reason, {
						MemberNotFound: {
							title: "Membership not found",
							description: "You may no longer be a member of this item.",
						},
						ChannelNotFound: {
							title: "Channel not found",
							description: "This channel may have been deleted.",
						},
						SectionNotFound: {
							title: "Section not found",
							description: "This section may have been deleted.",
						},
						SectionAlreadyDeleted: {
							title: "Section not found",
							description: "This section may have already been deleted.",
						},
					}),
				),
			}),
		}),
	})

/** The root learned the organization or the signed-in user; the sidebar's queries depend on both. */
/** The data the sidebar holds belongs to one organization and user; another pair starts it empty. */
export const setContext = (
	model: Model,
	context: { readonly organizationId: OrganizationId | null; readonly currentUserId: UserId | null },
): Model =>
	model.organizationId === context.organizationId && model.currentUserId === context.currentUserId
		? model
		: {
				...model,
				...emptyData,
				organizationId: context.organizationId,
				currentUserId: context.currentUserId,
			}

// SUBSCRIPTION

export { subscriptions } from "./channels-sidebar/subscriptions"

// VIEW

/** `useScrollIntoViewOnActive`: the open channel's row scrolls into view when it becomes active. */
const ScrollActiveIntoView = Mount.define("ScrollActiveIntoView", {
	messages: [Message.CompletedScrollActiveIntoView],
	execute: ({ element }) =>
		Effect.sync(() => {
			// Mounted on a hidden marker inside the row (`treeRow`), inserted on activation.
			;(element.closest('[role="row"]') ?? element).scrollIntoView({
				block: "nearest",
				behavior: "instant",
			})
			return Message.CompletedScrollActiveIntoView()
		}),
})

/** The shell's menus in the sidebar header and footer. Message mappers must be module-level (memo args). */
export interface SidebarChrome<ParentMessage> {
	readonly userMenu: Menu.Model
	readonly orgSwitcher: Menu.Model
	readonly userMenuEntries: ReadonlyArray<Menu.Entry>
	readonly orgSwitcherEntries: ReadonlyArray<Menu.Entry>
	readonly organizations: ReadonlyArray<SwitcherOrg>
	readonly userStatus: UserStatus | null
	/** The status's "Until ..." label at the root's clock (a string, so the memo stays cheap). */
	readonly statusExpiration: string | null
	readonly toUserMenuMessage: (message: Menu.Message) => ParentMessage
	readonly toOrgSwitcherMessage: (message: Menu.Message) => ParentMessage
}

export interface ViewContext<ParentMessage> {
	readonly shell: ShellContext
	/** `chatChannelIdOf(route)`: the channel whose chat or files are open, its row is active. */
	readonly activeChannelId: ChannelId | null
	/** The root's wall clock (`presenceNowSignal`), for deriving stale DM presence. */
	readonly nowMs: number
	readonly chrome: SidebarChrome<ParentMessage>
}

/** The shell fields the sidebar reads, as primitives or stable refs so the lazy slot can compare them. */
type ShellArgs = readonly [
	orgSlug: string,
	route: AppRoute,
	orgName: string | undefined,
	orgLogoUrl: string | null | undefined,
	displayName: string | undefined,
	email: string | undefined,
	avatarUrl: string | null | undefined,
	appVersion: string,
]

const sidebarBody = <ParentMessage>(
	h: HtmlBuilder<ParentMessage>,
	model: Model,
	activeChannelId: ChannelId | null,
	nowMs: number,
	toParentMessage: (message: Message) => ParentMessage,
	userMenu: Menu.Model,
	orgSwitcher: Menu.Model,
	userMenuEntries: ReadonlyArray<Menu.Entry>,
	orgSwitcherEntries: ReadonlyArray<Menu.Entry>,
	organizations: ReadonlyArray<SwitcherOrg>,
	userStatus: UserStatus | null,
	statusExpiration: string | null,
	toUserMenuMessage: (message: Menu.Message) => ParentMessage,
	toOrgSwitcherMessage: (message: Menu.Message) => ParentMessage,
	...[orgSlug, route, orgName, orgLogoUrl, displayName, email, avatarUrl, appVersion]: ShellArgs
): Html => {
	const shell: ShellContext = {
		orgSlug,
		route,
		organization: orgName === undefined ? undefined : { name: orgName, logoUrl: orgLogoUrl ?? null },
		currentUser:
			displayName === undefined || email === undefined
				? undefined
				: { displayName, email, avatarUrl: avatarUrl ?? null },
		appVersion,
	}
	return sidebarStatic(h, "flex flex-1", [
		orgSwitcherHeader(h, orgSwitcher, orgSwitcherEntries, shell, organizations, toOrgSwitcherMessage),
		sidebarContent(h, { state: "expanded" }, [
			sidebarSectionGroup(
				h,
				sectionGroupContent(h, model, {
					orgSlug,
					route,
					activeChannelId,
					nowMs,
					onActiveMount: h.OnMount(Mount.mapMessage(ScrollActiveIntoView(), toParentMessage)),
					onBrowseChannels: h.OnClick(toParentMessage(Message.ClickedBrowseChannels())),
					onDismissCreateChannelHint: h.OnClick(
						toParentMessage(Message.ClickedDismissCreateChannelHint()),
					),
					toParentMessage,
					sectionAction: (sectionKey) => sectionActionView(h, model, sectionKey, toParentMessage),
				}),
			),
		]),
		userMenuFooter(h, userMenu, userMenuEntries, shell, toUserMenuMessage, userStatus, statusExpiration),
		dragDescription(h),
	])
}

/** A single action is a plain "+" button; several actions or a deletable section open a menu. */
const sectionActionView = <ParentMessage>(
	h: HtmlBuilder<ParentMessage>,
	model: Model,
	sectionKey: string,
	toParentMessage: (message: Message) => ParentMessage,
): Html => {
	const { actions, isEditable } = sectionActionsOf(model, sectionKey)
	const [only] = actions
	return only !== undefined && actions.length === 1 && !isEditable
		? sectionPlusButton(h, sectionActionLabel(only), [
				h.OnClick(toParentMessage(Message.ClickedSectionAction({ action: only }))),
			])
		: sectionMenuView(h, {
				menu: sectionMenuOf(model, sectionKey),
				entries: sectionMenuEntries(actions, isEditable),
				toMessage: (message) =>
					toParentMessage(Message.GotSectionMenuMessage({ sectionId: sectionKey, message })),
			})
}

/**
 * Memoized: the root re-runs every view on each Model change (list scrolls included), so the
 * sidebar rebuilds only when its Model or a shell field it shows changes. Args must be stable refs.
 */
const sidebarSlot = createLazy()

export const view = <ParentMessage>(
	h: HtmlBuilder<ParentMessage>,
	model: Model,
	context: ViewContext<ParentMessage>,
	toParentMessage: (message: Message) => ParentMessage,
): Html => {
	const { shell, chrome } = context
	return sidebarSlot(sidebarBody<ParentMessage>, [
		h,
		model,
		context.activeChannelId,
		context.nowMs,
		toParentMessage,
		chrome.userMenu,
		chrome.orgSwitcher,
		chrome.userMenuEntries,
		chrome.orgSwitcherEntries,
		chrome.organizations,
		chrome.userStatus,
		chrome.statusExpiration,
		chrome.toUserMenuMessage,
		chrome.toOrgSwitcherMessage,
		shell.orgSlug,
		shell.route,
		shell.organization?.name,
		shell.organization?.logoUrl,
		shell.currentUser?.displayName,
		shell.currentUser?.email,
		shell.currentUser?.avatarUrl,
		shell.appVersion,
	])
}
