import { definePage } from "../../../contract"
import { Message } from "./message"
import { Model } from "./model"
import { subscriptions } from "./subscription"
import { init, sharedChanged, update } from "./update"
import { view } from "./view"

/** `/$orgSlug/settings/integrations` */
export const page = definePage(
	"IntegrationsSettings",
	{ Model, Message },
	{ routes: ["SettingsIntegrations"], init, update, view, subscriptions, sharedChanged },
)
