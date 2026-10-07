import { Effect, Queue, Stream } from "effect"
import type { Auth } from "../session"

/**
 * Auth through `window.Clerk`, the same instance the legacy app and the parity stub use. Clerk may
 * load after boot, so the stream polls for it, then follows its listener.
 */

interface ClerkSession {
	readonly session?: unknown
}
interface ListenableClerk {
	readonly loaded?: boolean
	readonly addListener: (listener: (resources: ClerkSession) => void) => () => void
}
interface SignOutClerk {
	readonly signOut: (options?: { redirectUrl?: string }) => Promise<unknown>
}

const isListenable = (clerk: object): clerk is ListenableClerk =>
	"addListener" in clerk && typeof clerk.addListener === "function"
const canSignOut = (clerk: object): clerk is SignOutClerk =>
	"signOut" in clerk && typeof clerk.signOut === "function"

const POLL_MS = 50

/** `useAuth({ treatPendingAsSignedOut: false }).isSignedIn`: any session counts. */
export const clerkAuthStream: Stream.Stream<Auth> = Stream.callback<Auth>((queue) =>
	Effect.acquireRelease(
		Effect.sync(() => {
			let unsubscribe: (() => void) | undefined
			const attach = () => {
				const clerk = window.Clerk
				if (!clerk?.loaded || !isListenable(clerk)) return false
				unsubscribe = clerk.addListener(({ session }) =>
					Queue.offerUnsafe(queue, session ? "SignedIn" : "SignedOut"),
				)
				return true
			}
			const timer = attach() ? undefined : setInterval(() => attach() && clearInterval(timer), POLL_MS)
			return () => {
				clearInterval(timer)
				unsubscribe?.()
			}
		}),
		(release) => Effect.sync(release),
	).pipe(Effect.flatMap(() => Effect.never)),
)

/** `useAuth().logout()`: Clerk signs out and sends the browser to `/`. */
export const signOut = Effect.promise(async () => {
	const clerk = window.Clerk
	if (clerk && canSignOut(clerk)) await clerk.signOut({ redirectUrl: "/" })
})
