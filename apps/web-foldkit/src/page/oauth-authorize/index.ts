import { definePage } from "../contract"
import { Message } from "./message"
import { Model } from "./model"
import { init, update } from "./update"
import { view } from "./view"

/** `/oauth/authorize`: an agent (an MCP client) asks to act for the signed-in user in Hazel. */
export const page = definePage(
	"OAuthAuthorize",
	{ Model, Message },
	{ routes: ["OAuthAuthorize"], init, update, view },
)
