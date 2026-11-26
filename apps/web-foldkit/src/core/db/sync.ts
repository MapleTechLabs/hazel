/** Re-exports `@hazel/client-data` (and the app's instance, `./client.ts`) at its old path. */
import { clientData } from "./client"

export const { syncHub, userSources, orgSources, customersSources, openCustomersSource, openChannelIds } =
	clientData
