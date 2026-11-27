/** Re-exports `@hazel/client-data` (and the app's instance, `./client.ts`) at its old path. */
import { clientData } from "./client"

export { type RememberedOrgSources, startSyncSession } from "@hazel/client-data"

export const {
	syncSession,
	closeSync,
	rememberedOrganizationIds,
	forgetRememberedOrganizations,
	orgSourcesSettled: appOrgSourcesSettled,
} = clientData
