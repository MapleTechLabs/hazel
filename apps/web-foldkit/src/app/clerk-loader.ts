import { loadClerkJSScript, loadClerkUIScript } from "@clerk/shared/loadClerkJsScript"
import { Effect, Schema } from "effect"

/** clerk-js or Clerk's UI failed to download or load; auth stays `Loading`. */
export class ClerkLoadError extends Schema.TaggedError<ClerkLoadError>()("ClerkLoadError", {
	message: Schema.String,
}) {}

interface LoadableClerk {
	readonly load: (options: Record<string, unknown>) => Promise<unknown>
}

const isLoadable = (clerk: unknown): clerk is LoadableClerk =>
	typeof clerk === "object" && clerk !== null && "load" in clerk && typeof clerk.load === "function"

const attempt = <A>(run: () => Promise<A>) =>
	Effect.tryPromise({ try: run, catch: (error) => new ClerkLoadError({ message: String(error) }) })

/**
 * Downloads clerk-js and Clerk's UI and loads them with legacy `<ClerkProvider>`'s options
 * (`apps/web/src/main.tsx`). `app/clerk.ts` then sees `window.Clerk.loaded` and follows it.
 */
export const loadClerk = (publishableKey: string): Effect.Effect<void, ClerkLoadError> =>
	Effect.gen(function* () {
		yield* attempt(() => loadClerkJSScript({ publishableKey }))
		yield* attempt(() => loadClerkUIScript({ publishableKey }))
		const clerk: unknown = window.Clerk
		if (!isLoadable(clerk))
			return yield* new ClerkLoadError({ message: "window.Clerk missing after clerk-js loaded" })
		yield* attempt(() =>
			clerk.load({
				ui: { ClerkUI: Reflect.get(window, "__internal_ClerkUICtor") },
				afterSignOutUrl: "/",
				signInUrl: "/sign-in",
				signUpUrl: "/sign-up",
				signInFallbackRedirectUrl: "/",
				signUpFallbackRedirectUrl: "/",
			}),
		)
	})
