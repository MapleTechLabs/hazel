import * as ChannelSettingsIntegrations from "./integrations"

/**
 * The channel settings pages still on Foldkit: their own chunk, loaded with the first of their routes
 * (`../registry.ts`). Overview, Connect and the redirect are native (`root/native-pages.ts`).
 */
export const pages = [ChannelSettingsIntegrations.page]
