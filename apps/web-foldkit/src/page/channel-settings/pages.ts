import * as ChannelSettingsConnect from "./connect"
import * as ChannelSettingsIntegrations from "./integrations"
import * as ChannelSettingsOverview from "./overview"
import * as ChannelSettingsRedirect from "./redirect"

/** The channel settings pages: their own chunk, loaded with the first of their routes (`../registry.ts`). */
export const pages = [
	ChannelSettingsRedirect.page,
	ChannelSettingsOverview.page,
	ChannelSettingsConnect.page,
	ChannelSettingsIntegrations.page,
]
