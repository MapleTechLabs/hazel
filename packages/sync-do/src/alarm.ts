/**
 * One native alarm per object: armed for the earliest of every deadline the object and the runtime
 * register (outbox retries, pruning, token expiry, the object's own timers). The same approach as
 * the bot gateway: an earlier pending alarm is kept, a later one is pulled forward.
 */
import { Clock, Effect } from "effect"

/** The alarm calls of `DurableObjectStorage`. */
export interface AlarmStorageLike {
	getAlarm(): Promise<number | null>
	setAlarm(scheduledTime: number): Promise<void>
}

/** An alarm never fires sooner than this after it is armed (no hot loop on an overdue deadline). */
const MIN_DELAY_MS = 1_000

export const earliest = (deadlines: ReadonlyArray<number | null | undefined>): number | undefined => {
	let target: number | undefined
	for (const deadline of deadlines) {
		if (deadline === null || deadline === undefined || !Number.isFinite(deadline)) continue
		if (target === undefined || deadline < target) target = deadline
	}
	return target
}

/**
 * Arm the alarm for the earliest deadline. Call it after every write that may add one and at the
 * end of `alarm()` (workerd clears the alarm when it fires). Returns the armed time.
 */
export const scheduleAlarm = (
	storage: AlarmStorageLike,
	deadlines: ReadonlyArray<number | null | undefined>,
): Effect.Effect<number | undefined> =>
	Effect.gen(function* () {
		const deadline = earliest(deadlines)
		if (deadline === undefined) return undefined
		const now = yield* Clock.currentTimeMillis
		const target = Math.max(deadline, now + MIN_DELAY_MS)
		return yield* Effect.promise(async () => {
			const current = await storage.getAlarm()
			if (current !== null && current <= target && current > now) return current
			await storage.setAlarm(target)
			return target
		})
	}).pipe(Effect.withSpan("SyncDO.scheduleAlarm"))
