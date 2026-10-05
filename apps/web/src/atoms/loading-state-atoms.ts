import { Atom } from "effect/reactivity"

/**
 * Loading state enum
 */
export type LoadingState = "idle" | "loading-top" | "loading-bottom" | "cooldown"

/**
 * Cooldown duration in milliseconds
 */
const COOLDOWN_MS = 300

/**
 * Atom family for per-component loading states
 * Each component can have its own isolated loading state
 */
export const loadingStateAtomFamily = Atom.family((_id: string) =>
	Atom.make<LoadingState>("idle").pipe(Atom.keepAlive),
)

/**
 * Derived atom that checks if loading can start from top
 */
export const canLoadTopAtomFamily = Atom.family((id: string) =>
	Atom.make((get) => {
		const state = get(loadingStateAtomFamily(id))
		return state === "idle"
	}).pipe(Atom.keepAlive),
)

/**
 * Derived atom that checks if loading can start from bottom
 */
export const canLoadBottomAtomFamily = Atom.family((id: string) =>
	Atom.make((get) => {
		const state = get(loadingStateAtomFamily(id))
		return state === "idle"
	}).pipe(Atom.keepAlive),
)

/**
 * Derived atom that checks if currently loading
 */
export const isLoadingAtomFamily = Atom.family((id: string) =>
	Atom.make((get) => {
		const state = get(loadingStateAtomFamily(id))
		return state === "loading-top" || state === "loading-bottom"
	}).pipe(Atom.keepAlive),
)

/**
 * Helper function to start loading from top
 * Returns true if loading started, false if already loading
 */
export const startLoadingTop = (id: string): boolean => {
	let started = false
	Atom.batch(() => {
		return Atom.update(loadingStateAtomFamily(id), (currentState) => {
			if (currentState === "idle") {
				started = true
				return "loading-top"
			}
			return currentState
		})
	})
	return started
}

/**
 * Helper function to start loading from bottom
 * Returns true if loading started, false if already loading
 */
export const startLoadingBottom = (id: string): boolean => {
	let started = false
	Atom.batch(() => {
		return Atom.update(loadingStateAtomFamily(id), (currentState) => {
			if (currentState === "idle") {
				started = true
				return "loading-bottom"
			}
			return currentState
		})
	})
	return started
}

/**
 * Helper function to finish loading and enter cooldown
 * Automatically returns to idle after cooldown period
 */
export const finishLoading = (id: string): void => {
	Atom.batch(() => {
		return Atom.set(loadingStateAtomFamily(id), "cooldown")
	})

	// Set timeout to return to idle after cooldown
	setTimeout(() => {
		Atom.batch(() => {
			return Atom.set(loadingStateAtomFamily(id), "idle")
		})
	}, COOLDOWN_MS)
}

/**
 * Helper function to reset loading state to idle
 * Useful for cleanup or error handling
 */
export const resetLoadingState = (id: string): void => {
	Atom.batch(() => {
		return Atom.set(loadingStateAtomFamily(id), "idle")
	})
}
