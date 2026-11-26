import { OrganizationId, UserId } from "@hazel/schema"
import { Match, Schema, Stream } from "effect"
import { Mount, Submodel } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { IconHashtag, IconLock, IconMsgs, IconPlus } from "../../icons"
import { badge } from "../../ui/badge"
import { button } from "../../ui/button"
import { card } from "../../ui/card"
import { emptyState } from "../../ui/empty-state"
import { heading as headingText } from "../../ui/heading"
import { loadingState } from "../../ui/loader"
import { pageHeader, pageLayout } from "../../ui/page-header"
import * as Tabs from "../../ui/tabs"
import { can, channelLinksOf, type PageViewInputs, type Shared } from "../contract"
import { dmsIsland, dmsIslandView, isDmsIslandEnabled } from "../../islands/dms"
import { channelCard, dmCard } from "./cards"
import { mobileDmList } from "./mobile-dms"
import { Message } from "./message"
import {
	type ChannelGroups,
	type ChannelSummary,
	ChatIndexTabs,
	type ChatIndexTab,
	type Model,
} from "./model"

/** Port of `routes/_app/$orgSlug/chat/index.tsx`. */

const toTabsMessage = (message: Tabs.Message) => Message.GotTabsMessage({ message })

const TABS: ReadonlyArray<ChatIndexTab> = ["public", "private", "dms"]
const TAB_LABELS: Record<ChatIndexTab, string> = {
	public: "Public",
	private: "Private",
	dms: "Direct messages",
}
const countOf = (groups: ChannelGroups, tab: ChatIndexTab) =>
	(tab === "public"
		? groups.publicChannels
		: tab === "private"
			? groups.privateChannels
			: groups.dmChannels
	).length

/** "Direct messages" with three counts overflows a phone's tab list; there it reads "DMs". */
const tabText = (h: HtmlBuilder<Message>, tab: ChatIndexTab): ReadonlyArray<Html | string> =>
	tab === "dms"
		? [h.span([h.Class("max-md:hidden")], [TAB_LABELS.dms]), h.span([h.Class("md:hidden")], ["DMs"])]
		: [TAB_LABELS[tab]]

const tabLabel = (h: HtmlBuilder<Message>, tab: ChatIndexTab, count: number): Html =>
	h.span(
		[h.Class("flex items-center gap-2")],
		[...tabText(h, tab), count > 0 ? badge(h, { intent: "secondary" }, [`${count}`]) : h.empty],
	)

const channelList = (h: HtmlBuilder<Message>, heading: string, rows: ReadonlyArray<Html>): Html =>
	card(h, {}, [
		headingText(h, { variant: "section", className: "sr-only" }, [heading]),
		h.div([h.Class("divide-y divide-border")], [...rows]),
	])

const createButton = (h: HtmlBuilder<Message>, label: string, onPress: Message): Html =>
	button(h, { intent: "secondary", size: "sm", onPress }, [
		IconPlus(h, { attributes: { "data-slot": "icon" } }),
		label,
	])

const panels = (
	h: HtmlBuilder<Message>,
	model: Model,
	groups: ChannelGroups,
	shared: Shared,
	orgSlug: string,
) => {
	const canCreate = can(shared, "channel.create")
	const listOrEmpty = (
		channels: ReadonlyArray<ChannelSummary>,
		heading: string,
		row: (channel: ChannelSummary) => Html,
		empty: () => Html,
	) => (channels.length > 0 ? channelList(h, heading, channels.map(row)) : empty())
	return [
		{
			key: "public",
			content: [
				listOrEmpty(
					groups.publicChannels,
					"Public channels",
					(channel) => channelCard(h, orgSlug, channel, false, channelLinksOf(shared, channel.id)),
					() =>
						emptyState(h, {
							icon: (className) => IconHashtag(h, { className }),
							title: "No public channels",
							description: "Public channels are open for everyone in the organization to join.",
							action: canCreate
								? createButton(h, "Create a channel", Message.PressedCreateChannel())
								: undefined,
						}),
				),
			],
		},
		{
			key: "private",
			content: [
				listOrEmpty(
					groups.privateChannels,
					"Private channels",
					(channel) => channelCard(h, orgSlug, channel, true, channelLinksOf(shared, channel.id)),
					() =>
						emptyState(h, {
							icon: (className) => IconLock(h, { className }),
							title: "No private channels",
							description: "Private channels are invite-only spaces for focused discussions.",
							action: canCreate
								? createButton(h, "Create a private channel", Message.PressedCreateChannel())
								: undefined,
						}),
				),
			],
		},
		{
			key: "dms",
			content: [
				listOrEmpty(
					groups.dmChannels,
					"Direct messages",
					(channel) =>
						dmCard(h, orgSlug, channel, {
							currentUserId: shared.currentUser?.id,
							presence: model.presence,
						}),
					() =>
						emptyState(h, {
							icon: (className) => IconMsgs(h, { className }),
							title: "No direct messages",
							description: "Start a conversation with someone in your organization.",
							action: createButton(
								h,
								"Start a conversation",
								Message.PressedStartConversation(),
							),
						}),
				),
			],
		},
	]
}

