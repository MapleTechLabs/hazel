import { Atom } from "effect/reactivity"

/**
 * Shared "now" signal used to periodically re-render presence UI.
 * Lets us derive effective Offline status from `lastSeenAt` even if the DB row doesn't change.
 */
export const presenceNowSignal = Atom.readable<number>((get) => {
	const now = Date.now()

	const intervalId = setInterval(() => {
		get.setSelf(Date.now())
	}, 5_000)

	get.addFinalizer(() => {
		clearInterval(intervalId)
	})

	return now
})
