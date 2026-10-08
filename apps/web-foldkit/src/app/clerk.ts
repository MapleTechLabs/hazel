import { Effect, Queue, Schema, Stream } from "effect"
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

/** `window.Clerk` once it has loaded, polled until then. */
const loadedClerk: Effect.Effect<ListenableClerk> = Effect.suspend(() => {
	const clerk = window.Clerk
	return clerk?.loaded && isListenable(clerk)
		? Effect.succeed(clerk)
		: Effect.sleep(POLL_MS).pipe(Effect.andThen(loadedClerk))
})

/** `useAuth({ treatPendingAsSignedOut: false }).isSignedIn`: any session counts. */
export const clerkAuthStream: Stream.Stream<Auth> = Stream.callback<Auth>((queue) =>
	loadedClerk.pipe(
		Effect.flatMap((clerk) =>
			Effect.acquireRelease(
				Effect.sync(() =>
					clerk.addListener(({ session }) => Queue.offerUnsafe(queue, session ? "SignedIn" : "SignedOut")),
				),
				(unsubscribe) => Effect.sync(unsubscribe),
			),
		),
		Effect.flatMap(() => Effect.never),
	),
)

/** `clerk.signOut` rejected (offline); the user stays signed in. */
export class SignOutError extends Schema.TaggedError<SignOutError>()("SignOutError", {
	message: Schema.String,
}) {}

/** `useAuth().logout()`: Clerk signs out and sends the browser to `/`. */
export const signOut: Effect.Effect<void, SignOutError> = Effect.tryPromise({
	try: async () => {
		const clerk = window.Clerk
		if (clerk && canSignOut(clerk)) await clerk.signOut({ redirectUrl: "/" })
	},
	catch: (error) => new SignOutError({ message: String(error) }),
})
