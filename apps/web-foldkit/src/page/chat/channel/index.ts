import { Submodel } from "foldkit"
import type { RouteOf } from "../../../route"
import { definePage, type PageViewInputs } from "../../contract"
import { PageOutMessage } from "../../out-message"
import { type ChatTab, init, Message, Model, setCurrentUserId, setTab, tabPath, update } from "./page"
import { subscriptions } from "./subscription"
import { view as channelView } from "./view"

/** `/$orgSlug/chat/$id` with its Messages, Files and All Media tabs (one layout, one page). */

const toSelf = (message: Message) => message

type ChannelRoute = RouteOf<"ChatChannel" | "ChatFiles" | "ChatFilesMedia">

const tabOf = (route: ChannelRoute): ChatTab =>
	route._tag === "ChatFiles" ? "files" : route._tag === "ChatFilesMedia" ? "media" : "messages"

export const page = definePage(
	"ChatChannel",
	{ Model, Message },
	{
		routes: ["ChatChannel", "ChatFiles", "ChatFilesMedia"],
		// A new channel is a new page (React remounted on `key={id}`); its tabs keep the instance.
		key: (route) => route.channelId,
		init: (route, shared) => ({
			model: init(route.channelId, shared.currentUser?.id ?? null, {
				tab: tabOf(route),
				orgSlug: route.orgSlug,
			}),
		}),
		update: (model, message) =>
			message._tag === "ClickedTab" && message.tab !== model.tab && model.orgSlug !== null
				? {
						model,
						outMessage: PageOutMessage.RequestedNavigation({
							href: tabPath(model.orgSlug, model.channelId, message.tab),
							replace: false,
						}),
					}
				: update(model, message),
		routeChanged: (model, route) => ({ model: setTab(model, tabOf(route)) }),
		view: Submodel.defineView<Model, Message, PageViewInputs>((model, _inputs, h) =>
			channelView(h, model, toSelf),
		),
		subscriptions,
		sharedChanged: (model, shared) => setCurrentUserId(model, shared.currentUser?.id ?? null),
	},
)
