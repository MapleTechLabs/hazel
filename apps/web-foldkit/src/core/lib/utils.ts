import { DateTime } from "effect"
import { cx } from "../utils/cx"

/** Joins class names, dropping falsy ones, with later Tailwind classes winning conflicts. */
export const cn = cx

/**
 * Convert a `Date | DateTime.Utc` to epoch milliseconds.
 * Handles the Effect v4 change where Schema models may return `DateTime.Utc` instead of `Date`.
 */
export function toEpochMs(d: Date | DateTime.Utc): number {
	return d instanceof Date ? d.getTime() : d.epochMilliseconds
}

/**
 * Convert a `Date | DateTime.Utc` to a plain `Date`.
 * Useful when passing to `new Date()`.
 */
export function toDate(d: Date | DateTime.Utc): Date {
	return d instanceof Date ? d : new Date(d.epochMilliseconds)
}
