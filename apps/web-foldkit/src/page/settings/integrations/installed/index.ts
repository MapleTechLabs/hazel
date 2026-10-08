import { definePage } from "../../../contract"
import { Message } from "./message"
import { Model } from "./model"
import { subscriptions } from "./subscription"
import { init, update } from "./update"
import { view } from "./view"

/** `/$orgSlug/settings/integrations/installed` */
export const page = definePage(
	"InstalledAppsSettings",
	{ Model, Message },
	{ routes: ["SettingsIntegrationsInstalled"], init, update, view, subscriptions },
)
