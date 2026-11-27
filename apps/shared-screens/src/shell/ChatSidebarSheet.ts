// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The chat sidebar on a phone inside a conversation: a sheet its top bar opens, the org switcher
 * over the channel list over the account card. Docked (and on the phone's chat list) the frame
 * draws the same three around the list itself. The host provides the list's and chrome's Layers.
 */
import { UiSchema } from "@effect/ui"
import { Hazel } from "@hazel/ui/vocabulary/index"
import { Schema } from "effect"
import { ChannelSidebar, ChannelSidebarProps } from "../channel-sidebar/ChannelSidebar"
import { AccountMenu, AccountMenuProps, OrgSwitcher, OrgSwitcherProps } from "./Chrome"

export const ChatSidebarSheetProps = Schema.Struct({
	open: Schema.Boolean,
	sidebar: ChannelSidebarProps,
	switcher: OrgSwitcherProps,
	account: AccountMenuProps,
})
export type ChatSidebarSheetProps = typeof ChatSidebarSheetProps.Type

export const ChatSidebarSheetMessage = UiSchema.TaggedEnum({ DismissedSheet: {} })
export const ChatSidebarSheetEvents = UiSchema.TaggedEnum({ RequestedClose: {} })

export const ChatSidebarSheet = Hazel.component({
	name: "ChatSidebarSheet",
	props: ChatSidebarSheetProps,
	model: Schema.Struct({}),
	message: ChatSidebarSheetMessage,
	events: ChatSidebarSheetEvents,
}).make({
	init: () => ({}),
	update: { DismissedSheet: ($) => $.emit(ChatSidebarSheetEvents.RequestedClose()) },
	view: (h) =>
		h.sheet
			.open(h.props.open)
			.on("dismiss", () => ChatSidebarSheetMessage.DismissedSheet())
			.children(
				h.stack.density("tight").children(
					OrgSwitcher(h, { key: "switcher", props: h.props.switcher }),
					h.divider,
					ChannelSidebar(h, {
						key: `${h.props.sidebar.organizationId}:${h.props.sidebar.userId}`,
						props: h.props.sidebar,
					}),
					h.spacer,
					AccountMenu(h, { key: "account", props: h.props.account }),
				),
			),
})
