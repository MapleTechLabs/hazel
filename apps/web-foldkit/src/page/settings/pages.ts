import * as SettingsChatSyncConnection from "./chat-sync-connection"
import * as IntegrationSettings from "./integrations/detail"

/** The organization settings pages: their own chunk, loaded with the first settings route (`../registry.ts`). */
export const pages = [IntegrationSettings.page, SettingsChatSyncConnection.page]
