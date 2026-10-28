/**
 * The effect kinds a `UserObject` receives for presence (receivers in `../effects/user-effects.ts`,
 * over `./presence.ts`). A leaf module, so the registry can spread it at load time.
 */
import { UserId } from "@hazel/schema"
import { Schema } from "effect"
import { defineEffect } from "../effects/registry"

/** `user.markOffline`: the public sendBeacon endpoint (`routes/presence.http.ts`). */
export const MarkOfflinePayload = Schema.Struct({ userId: UserId })

export const PresenceEffects = {
	markOffline: defineEffect("user.markOffline", "user", MarkOfflinePayload),
}
