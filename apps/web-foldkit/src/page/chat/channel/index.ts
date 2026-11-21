import { Submodel } from "foldkit"
import { channelContext } from "../../../assistant/context"
import type { RouteOf } from "../../../route"
import { definePage, type PageViewInputs } from "../../contract"
import { type ChatTab, init, Message, Model, setCurrentUserId, setTab, switchChannel, update } from "./page"
import { syncReady, syncUnread } from "./clear-notifications"
import { subscriptions } from "./subscription"
import { view as channelView } from "./view"
import { andThen } from "./write"
import { modifyFields } from "foldkit/struct"
import * as CustomerCard from "../customer-card"

/** A layout change closes the customer card's surface the other layout opened. */
const reconcileCustomerCard = (model: Model, isMobile: boolean): Model => {
	const card = CustomerCard.reconcile(model.customerCard, isMobile)
	return card === model.customerCard ? model : modifyFields(model, { customerCard: () => card })
}

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
		assistantContext: (model, shared) =>
			shared.orgSlug === null
				? null
				: channelContext(shared.orgSlug, { id: model.channelId, name: model.channel?.name ?? null }),
		sharedChanged: (model, shared) =>
			andThen(
				setCurrentUserId(
					reconcileCustomerCard(model, shared.isMobile),
					shared.currentUser?.id ?? null,
				),
				(next) => andThen(syncUnread(next), (synced) => syncReady(synced, shared)),
			),
	},
)
