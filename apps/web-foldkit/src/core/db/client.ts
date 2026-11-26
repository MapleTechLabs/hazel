/**
 * The app's one `@hazel/client-data` instance, over the web platform services. Every module that
 * used the old singletons (`./collections.ts`, `./sync.ts`, ...) reads it through those paths.
 */
import { ClientData } from "@hazel/client-data"
import { Effect } from "effect"
import { ClientPlatformWeb } from "./platform"

export const clientData = Effect.runSync(ClientData.make.pipe(Effect.provide(ClientPlatformWeb)))
