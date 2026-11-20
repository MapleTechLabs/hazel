/**
 * Presence timing, shared by the `UserObject` (`./presence.ts`) and the org copies
 * (`../org/projections.ts`). A leaf module, so both can import it without a load-order cycle.
 */

/**
 * How long a session lives without a ping. Each sync socket pings every 25 s, but a hidden tab's
 * timers are throttled to about one a minute (Chrome's intensive throttling), so this outlasts one
 * of those with room for a slow one. A connection that closes cleanly ends its session at once.
 */
export const SESSION_TIMEOUT_MS = 90_000

/**
 * While the user has a live session, the `UserObject` re-projects their row to every org this
 * often, even with no status change, so each org's copy carries a fresh `lastSeenAt` (its lease).
 */
export const PRESENCE_RENEW_MS = 120_000

/**
 * How long an org trusts a projected non-offline status without a renewal. Past it the org marks
 * its copy offline on its own alarm, so a user whose `UserObject` never runs its alarm again
 * (idle since a deploy, a lost delivery) does not stay online forever. It outlasts the session
 * timeout plus one renewal, with room for a slow delivery.
 */
export const PRESENCE_LEASE_MS = SESSION_TIMEOUT_MS + PRESENCE_RENEW_MS + 90_000

/** The session an old client's `userPresenceStatus.heartbeat` RPC keeps alive (it has no frames). */
export const HEARTBEAT_SESSION_ID = "rpc-heartbeat"
