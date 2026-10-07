import { Submodel } from "foldkit"
import type { Html, HtmlBuilder } from "foldkit/html"
import { IconHashtag, IconLock, IconMsgs, IconPlus } from "../../icons"
import { badge } from "../../ui/badge"
import { button } from "../../ui/button"
import { card } from "../../ui/card"
import { emptyState } from "../../ui/empty-state"
import { loader } from "../../ui/loader"
import {
	sectionHeaderGroup,
	sectionHeaderHeading,
	sectionHeaderRoot,
	sectionHeaderSubheading,
} from "../../ui/section-header"
import * as Tabs from "../../ui/tabs"
import { can, type PageViewInputs, type Shared } from "../contract"
import { channelCard, dmCard } from "./cards"
import { Message } from "./message"
import type { ChannelGroups, ChannelSummary, Model } from "./model"

/** Port of `routes/_app/$orgSlug/chat/index.tsx`. */

const toTabsMessage = (message: Tabs.Message) => Message.GotTabsMessage({ message })

const tabLabel = (h: HtmlBuilder<Message>, label: string, count: number): Html =>
	h.span(
		[h.Class("flex items-center gap-2")],
		[label, count > 0 ? badge(h, { intent: "secondary" }, [`${count}`]) : h.empty],
	)

const channelList = (h: HtmlBuilder<Message>, heading: string, rows: ReadonlyArray<Html>): Html =>
	card(h, {}, [
		h.h2([h.Class("sr-only")], [heading]),
		h.div([h.Class("divide-y divide-border")], [...rows]),
	])

const createButton = (h: HtmlBuilder<Message>, label: string, onPress: Message): Html =>
	button(h, { intent: "secondary", size: "sm", onPress }, [
		IconPlus(h, { attributes: { "data-slot": "icon" } }),
		label,
	])

const panels = (h: HtmlBuilder<Message>, model: Model, groups: ChannelGroups, shared: Shared) => {
	const orgSlug = shared.orgSlug ?? ""
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
					"Public Channels",
					(channel) => channelCard(h, orgSlug, channel, false),
					() =>
						emptyState(h, {
							icon: (className) => IconHashtag(h, { className }),
							title: "No public channels",
							description: "Public channels are open for everyone in the organization to join.",
							...(canCreate
								? {
										action: createButton(
											h,
											"Create a channel",
											Message.PressedCreateChannel(),
										),
									}
								: {}),
						}),
				),
			],
		},
		{
			key: "private",
			content: [
				listOrEmpty(
					groups.privateChannels,
					"Private Channels",
					(channel) => channelCard(h, orgSlug, channel, true),
					() =>
						emptyState(h, {
							icon: (className) => IconLock(h, { className }),
							title: "No private channels",
							description: "Private channels are invite-only spaces for focused discussions.",
							...(canCreate
								? {
										action: createButton(
											h,
											"Create a private channel",
											Message.PressedCreateChannel(),
										),
									}
								: {}),
						}),
				),
			],
		},
		{
			key: "dms",
			content: [
				listOrEmpty(
					groups.dmChannels,
					"Direct Messages",
					(channel) =>
						dmCard(h, orgSlug, channel, {
							currentUserId: shared.currentUser?.id,
							presence: model.presence,
							nowMs: shared.nowMs,
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

export const view = Submodel.defineView<Model, Message, PageViewInputs>((model, { shared }, h) => {
	const groups = model.groups
	if (groups === null) {
		return h.div(
			[h.Class("flex h-screen items-center justify-center")],
			[loader(h, { className: "size-8" })],
		)
	}
	return h.div(
		[h.Class("flex flex-col gap-6 px-4 py-6 lg:px-8")],
		[
			sectionHeaderRoot(h, { className: "border-none pb-0" }, [
				sectionHeaderGroup(h, {}, [
					h.div(
						[h.Class("space-y-0.5")],
						[
							sectionHeaderHeading(h, { size: "xl" }, ["All channels"]),
							sectionHeaderSubheading(h, {}, [
								"Discover communities and join the discussions that matter to you.",
							]),
						],
					),
				]),
			]),
			h.submodel({
				slotId: "tabs",
				model: model.tabs,
				view: Tabs.view,
				viewInputs: {
					listClassName: "w-full",
					tabs: [
						{ key: "public", content: [tabLabel(h, "Public", groups.publicChannels.length)] },
						{ key: "private", content: [tabLabel(h, "Private", groups.privateChannels.length)] },
						{ key: "dms", content: [tabLabel(h, "Direct messages", groups.dmChannels.length)] },
					],
					panels: panels(h, model, groups, shared),
				},
				toParentMessage: toTabsMessage,
			}),
		],
	)
})
