/**
 * The island's intents as the Foldkit sidebar's own messages: a menu choice goes in as the choice of
 * a system menu (`ChoseFromNativeMenu`), so `menu-update.ts` runs the same write, modal and toast it
 * runs for the same key today. Flag off, none of this runs.
 */
import { Match } from "effect"
import { Message } from "../shell/channels-sidebar/model"
import * as Menu from "../ui/menu"
import type { IslandIntent } from "./channel-list"

/** A menu choice by key, as the system menu reports one; the key is the item. */
const chose = (key: string): Menu.Message =>
	Menu.Message.ChoseFromNativeMenu({ key, entries: [Menu.item(key, { textValue: key })] })

/** The sidebar messages an island intent becomes (the Mount's `messages`). */
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
