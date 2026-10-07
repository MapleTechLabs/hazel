import { definePage } from "../../../contract"
import { Message } from "./message"
import { Model } from "./model"
import { subscriptions } from "./subscription"
import { init, update } from "./update"
import { view } from "./view"

/** `/$orgSlug/settings/integrations/marketplace` */
export const page = definePage(
	"MarketplaceSettings",
	{ Model, Message },
	{ routes: ["SettingsIntegrationsMarketplace"], init, update, view, subscriptions },
)
