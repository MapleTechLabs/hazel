import { definePage } from "../../../contract"
import { Message } from "./message"
import { Model } from "./model"
import { subscriptions } from "./subscription"
import { init, update } from "./update"
import { view } from "./view"

/** `/$orgSlug/settings/integrations/your-apps` */
export const page = definePage(
	"YourAppsSettings",
	{ Model, Message },
	{ routes: ["SettingsIntegrationsYourApps"], init, update, view, subscriptions },
)
