/**
 * The `UserObject` owner's real presence, for the decisions only their own object makes
 * (notifications, push): an invisible user still reads channels and still sits at a computer,
 * which others must not see but those decisions must respect. A leaf module (`./push.ts` and
 * `./message-notifications.ts` read it without importing `./presence.ts`'s outbox wiring).
 */
import { Database, SQLite, schema } from "@hazel/db"
import { Clock, Effect, Option } from "effect"
import { effectiveStatus, isLive, type Session } from "./presence-model"

/** The status the owner picked (timed picks past their end are online) and their live sessions. */
export const ownPresence = Effect.gen(function* () {
	const db = yield* Database.Database
	const nowMs = yield* Clock.currentTimeMillis
	// The store holds only its owner's rows.
	const preference = yield* db.first(SQLite.from(schema.userPresenceSettingsTable).select().limit(1))
	const sessions: ReadonlyArray<Session> = yield* db.run(SQLite.from(schema.presenceSessionsTable).select())
	return {
		preferred: effectiveStatus(Option.getOrUndefined(preference), nowMs),
		sessions: sessions.filter((session) => isLive(session, nowMs)),
	}
}).pipe(Effect.withSpan("UserObject.ownPresence"))

export type OwnPresence = Effect.Success<typeof ownPresence>
