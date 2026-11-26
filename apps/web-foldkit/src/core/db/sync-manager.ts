/** Re-exports `@hazel/client-data` (and the app's instance, `./client.ts`) at its old path. */
import { clientData } from "./client"

export {
	type ObservedRows,
	orgSourcesOf,
	orgSourcesSettled,
	type RememberedOrgSources,
	startSyncSession,
	type SyncManagerDeps,
} from "@hazel/client-data"

export const {
	syncSession,
	closeSync,
	rememberedOrganizationIds,
	forgetRememberedOrganizations,
	orgSourcesSettled: appOrgSourcesSettled,
} = clientData
