import * as SettingsChatSyncConnection from "./chat-sync-connection"
import * as IntegrationSettings from "./integrations/detail"
import * as IntegrationsSettings from "./integrations/index"
import * as InstalledAppsSettings from "./integrations/installed"
import * as MarketplaceSettings from "./integrations/marketplace"
import * as YourAppsSettings from "./integrations/your-apps"

/** The organization settings pages: their own chunk, loaded with the first settings route (`../registry.ts`). */
export const pages = [
	IntegrationsSettings.page,
	InstalledAppsSettings.page,
	MarketplaceSettings.page,
	YourAppsSettings.page,
	IntegrationSettings.page,
	SettingsChatSyncConnection.page,
]
