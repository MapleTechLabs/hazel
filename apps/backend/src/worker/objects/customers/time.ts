/** UTC calendar days (`YYYY-MM-DD`), the key of every daily customers table. */
import type { Day } from "@hazel/domain/customers"

export const DAY_MS = 86_400_000

export const dayOf = (date: Date): Day => date.toISOString().slice(0, 10)

/** The day's start, 00:00 UTC. */
export const startOfDay = (day: Day): Date => new Date(`${day}T00:00:00.000Z`)

export const addDays = (day: Day, days: number): Day =>
	dayOf(new Date(startOfDay(day).getTime() + days * DAY_MS))

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export const daysBetween = (from: Day, to: Day): number =>
	Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / DAY_MS)

/** Whole days elapsed from the instant `from` to `now` (floored, ≥ 0). */
export const daysSince = (from: Date, now: Date): number =>
	Math.max(0, Math.floor((now.getTime() - from.getTime()) / DAY_MS))

/** `count` days ending on `last`, oldest first. */
export const dayRange = (last: Day, count: number): Array<Day> =>
	Array.from({ length: count }, (_, index) => addDays(last, index - count + 1))