/**
 * `ChatDms`: the direct messages alone. On a phone (the DMs tab) Slack's layout (`mobile-dms.ts`);
 * elsewhere a page header with "New message".
 */
const dmList = (h: HtmlBuilder<Message>, model: Model, groups: ChannelGroups, shared: Shared): Html => {
	const list =
		shared.orgSlug === null
			? []
			: (panels(h, model, groups, shared, shared.orgSlug).find((panel) => panel.key === "dms")
					?.content ?? [])
	if (shared.isMobile && shared.orgSlug !== null)
		return mobileDmList(
			h,
			{ orgSlug: shared.orgSlug, currentUserId: shared.currentUser?.id, nowMs: shared.nowMs, model },
			groups.dmChannels,
		)
	return pageLayout(h, { className: "py-6" }, [
		pageHeader(h, {
			title: "Direct messages",
			actions: [createButton(h, "New message", Message.PressedStartConversation())],
		}),
		...list,
	])
}

/** The shared DMs screen in place of the phone list, behind `hazel:island:dms` (`islands/dms.ts`). */
const MountDmsIsland = Mount.defineStream("MountDmsIsland", {
	args: { organizationId: OrganizationId, userId: UserId, orgSlug: Schema.String },
	messages: [Message.RequestedIslandNavigation, Message.PressedStartConversation],
	execute: ({ element, organizationId, userId, orgSlug }) =>
		dmsIsland(element, { organizationId, userId, orgSlug }).pipe(
			Stream.map((request) =>
				Match.valueTags(request, {
					Open: ({ channelId }) => Message.RequestedIslandNavigation({ orgSlug, channelId }),
					Compose: () => Message.PressedStartConversation(),
				}),
			),
		),
})

const dmsIslandOf = (h: HtmlBuilder<Message>, shared: Shared): Html | undefined => {
	const organizationId = shared.organization?.id
	const userId = shared.currentUser?.id
	if (!isDmsIslandEnabled || !shared.isMobile || !organizationId || !userId || shared.orgSlug === null)
		return undefined
	return dmsIslandView(h, {
		organizationId,
		userId,
		onMount: h.OnMount(MountDmsIsland({ organizationId, userId, orgSlug: shared.orgSlug })),
	})
}

export const view = Submodel.defineView<Model, Message, PageViewInputs>((model, { shared }, h) => {
	// The island loads its own data, so it skips the page's loader.
	const island = model.isDmList ? dmsIslandOf(h, shared) : undefined
	if (island !== undefined) return island
	if (model.channels._tag === "Loading") {
		return loadingState(h, { className: "h-screen py-0" })
	}
	const { groups } = model.channels
	if (model.isDmList) return dmList(h, model, groups, shared)
	return pageLayout(h, { className: "py-6" }, [
		pageHeader(h, {
			title: "All channels",
			subtitle: "Discover communities and join the discussions that matter to you.",
		}),
		h.submodel({
			slotId: "tabs",
			model: model.tabs,
			view: ChatIndexTabs.view,
			viewInputs: {
				tabs: TABS,
				selectedValue: model.tab,
				ariaLabel: "Channels",
				toView: (render) =>
					Tabs.layout(h, render, {
						listClassName: "w-full",
						tab: (tab) => [tabLabel(h, tab, countOf(groups, tab))],
						// The cards link into the org, so the panels wait for its slug.
						panel: (tab) =>
							shared.orgSlug === null
								? []
								: (panels(h, model, groups, shared, shared.orgSlug).find(
										(panel) => panel.key === tab,
									)?.content ?? []),
					}),
			},
			toParentMessage: toTabsMessage,
		}),
	])
})
