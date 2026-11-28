// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The chat screens with their host wiring done once, here, for every host: navigation through
 * `Navigator`, data through `ClientData` and `HazelRpc`, and only what truly differs per platform
 * (the sidebar's own menus, a message row's leftover requests) through `ChatHost`. A host provides
 * these services; it never wires a screen's callbacks itself.
 */
import { Component } from "@effect/ui"
import { ClientData, HazelRpc } from "@hazel/client-data"
import { Clipboard } from "@hazel/client-data/platform"
import type { ChannelId, OrganizationId, UserId } from "@hazel/schema"
import { Context, Effect, Layer, Match, Stream } from "effect"
import { Activity, activityLayer } from "../activity/Activity"
import { sidebarWritesLayer } from "../channel-sidebar/actions"
import {
	ChannelSidebar,
	channelSidebarLayer,
	matchTarget,
	type SidebarAction,
} from "../channel-sidebar/ChannelSidebar"
import { botCommandsLayer } from "../chat/composer/bot-commands"
import { ChannelComposer } from "../chat/composer/ChannelComposer"
import { ComposerFiles, ComposerHost, ComposerRequests, Drafts } from "../chat/composer/host"
import { messageListLayer } from "../chat/live"
import type { HostRequest } from "../chat/messages"
import { MessageList } from "../chat/MessageList"
import { klipyGifsLayer } from "../chat/pickers/klipy"
import { LiveConnection } from "../chat/rich/live-replies"
import { Dms, dmsLayer } from "../dms/Dms"
import { Navigator, openRoute } from "./navigator"
import { AppRoute } from "./route"

/** Who and where the app is: the signed-in user in one organization, on one install. */
export class AppContext extends Context.Service<
	AppContext,
	{
		readonly userId: UserId
		readonly organizationId: OrganizationId
		readonly orgSlug: string
		/** Uploads without their own URL (`currentServer().cdn`), and the link-preview worker. */
		readonly cdnUrl: string
		readonly linkPreviewUrl: string
	}
>()("hazel/app/AppContext") {}

/** What differs per platform around the chat screens. */
export class ChatHost extends Context.Service<
	ChatHost,
	{
		/** The sidebar's own menus and hint (the org switcher, the account card, the hint's storage). */
		readonly sidebarAction: (action: SidebarAction) => Effect.Effect<void>
		/** A row request the shared wiring does not answer (an attachment, a retry, a jump). */
		readonly messageRequest: (channelId: ChannelId, request: HostRequest) => Effect.Effect<void>
		/** The DMs screen's compose button. */
		readonly composeDm: Effect.Effect<void>
		/** A streaming bot reply's socket. */
		readonly live: LiveConnection["Service"]
	}
>()("hazel/app/ChatHost") {}

/** Runs a host effect from a screen's synchronous callback. */
const fork = (effect: Effect.Effect<void>) => void Effect.runFork(effect)

/** The channel sidebar's services, for it and for screens that embed it (a phone's sidebar sheet). */
export const hostedSidebarLayer = (orgSlug: string) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const data = yield* ClientData
			const rpc = yield* HazelRpc
			const navigator = yield* Navigator
			const host = yield* ChatHost
			return Layer.mergeAll(
				channelSidebarLayer(
					data,
					(to) =>
						fork(
							openRoute(
								navigator,
								matchTarget<AppRoute>(to, {
									Channel: (channelId) => AppRoute.ChatChannel({ orgSlug, channelId }),
									Members: () => AppRoute.OrgHome({ orgSlug }),
								}),
							),
						),
					host.sidebarAction,
				),
				sidebarWritesLayer(data, rpc),
			)
		}),
	)

const openChannelWith = (navigator: Navigator["Service"], orgSlug: string) => (channelId: ChannelId) =>
	fork(openRoute(navigator, AppRoute.ChatChannel({ orgSlug, channelId })))

const dmsHostLayer = (orgSlug: string) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const data = yield* ClientData
			const navigator = yield* Navigator
			const host = yield* ChatHost
			return dmsLayer(data, openChannelWith(navigator, orgSlug), () => fork(host.composeDm))
		}),
	)

const activityHostLayer = (orgSlug: string) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const data = yield* ClientData
			const rpc = yield* HazelRpc
			const navigator = yield* Navigator
			return activityLayer(data, rpc, openChannelWith(navigator, orgSlug))
		}),
	)

/** A conversation's list: reply and edit go to its channel's composer, the rest by kind. */
const messageListHostLayer = (channelId: ChannelId) =>
	Layer.unwrap(
		Effect.gen(function* () {
			const data = yield* ClientData
			const rpc = yield* HazelRpc
			const navigator = yield* Navigator
			const clipboard = yield* Clipboard
			const composer = yield* ComposerRequests
			const { orgSlug } = yield* AppContext
			const host = yield* ChatHost
			const handle = (request: HostRequest): Effect.Effect<void> =>
				Match.valueTags(request, {
					Action: ({ messageId, action, content }) =>
						Match.value(action).pipe(
							Match.when("reply", () =>
								composer.send(channelId, {
									_tag: "Reply",
									messageId,
									author: "",
									text: content,
								}),
							),
							Match.when("edit", () =>
								composer.send(channelId, { _tag: "Edit", messageId, content }),
							),
							Match.when("copy", () => Effect.ignore(clipboard.write(content))),
							Match.orElse(() => host.messageRequest(channelId, request)),
						),
					// A thread is a channel of its own.
					OpenThread: ({ threadChannelId }) =>
						threadChannelId === null
							? Effect.void
							: openRoute(
									navigator,
									AppRoute.ChatChannel({ orgSlug, channelId: threadChannelId }),
								),
					OpenLink: ({ url }) => navigator.open(url),
					EditProfile: () => openRoute(navigator, AppRoute.MySettingsProfile({ orgSlug })),
					OpenAttachment: () => host.messageRequest(channelId, request),
					JumpToReply: () => host.messageRequest(channelId, request),
					Retry: () => host.messageRequest(channelId, request),
				})
			return messageListLayer(data, rpc, (request) => fork(handle(request)), host.live)
		}),
	)

/** The composer's host: its channel's requests, no drag and drop, threads pushed as conversations. */
const composerHostLayer = Layer.effect(
	ComposerHost,
	Effect.map(Effect.service(ComposerRequests), (requests) =>
		ComposerHost.of({
			requests: requests.of,
			notify: () => Effect.void,
			dragging: Stream.make(false),
			thread: Stream.make(null),
		}),
	),
)

export const HostedChannelSidebar = Component.provide(ChannelSidebar, (props) =>
	hostedSidebarLayer(props.orgSlug),
)
export const HostedDms = Component.provide(Dms, (props) => dmsHostLayer(props.orgSlug))
export const HostedActivity = Component.provide(Activity, (props) => activityHostLayer(props.orgSlug))
export const HostedMessageList = Component.provide(MessageList, (props) =>
	messageListHostLayer(props.channelId),
)
export const HostedChannelComposer = Component.provide(
	ChannelComposer,
	Layer.mergeAll(composerHostLayer, botCommandsLayer, klipyGifsLayer),
)

/** What the hosted chat screens need from a host (with `ComposerFiles`, `Drafts` and the platform). */
export type ChatHostServices =
	| ClientData
	| HazelRpc
	| Navigator
	| AppContext
	| ChatHost
	| Clipboard
	| ComposerRequests
	| ComposerFiles
	| Drafts
