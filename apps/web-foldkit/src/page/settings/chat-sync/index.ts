import { definePage } from "../../contract"
import { Message, Model } from "./model"
import { init, sharedChanged, update } from "./update"
import { view } from "./view"

/** `/$orgSlug/settings/chat-sync` */
export const page = definePage(
	"SettingsChatSync",
	{ Model, Message },
	{ routes: ["SettingsChatSync"], init, update, view, sharedChanged },
)
