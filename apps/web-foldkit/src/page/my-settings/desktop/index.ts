import { definePage } from "../../contract"
import { Message } from "./message"
import { Model } from "./model"
import { init, interaction, update } from "./update"
import { view } from "./view"

/** `/$orgSlug/my-settings/desktop` */
export const page = definePage(
	"MySettingsDesktop",
	{ Model, Message },
	{ routes: ["MySettingsDesktop"], init, update, view, subscriptions: interaction.subscriptions },
)
