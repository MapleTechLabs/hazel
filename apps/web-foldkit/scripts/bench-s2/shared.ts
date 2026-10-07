import { resolve } from "node:path"
import { Effect, Fiber, Stream } from "effect"
import { heavyIds } from "../../../../packages/ui-parity/src/fixtures/datasets/heavy.ts"

/** Shared helpers for the S2 benchmark: timing, medians, the dev-mode freeze, stream plumbing. */

// The runtime's dev-only Model freeze (not a public export), loaded from the installed package.
const { deepFreeze } = (await import(
	resolve(import.meta.dir, "../../node_modules/foldkit/dist/runtime/deepFreeze.js")
)) as {
	deepFreeze: <A>(value: A) => A
}
export { deepFreeze }

export const channelId = heavyIds.bigChannelId
export const currentUserId = heavyIds.currentUserId

export const time = <A>(f: () => A): readonly [A, number] => {
	const started = performance.now()
	const result = f()
	return [result, performance.now() - started]
}

export const median = (values: ReadonlyArray<number>) => {
	const sorted = [...values].sort((a, b) => a - b)
	return Math.round((sorted[Math.floor(sorted.length / 2)] ?? 0) * 100) / 100
}

export const round = (value: number) => Math.round(value * 100) / 100

/** Runs a Message stream in the background; `next()` resolves with the next emission. */
export const subscribe = <A>(stream: Stream.Stream<A>) => {
	const queued: A[] = []
	let waiting: ((value: A) => void) | undefined
	const fiber = Effect.runFork(
		Stream.runForEach(stream, (value) =>
			Effect.sync(() => {
				if (waiting) {
					const resolve = waiting
					waiting = undefined
					resolve(value)
				} else queued.push(value)
			}),
		),
	)
	return {
		next: () =>
			new Promise<A>((resolve) => {
				const value = queued.shift()
				if (value !== undefined) resolve(value)
				else waiting = resolve
			}),
		stop: () => Effect.runPromise(Fiber.interrupt(fiber)),
	}
}

let counter = 0
/** A fresh uuid-shaped id that never collides with the dataset's v5 ids. */
export const freshId = () => `ffffffff-0000-4000-8000-${String(++counter).padStart(12, "0")}`

/** A new message at the end of the big channel. */
export const newMessageRow = (index: number) => ({
	id: freshId(),
	channelId,
	conversationId: null,
	authorId: currentUserId,
	content: `New message ${index} with **some** markdown`,
	embeds: null,
	replyToMessageId: null,
	threadChannelId: null,
	createdAt: new Date(Date.UTC(2026, 2, 12, 16, 0) + index * 1000),
	updatedAt: null,
	deletedAt: null,
})
