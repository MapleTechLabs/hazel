import { definePage } from "../../contract"
import { Message } from "./message"
import { Model } from "./model"
import { init, update } from "./update"
import { view } from "./view"

/** `/$orgSlug/my-settings/agents`: the agents (MCP OAuth apps, personal tokens) that may act for the user. */
export const page = definePage(
	"MySettingsAgents",
	{ Model, Message },
	{ routes: ["MySettingsAgents"], key: ({ orgSlug }) => orgSlug, init, update, view },
)
