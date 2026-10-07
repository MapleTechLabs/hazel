import type { OrganizationId, UserId } from "@hazel/schema"
import { Effect } from "effect"
import { getEffectivePresenceStatus } from "~/utils/presence"
import { Mount } from "foldkit"
import type { Update } from "foldkit"
import { createLazy, type Html, type HtmlBuilder } from "foldkit/html"
import { modifyFields } from "foldkit/struct"
import { sidebarContent, sidebarSectionGroup, sidebarStatic } from "../ui/sidebar"
import { orgSwitcherHeader, type ShellContext, userMenuFooter } from "./app-shell"
import { emptyData, Message, type Model } from "./channels-sidebar/model"
import { dragDescription } from "./channels-sidebar/tree"
import { sectionGroupContent } from "./channels-sidebar/view"

/**
 * Chat sidebar next to the nav rail (`components/sidebar/channels-sidebar.tsx`): channel
 * sections, favorites and direct messages. Shell state, so it survives navigation between channels.
 */

// MODEL AND MESSAGE

export { Message, Model } from "./channels-sidebar/model"

// INIT

export const init = (): Model => ({ organizationId: null, currentUserId: null, nowMs: 0, ...emptyData })

// UPDATE

export type SidebarReturn = Update.Return<Model, Message>

/**
 * Every DM partner's derived status at `nowMs`. After the first tick, a tick only lands (and
 * re-renders) when a status flips, so the clock lags real time by at most one tick.
 */
const presenceStatuses = (model: Model, nowMs: number) =>
	model.presence
		.map((presence) =>
			getEffectivePresenceStatus(
				{
					status: presence.status,
					lastSeenAt: presence.lastSeenMs === null ? null : new Date(presence.lastSeenMs),
				},
				nowMs,
			),
		)
		.join()

export const update = (model: Model, message: Message): SidebarReturn =>
	Message.match<SidebarReturn>(message, {
		ChangedContext: () => ({ model }),
		CompletedScrollActiveIntoView: () => ({ model }),
		TickedPresenceClock: ({ nowMs }) => ({
			model:
				model.nowMs !== 0 && presenceStatuses(model, model.nowMs) === presenceStatuses(model, nowMs)
					? model
					: modifyFields(model, { nowMs: () => nowMs }),
		}),
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
	})

/** The root learned the organization or the signed-in user; the sidebar's queries depend on both. */
export const setContext = (
	model: Model,
	context: { readonly organizationId: OrganizationId | null; readonly currentUserId: UserId | null },
): SidebarReturn =>
	model.organizationId === context.organizationId && model.currentUserId === context.currentUserId
		? { model }
		: {
				model: {
					...model,
					...emptyData,
					organizationId: context.organizationId,
					currentUserId: context.currentUserId,
				},
			}

// SUBSCRIPTION

export { subscriptions } from "./channels-sidebar/subscriptions"

// VIEW

/** `useScrollIntoViewOnActive`: the open channel's row scrolls into view when it mounts. */
const ScrollActiveIntoView = Mount.define("ScrollActiveIntoView", {
	messages: [Message.CompletedScrollActiveIntoView],
	execute: ({ element }) =>
		Effect.sync(() => {
			element.scrollIntoView({ block: "nearest", behavior: "instant" })
			return Message.CompletedScrollActiveIntoView()
		}),
})

export interface ViewContext {
	readonly shell: ShellContext
	readonly activeChannelId: string | undefined
}

/** The shell fields the sidebar reads, as primitives so the lazy slot can compare them. */
type ShellArgs = readonly [
	orgSlug: string,
	pathname: string,
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
	activeChannelId: string | undefined,
	toParentMessage: (message: Message) => ParentMessage,
	...[orgSlug, pathname, orgName, orgLogoUrl, displayName, email, avatarUrl, appVersion]: ShellArgs
): Html => {
	const shell: ShellContext = {
		orgSlug,
		pathname,
		organization: orgName === undefined ? undefined : { name: orgName, logoUrl: orgLogoUrl ?? null },
		currentUser:
			displayName === undefined || email === undefined
				? undefined
				: { displayName, email, avatarUrl: avatarUrl ?? null },
		appVersion,
	}
	return sidebarStatic(h, "flex flex-1", [
		orgSwitcherHeader(h, shell),
		sidebarContent(h, { state: "expanded" }, [
			sidebarSectionGroup(
				h,
				sectionGroupContent(h, model, {
					orgSlug,
					pathname,
					activeChannelId,
					onActiveMount: h.OnMount(Mount.mapMessage(ScrollActiveIntoView(), toParentMessage)),
				}),
			),
		]),
		userMenuFooter(h, shell),
		dragDescription(h),
	])
}

/**
 * Memoized: the root re-runs every view on each Model change (list scrolls included), so the
 * sidebar rebuilds only when its Model or a shell field it shows changes. Args must be stable refs.
 */
const sidebarSlot = createLazy()

export const view = <ParentMessage>(
	h: HtmlBuilder<ParentMessage>,
	model: Model,
	context: ViewContext,
	toParentMessage: (message: Message) => ParentMessage,
): Html => {
	const { shell } = context
	return sidebarSlot(sidebarBody<ParentMessage>, [
		h,
		model,
		context.activeChannelId,
		toParentMessage,
		shell.orgSlug,
		shell.pathname,
		shell.organization?.name,
		shell.organization?.logoUrl,
		shell.currentUser?.displayName,
		shell.currentUser?.email,
		shell.currentUser?.avatarUrl,
		shell.appVersion,
	])
}
