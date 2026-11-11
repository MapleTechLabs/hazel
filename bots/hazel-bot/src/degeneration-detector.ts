import type { Response } from "effect/ai"
import { Effect, Stream } from "effect"

import { DegenerateOutputError } from "./errors.ts"

const WINDOW_SIZE = 200
const MIN_PATTERN_LEN = 2
const MAX_PATTERN_LEN = 10
const MIN_REPEATS = 8

/**
 * Detects degenerate repetitive output in a stream of LLM response parts.
 *
 * Maintains a sliding window of recent text-delta content and checks whether
 * any short substring (2-10 chars) repeats 8+ consecutive times at the tail.
 * If detected, the stream fails with a `DegenerateOutputError`.
 *
 * Non-text parts pass through unmodified.
 */
export const withDegenerationDetection = <E, R>(
	stream: Stream.Stream<Response.AnyPart, E, R>,
): Stream.Stream<Response.AnyPart, E | DegenerateOutputError, R> =>
	stream.pipe(
		Stream.mapAccum(
			() => "",
			(window: string, part: Response.AnyPart) => {
				if (part.type !== "text-delta") {
					return [window, [part]] as const
				}

				const updated = (window + part.delta).slice(-WINDOW_SIZE)
				const detected = findRepetition(updated)

				if (detected) {
					// Return a sentinel value to trigger failure after mapAccum
					return [
						updated,
						[{ __degenerate: true, pattern: detected.pattern, repeats: detected.repeats } as any],
					] as const
				}

				return [updated, [part]] as const
			},
		),
		Stream.filterEffect((part: any) => {
			if (part.__degenerate) {
				return Effect.fail(
					new DegenerateOutputError({
						message: `Detected repeating pattern "${part.pattern}" (${part.repeats}x)`,
						pattern: part.pattern,
						repeats: part.repeats,
					}),
				)
			}
			return Effect.succeed(true)
		}),
	) as Stream.Stream<Response.AnyPart, E | DegenerateOutputError, R>

/**
 * Scans the tail of the window for any substring of length 2-10 that repeats
 * 8+ consecutive times. Returns the first match found, or null.
 */
function findRepetition(window: string): { pattern: string; repeats: number } | null {
	const len = window.length
	for (let patLen = MIN_PATTERN_LEN; patLen <= MAX_PATTERN_LEN; patLen++) {
		// Need at least MIN_REPEATS * patLen chars to detect
		if (len < patLen * MIN_REPEATS) continue

		const pattern = window.slice(len - patLen)
		let repeats = 1
		let pos = len - patLen * 2

		while (pos >= 0 && window.slice(pos, pos + patLen) === pattern) {
			repeats++
			pos -= patLen
		}

		if (repeats >= MIN_REPEATS) {
			return { pattern, repeats }
		}
	}
	return null
}
