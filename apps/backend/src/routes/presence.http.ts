import { HttpApiBuilder } from "effect/http-api"
import { UserPresenceStatusRepo } from "@hazel/backend-core"
import { Database } from "@hazel/db"
import { withRemapDbErrors } from "@hazel/domain"
import { MarkOfflineResponse } from "@hazel/domain/http"
import { Effect } from "effect"
import { HazelApi } from "../api"

export const HttpPresencePublicLive = HttpApiBuilder.group(HazelApi, "presencePublic", (handlers) =>
	Effect.gen(function* () {
		const db = yield* Database.Database
		const userPresenceStatusRepo = yield* UserPresenceStatusRepo

		return handlers.handle(
			"markOffline",
			Effect.fn(function* ({ payload }) {
				// No auth or policy check since this is a public endpoint called by sendBeacon
				yield* db
					.transaction(
						Effect.asVoid(
							userPresenceStatusRepo.updateStatus({
								userId: payload.userId,
								status: "offline",
								customMessage: null,
							}),
						),
					)
					.pipe(withRemapDbErrors("UserPresenceStatus", "update"))

				return new MarkOfflineResponse({
					success: true,
				})
			}),
		)
	}),
)
