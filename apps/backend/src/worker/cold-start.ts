/**
 * Whether an event paid for a start, as span attributes: `isolate.cold` on the first event an
 * isolate handles (the script's evaluation and the shared layer build happened under it), and
 * `object.cold` on the first call an in-memory object instance serves (`./objects/runtime.ts`).
 *
 * The api Worker and its objects are one script, so an isolate may host either or both: the flag
 * is the isolate's, taken by whichever event comes first.
 */
let isolateServed = false

/** True once per isolate: for the first event that asks. */
export const takeIsolateCold = (): boolean => {
	const cold = !isolateServed
	isolateServed = true
	return cold
}
