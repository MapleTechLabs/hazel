import { definePage } from "../contract"
import { Message } from "./message"
import { Model } from "./model"
import { subscriptions } from "./subscription"
import { init, update } from "./update"
import { view } from "./view"

/** `/oauth/bot-install`: a bot's install link, where an admin picks a workspace and approves. */
export const page = definePage(
	"BotInstall",
	{ Model, Message },
	{ routes: ["BotInstall"], init, update, view, subscriptions },
)
