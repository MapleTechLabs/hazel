import { HttpApiBuilder } from "effect/http-api"
import { CurrentUser, UnauthorizedError } from "@hazel/domain"
import { MarkOfflineResponse } from "@hazel/domain/http"
import { Effect } from "effect"
import { HazelApi } from "../api"
import { applyNow } from "../worker/objects/fanout"
import { userTarget } from "../worker/objects/kinds"
import { PresenceEffects } from "../worker/objects/user/presence-kinds"

/**
 * The sendBeacon endpoint: marks the caller offline in their `UserObject` (which projects it to
 * their orgs). Beacons can't set headers, so the session cookie authenticates it (native clients
 * send a bearer). Best effort, like the beacon; the socket closing marks them offline too.
 */
export const HttpPresencePublicLive = HttpApiBuilder.group(HazelApi, "presencePublic", (handlers) =>
	Effect.succeed(
		handlers.handle(
			"markOffline",
			Effect.fn("Presence.markOffline")(function* ({ payload }) {
				const user = yield* CurrentUser.Context
				if (payload.userId !== user.id) {
					return yield* new UnauthorizedError({
						message: "Cannot mark another user offline",
						detail: "The payload's userId is not the signed-in user",
					})
				}
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
