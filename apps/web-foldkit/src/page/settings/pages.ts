import * as SettingsChatSync from "./chat-sync"
import * as SettingsChatSyncConnection from "./chat-sync-connection"
import * as SettingsConnectInvites from "./connect-invites"
import * as SettingsCustomEmojis from "./custom-emojis"
import * as SettingsDebug from "./debug"
import * as SettingsGeneral from "./general"
import * as IntegrationSettings from "./integrations/detail"
import * as IntegrationsSettings from "./integrations/index"
import * as InstalledAppsSettings from "./integrations/installed"
import * as MarketplaceSettings from "./integrations/marketplace"
import * as YourAppsSettings from "./integrations/your-apps"
import * as SettingsInvitations from "./invitations"
import * as TeamSettings from "./team"

/** The organization settings pages: their own chunk, loaded with the first settings route (`../registry.ts`). */
export const pages = [
	TeamSettings.page,
	IntegrationsSettings.page,
	InstalledAppsSettings.page,
	MarketplaceSettings.page,
	YourAppsSettings.page,
	IntegrationSettings.page,
	SettingsGeneral.page,
	SettingsDebug.page,
	SettingsConnectInvites.page,
	SettingsInvitations.page,
	SettingsCustomEmojis.page,
	SettingsChatSync.page,
	SettingsChatSyncConnection.page,
]
