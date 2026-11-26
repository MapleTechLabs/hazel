/**
 * The Effect UI channel sidebar's presses as this sidebar's own messages: a menu choice goes in as
 * the choice of a system menu (`ChoseFromNativeMenu`), so `menu-update.ts` runs the same write,
 * modal and toast it runs for the same key today.
 */
import { Match } from "effect"
import type { NavTarget, SidebarAction } from "@hazel/shared-screens/channel-sidebar/ChannelSidebar"
import { Message } from "./model"
import * as Menu from "../../ui/menu"

/** A press in the channel sidebar: a route, or a menu choice by today's keys. */
export type IslandIntent =
	| { readonly _tag: "Navigate"; readonly to: NavTarget }
	| { readonly _tag: "Act"; readonly action: SidebarAction }

/** A menu choice by key, as the system menu reports one; the key is the item. */
const chose = (key: string): Menu.Message =>
	Menu.Message.ChoseFromNativeMenu({ key, entries: [Menu.item(key, { textValue: key })] })

/** The sidebar messages a press becomes. */
export type IslandMessage = Extract<
	Message,
	{
		readonly _tag:
			| "RequestedIslandNavigation"
			| "RequestedIslandMembers"
			| "GotRowMenuMessage"
			| "GotSectionMenuMessage"
			| "ClickedBrowseChannels"
			| "ClickedDismissCreateChannelHint"
	}
>

export const messageOfIntent = (orgSlug: string, intent: IslandIntent): IslandMessage | null =>
	intent._tag === "Navigate"
		? Match.valueTags(intent.to, {
				Channel: ({ channelId }) => Message.RequestedIslandNavigation({ orgSlug, channelId }),
				Members: () => Message.RequestedIslandMembers({ orgSlug }),
			})
		: Match.valueTags(intent.action, {
				RowMenu: ({ channelId, key }) =>
					Message.GotRowMenuMessage({ channelId, orgSlug, message: chose(key) }),
				SectionMenu: ({ sectionKey, key }) =>
					Message.GotSectionMenuMessage({ sectionId: sectionKey, message: chose(key) }),
				Browse: () => Message.ClickedBrowseChannels(),
				DismissHint: () => Message.ClickedDismissCreateChannelHint(),
				// The web app draws its own org switcher and account card (`chrome: false`).
				OrgMenu: () => null,
				AccountMenu: () => null,
			})
