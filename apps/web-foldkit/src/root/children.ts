// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The converted screens as the shell's own children, each with its Layers: the app's one ClientData,
 * the RPC client, navigation on the shell's Router, and the Foldkit host for what is still there.
 */
import { Component, Router } from "@effect/ui"
import { ClientData, HazelRpc } from "@hazel/client-data"
import { AssistantPanel } from "@hazel/shared-screens/assistant/AssistantPanel"
import {
	ChannelSidebar,
	channelSidebarLayer,
	matchTarget,
} from "@hazel/shared-screens/channel-sidebar/ChannelSidebar"
import { ChannelHeader, channelHeaderLayer } from "@hazel/shared-screens/chat/header/ChannelHeader"
import { JoinBanner, joinBannerLayer } from "@hazel/shared-screens/chat/header/JoinBanner"
import { MessageList } from "@hazel/shared-screens/chat/MessageList"
import { messageListLayer } from "@hazel/shared-screens/chat/live"
import { Dms, dmsLayer } from "@hazel/shared-screens/dms/Dms"
import { ChannelSettingsHeader } from "@hazel/shared-screens/shell/ChannelSettingsHeader"
import { AccountMenu, OrgSwitcher, SwitchOrganization } from "@hazel/shared-screens/shell/Chrome"
import { MarkAllNotificationsRead, SectionSidebar } from "@hazel/shared-screens/shell/SectionSidebar"
import type { ChannelId } from "@hazel/schema"
import { Effect, Layer, Stream } from "effect"
import { clientData } from "~/db/client"
// The list's HTML renders draw through this web extension.
import "../chat/html-render-extension"
import { liveConnection } from "../chat/live-state"
import { AppRoute, organizationRoute } from "../route"
import { eventsOf, publish } from "./bus"
import { pickersWebLayer } from "./pickers"

/** A push of `route` on the shell's Router, from a screen's host callback. */
const pushOn = (router: Router.Router) => (route: AppRoute) => {
	Effect.runFork(router.push(route))
}

const withRouter = <A, E, R>(build: (push: (route: AppRoute) => void) => Layer.Layer<A, E, R>) =>
	Layer.unwrap(Effect.map(Effect.service(Router.Router), (router) => build(pushOn(router))))

const channelOf = (orgSlug: string) => (channelId: ChannelId) => AppRoute.ChatChannel({ orgSlug, channelId })

/** The sidebar's presses: a route on the Router, a menu choice to the Foldkit sidebar's menus. */
export const ShellChannelSidebar = Component.provide(ChannelSidebar, (props) =>
	withRouter((push) =>
		channelSidebarLayer(
			clientData,
			(to) =>
				push(
					matchTarget<AppRoute>(to, {
						Channel: (channelId) => AppRoute.ChatChannel({ orgSlug: props.orgSlug, channelId }),
						Members: () => AppRoute.OrgHome({ orgSlug: props.orgSlug }),
					}),
				),
			(action) => Effect.sync(() => publish({ _tag: "ChannelSidebarAct", action })),
		),
	),
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
