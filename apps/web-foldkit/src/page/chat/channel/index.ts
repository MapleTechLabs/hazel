import { Submodel } from "foldkit"
import { definePage, type PageViewInputs } from "../../contract"
import { init, Message, Model, setCurrentUserId, update } from "./page"
import { subscriptions } from "./subscription"
import { view as channelView } from "./view"

/** `/$orgSlug/chat/$id` (messages tab). */

const toSelf = (message: Message) => message

export const page = definePage(
	"ChatChannel",
	{ Model, Message },
	{
		routes: ["ChatChannel"],
		// A new channel is a new page; React remounted on `key={id}` too.
		key: (route) => route.channelId,
		init: (route, shared) => ({ model: init(route.channelId, shared.currentUser?.id ?? null) }),
		update: (model, message) => update(model, message),
		view: Submodel.defineView<Model, Message, PageViewInputs>((model, _inputs, h) =>
			channelView(h, model, toSelf),
		),
		subscriptions,
		sharedChanged: (model, shared) => setCurrentUserId(model, shared.currentUser?.id ?? null),
	},
)
