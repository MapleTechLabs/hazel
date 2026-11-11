import { Submodel } from "foldkit"
import type { RouteOf } from "../../../route"
import { definePage, type PageViewInputs } from "../../contract"
import { type ChatTab, init, Message, Model, setCurrentUserId, setTab, switchChannel, update } from "./page"
import { syncReady, syncUnread } from "./clear-notifications"
import { subscriptions } from "./subscription"
import { view as channelView } from "./view"
import { andThen } from "./write"

/** `/$orgSlug/chat/$id` with its Messages, Files and All Media tabs (one layout, one page). */

type ChannelRoute = RouteOf<"ChatChannel" | "ChatFiles" | "ChatFilesMedia">

const tabOf = (route: ChannelRoute): ChatTab =>
	route._tag === "ChatFiles" ? "files" : route._tag === "ChatFilesMedia" ? "media" : "messages"

export const page = definePage(
	"ChatChannel",
	{ Model, Message },
	{
		routes: ["ChatChannel", "ChatFiles", "ChatFilesMedia"],
		// A new channel starts a fresh page Model (React remounted on `key={id}`) that inherits only
		// the list's viewport and measured heights; its tabs keep the instance.
		key: (route) => route.orgSlug,
		init: (route, shared) =>
			syncReady(
				init(route.channelId, route.orgSlug, shared.currentUser?.id ?? null, { tab: tabOf(route) }),
				shared,
			),
		update,
		routeChanged: (model, route, shared) =>
			route.channelId === model.channelId
				? { model: setTab(model, tabOf(route)) }
				: syncReady(switchChannel(model, route.channelId, { tab: tabOf(route) }), shared),
		view: Submodel.defineView<Model, Message, PageViewInputs>((model, inputs, h) =>
			channelView(h, model, { isMobile: inputs.shared.isMobile, nowMs: inputs.shared.nowMs }),
		),
		subscriptions,
		sharedChanged: (model, shared) =>
			andThen(setCurrentUserId(model, shared.currentUser?.id ?? null), (next) =>
				andThen(syncUnread(next), (synced) => syncReady(synced, shared)),
			),
	},
)
