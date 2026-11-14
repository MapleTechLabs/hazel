/**
 * The user of the last session on this device. The next load starts signed in as them, so the app
 * shows their rows from the local cache (`core/db/local-cache.ts`) while the session check and
 * `user.me` are still on their way. What the API then says settles it: `user.me` names the user to
 * remember, and a session that has ended takes the remembered user and their cached rows with it.
 */
import { Effect, Option } from "effect"
import { forgetLocalCache } from "~/db/local-cache"
import { readStored, removeStored, writeStored } from "../data/storage"
import { CurrentUser } from "../session"

export const REMEMBERED_USER_KEY = "hazel:last-user"

const stored = readStored(REMEMBERED_USER_KEY, CurrentUser)

export const loadRememberedUser: Effect.Effect<CurrentUser | null> = stored.pipe(Effect.map(Option.getOrNull))

export const forgetUser: Effect.Effect<void> = removeStored(REMEMBERED_USER_KEY)

/** The cached rows the remembered user's load shows, and the page that shows them. */
export interface RememberedCache {
	/** Deletes the open cache; whether one was open (`forgetLocalCache`). */
	readonly forget: () => Promise<boolean>
	/** A new page: the open collections hold rows of a cache that is gone. */
	readonly reload: () => void
}

export const makeRememberedSession = (cache: RememberedCache) => {
	const startOver = Effect.sync(cache.reload).pipe(Effect.andThen(Effect.never))
	const forgetCache = Effect.promise(cache.forget)
	return {
		/** The session has ended. A page showing the cached rows loads again, signed out. */
		forget: Effect.gen(function* () {
			yield* forgetUser
			if (yield* forgetCache) yield* startOver
		}),
		/**
		 * `user.me` answered with `user`. A store that is full or blocked only costs the next load
		 * its head start. A load that started as someone else has their rows on screen: it starts over.
		 */
		settle: (user: CurrentUser): Effect.Effect<void> =>
			Effect.gen(function* () {
				const remembered = yield* stored
				yield* writeStored(REMEMBERED_USER_KEY, CurrentUser, user).pipe(Effect.ignore)
				if (Option.isNone(remembered) || remembered.value.id === user.id) return
				if (yield* forgetCache) yield* startOver
			}),
	}
}

const session = makeRememberedSession({
	forget: forgetLocalCache,
	reload: () => window.location.reload(),
})

export const forgetRememberedSession: Effect.Effect<void> = session.forget
export const settleRememberedUser = session.settle
