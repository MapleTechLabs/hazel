/**
 * Presence timing, shared by the `UserObject` (`./presence.ts`) and the org copies
 * (`../org/projections.ts`). A leaf module, so both can import it without a load-order cycle.
 */

/**
 * The client beats every 15 s, but a hidden tab's timers are throttled to about one a minute
 * (Chrome's intensive throttling), so this outlasts two of those with room for a failed one.
 */
export const HEARTBEAT_TIMEOUT_MS = 150_000

/**
 * While the user stays active, the `UserObject` re-projects their row to every org this often,
 * even with no status change, so each org's copy carries a fresh `lastSeenAt` (its lease).
 */
export const PRESENCE_RENEW_MS = 120_000

/**
 * How long an org trusts a projected non-offline status without a renewal. Past it the org marks
 * its copy offline on its own alarm, so a user whose `UserObject` never runs its alarm again
 * (idle since a deploy, a lost delivery, a row from before leases) does not stay online forever.
 * It outlasts the user's own timeout plus one renewal, with room for a slow delivery.
 */
export const PRESENCE_LEASE_MS = HEARTBEAT_TIMEOUT_MS + PRESENCE_RENEW_MS + 90_000
