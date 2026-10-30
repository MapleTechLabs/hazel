import { Effect, Fiber, Stream } from "effect"

/**
 * Run a document-level key Stream (a Subscription's source) while `act` dispatches real `keydown`s,
 * and collect what it emits, with whether each event's default was prevented.
 */
export const collectKeyStream = async <A>(
	stream: Stream.Stream<A>,
	act: (press: (init: KeyboardEventInit, target?: EventTarget) => KeyboardEvent) => void,
): Promise<ReadonlyArray<A>> => {
	const emitted: Array<A> = []
	const fiber = Effect.runFork(Stream.runForEach(stream, (value) => Effect.sync(() => emitted.push(value))))
	// Let the stream attach its listener.
	await new Promise((resolve) => setTimeout(resolve, 0))
	act((init, target = document.body) => {
		const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init })
		target.dispatchEvent(event)
		return event
	})
	await new Promise((resolve) => setTimeout(resolve, 0))
	await Effect.runPromise(Fiber.interrupt(fiber))
	return emitted
}
