// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The converted screens as the shell's own children, each with its Layers: the app's one ClientData,
 * the RPC client, navigation on the shell's Router, and the Foldkit host for what is still there.
 */
import { Component, Router } from "@effect/ui"
import { ClientData, HazelRpc } from "@hazel/client-data"
import { AssistantPanel } from "@hazel/shared-screens/assistant/AssistantPanel"
import { Activity, activityLayer } from "@hazel/shared-screens/activity/Activity"
import { sidebarWritesLayer } from "@hazel/shared-screens/channel-sidebar/actions"
import {
	ChannelSidebar,
	channelSidebarLayer,
	matchTarget,
} from "@hazel/shared-screens/channel-sidebar/ChannelSidebar"
import { CustomersSidebar, customersSidebarLayer } from "@hazel/shared-screens/customers/CustomersSidebar"
import { ChatSidebarSheet } from "@hazel/shared-screens/shell/ChatSidebarSheet"
import { ChannelComposer } from "@hazel/shared-screens/chat/composer/ChannelComposer"
import { ThreadComposer } from "@hazel/shared-screens/chat/composer/ThreadComposer"
import { ChannelHeader, channelHeaderLayer } from "@hazel/shared-screens/chat/header/ChannelHeader"
import { JoinBanner, joinBannerLayer } from "@hazel/shared-screens/chat/header/JoinBanner"
import { MessageList } from "@hazel/shared-screens/chat/MessageList"
import { messageListLayer } from "@hazel/shared-screens/chat/live"
import { Dms, dmsLayer } from "@hazel/shared-screens/dms/Dms"
import { ChannelSettingsHeader } from "@hazel/shared-screens/shell/ChannelSettingsHeader"
import { AccountMenu, OrgSwitcher, SwitchOrganization } from "@hazel/shared-screens/shell/Chrome"
import { MarkAllNotificationsRead, SectionSidebar } from "@hazel/shared-screens/shell/SectionSidebar"
import type { ChannelId } from "@hazel/schema"
import { Effect, Layer, Match, Stream } from "effect"
import { clientData } from "~/db/client"
// The list's HTML renders draw through this web extension.
import "../chat/html-render-extension"
import { liveConnection } from "../chat/live-state"
import { AppRoute, organizationRoute } from "../route"
import { eventsOf, publish } from "./bus"
import { persistDismissedHint } from "./hints"
import { composerWebLayer } from "./composer"
import { pickersWebLayer } from "./pickers"

/** A push of `route` on the shell's Router, from a screen's host callback. */
const pushOn = (router: Router.Router) => (route: AppRoute) => {
	Effect.runFork(router.push(route))
}

const withRouter = <A, E, R>(build: (push: (route: AppRoute) => void) => Layer.Layer<A, E, R>) =>
	Layer.unwrap(Effect.map(Effect.service(Router.Router), (router) => build(pushOn(router))))

const channelOf = (orgSlug: string) => (channelId: ChannelId) => AppRoute.ChatChannel({ orgSlug, channelId })

/** The channel list's Layers: its routes on the Router, its writes on the app's data, the hint's storage. */
const channelListLayer = (orgSlug: string) =>
	Layer.mergeAll(
		withRouter((push) =>
			channelSidebarLayer(
				clientData,
				(to) =>
					push(
						matchTarget<AppRoute>(to, {
							Channel: (channelId) => AppRoute.ChatChannel({ orgSlug, channelId }),
							Members: () => AppRoute.OrgHome({ orgSlug }),
						}),
					),
				(action) =>
					Match.valueTags(action, {
						DismissHint: () => persistDismissedHint("create-channel"),
						// The web app draws its own org switcher and account card (`chrome: false`).
						OrgMenu: () => Effect.void,
						AccountMenu: () => Effect.void,
					}),
			),
		),
		Layer.unwrap(Effect.map(Effect.service(HazelRpc), (rpc) => sidebarWritesLayer(clientData, rpc))),
	)

export const ShellChannelSidebar = Component.provide(ChannelSidebar, (props) =>
	channelListLayer(props.orgSlug),
)

/** A row's request goes to the Foldkit channel page that still owns its overlays and threads. */
export const ShellMessageList = Component.provide(
	MessageList,
	Layer.unwrap(
		Effect.map(Effect.service(HazelRpc), (rpc) =>
			messageListLayer(
				clientData,
				rpc,
				(request) => publish({ _tag: "MessageList", request }),
				liveConnection,
			),
		),
	).pipe(Layer.provideMerge(pickersWebLayer)),
)

