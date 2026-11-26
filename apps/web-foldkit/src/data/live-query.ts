/** Re-exports `@hazel/client-data` (and the app's instance, `./client.ts`) at its old path. */
import { clientData } from "~/db/client"

export type { EmptyHold, LiveQueryOptions } from "@hazel/client-data"

export const { liveQueryStream, watchStall, retainChannels } = clientData
