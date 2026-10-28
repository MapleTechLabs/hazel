import { HttpApiBuilder } from "effect/http-api"
import { MarkOfflineResponse } from "@hazel/domain/http"
import { Effect } from "effect"
import { HazelApi } from "../api"
import { applyNow } from "../worker/objects/fanout"
import { userTarget } from "../worker/objects/kinds"
import { PresenceEffects } from "../worker/objects/user/presence-kinds"

/**
 * The public sendBeacon endpoint: marks the user offline in their `UserObject` (which projects it
 * to their orgs). Best effort, like the beacon; the socket closing marks them offline too.
 */
export const HttpPresencePublicLive = HttpApiBuilder.group(HazelApi, "presencePublic", (handlers) =>
	Effect.succeed(
		handlers.handle(
			"markOffline",
			Effect.fn("Presence.markOffline")(function* ({ payload }) {
				// No auth or policy check since this is a public endpoint called by sendBeacon
				yield* applyNow(
					PresenceEffects.markOffline,
					userTarget(payload.userId),
					{ userId: payload.userId },
					crypto.randomUUID(),
				).pipe(
					Effect.catchTags({
						ApplyNowError: (error) =>
							Effect.logWarning("Mark offline failed", { message: error.message }),
						SchemaError: (error) => Effect.logWarning("Mark offline failed", { error }),
					}),
				)
				return new MarkOfflineResponse({ success: true })
			}),
		),
	),
)