export const ShellActivity = Component.provide(Activity, (props) =>
	Layer.unwrap(
		Effect.map(Effect.service(HazelRpc), (rpc) =>
			withRouter((push) =>
				activityLayer(clientData, rpc, (channelId) => push(channelOf(props.orgSlug)(channelId))),
			),
		),
	),
)

/** The AI panel on the app's data; its RPCs, `Navigate` and `Hazel.Host` come from the shell. */
export const ShellAssistantPanel = Component.provide(AssistantPanel, Layer.succeed(ClientData, clientData))

export const ShellDms = Component.provide(Dms, (props) =>
	withRouter((push) =>
		dmsLayer(
			clientData,
			(channelId) => push(channelOf(props.orgSlug)(channelId)),
			() => publish({ _tag: "Shell", request: { _tag: "PressedComposeDm" } }),
		),
	),
)

/** Another organization from the switcher: its home (a phone's chat list), or its setup. */
const switchLayer = (isMobile: boolean) =>
	withRouter((push) =>
		SwitchOrganization.layerWith((id, slug) => push(organizationRoute({ id, slug }, { isMobile }))),
	)

/** The data the chrome reads, the switcher's routes, and Activity's "Mark all as read" on the host. */
const chromeLayer = (isMobile: boolean) =>
	Layer.mergeAll(
		Layer.succeed(ClientData, clientData),
		switchLayer(isMobile),
		MarkAllNotificationsRead.layerWith(() =>
			publish({ _tag: "Shell", request: { _tag: "PressedMarkAllRead" } }),
		),
	)

/** A phone's chat sidebar sheet: the channel list with the switcher and the account card. */
export const ShellChatSidebarSheet = Component.provide(ChatSidebarSheet, (props) =>
	Layer.mergeAll(channelListLayer(props.sidebar.orgSlug), chromeLayer(props.switcher.compact)),
)

/** The customers sidebar: its layout save on the app's data; its account card's chrome. */
export const ShellCustomersSidebar = Component.provide(CustomersSidebar, () =>
	Layer.mergeAll(
		Layer.unwrap(Effect.map(Effect.service(HazelRpc), (rpc) => customersSidebarLayer(clientData, rpc))),
		chromeLayer(false),
	),
)

export const ShellSectionSidebar = Component.provide(SectionSidebar, (props) =>
	chromeLayer(props.switcher.compact),
)
export const ShellOrgSwitcher = Component.provide(OrgSwitcher, (props) => chromeLayer(props.compact))
export const ShellAccountMenu = Component.provide(AccountMenu, chromeLayer(false))
export const ShellChannelSettingsHeader = Component.provide(
	ChannelSettingsHeader,
	Layer.succeed(ClientData, clientData),
)

// The `import()`s keep the files pages in their own chunk, loaded on the first Files tab.
export const ShellFilesPage = Component.lazy("FilesPage", () =>
	import("./files-pages").then((module) => module.ShellFilesPage),
)

export const ShellMediaPage = Component.lazy("MediaPage", () =>
	import("./files-pages").then((module) => module.ShellMediaPage),
)

/** The channel header: a pin's jump and the pins shortcut go through the Foldkit channel page. */
export const ShellChannelHeader = Component.provide(
	ChannelHeader,
	Layer.unwrap(
		Effect.map(Effect.service(HazelRpc), (rpc) =>
			channelHeaderLayer(clientData, rpc, {
				jumpToMessage: (messageId) => publish({ _tag: "JumpToPin", messageId }),
				pinsHotkey: eventsOf("PinsHotkey").pipe(Stream.map(() => undefined)),
			}),
		),
	),
)

/** A non-member's "Join #channel", in the place of the list and the composer. */
export const ShellJoinBanner = Component.provide(
	JoinBanner,
	Layer.unwrap(Effect.map(Effect.service(HazelRpc), (rpc) => joinBannerLayer(clientData, rpc))),
)

/** What a composer needs: the app's data, the web's files, uploads, bot commands and the pickers. */
const composerLayer = Layer.mergeAll(composerWebLayer, pickersWebLayer, Layer.succeed(ClientData, clientData))

/** The channel's composer, in the Foldkit channel page's hole under the list. */
export const ShellChannelComposer = Component.provide(ChannelComposer, composerLayer)

/** The open thread panel's composer, in the panel's hole. */
export const ShellThreadComposer = Component.provide(ThreadComposer, composerLayer)
