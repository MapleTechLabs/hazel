import { definePage } from "../../contract"
import { Message } from "./message"
import { Model } from "./model"
import { init, update } from "./update"
import { view } from "./view"

/** `/$orgSlug/settings/invitations` */
export const page = definePage(
	"SettingsInvitations",
	{ Model, Message },
	{ routes: ["SettingsInvitations"], init, update, view },
)
