/**
 * The user of the last session on this device. The next load starts signed in as them, so the app
 * shows their rows from the local cache (`core/db/local-cache.ts`) while the session check and
 * `user.me` are still on their way. What the API then says settles it: `user.me` names the user to
 * remember, and a session that has ended takes the remembered user and their cached rows with it.
 */
import type { UserId } from "@hazel/schema"
import { Effect, Option } from "effect"
import { forgetLocalCache } from "~/db/local-cache"
import { forgetRememberedOrganizations } from "~/db/sync-manager"
import { readStored, removeStored, writeStored } from "../data/storage"
import { CurrentUser } from "../session"

export const REMEMBERED_USER_KEY = "hazel:last-user"

const stored = readStored(REMEMBERED_USER_KEY, CurrentUser)

export const loadRememberedUser: Effect.Effect<CurrentUser | null> = stored.pipe(Effect.map(Option.getOrNull))

const forgetUser: Effect.Effect<void> = removeStored(REMEMBERED_USER_KEY)

/** The cached rows the remembered user's load shows, and the page that shows them. */
export interface RememberedCache {
	/** Deletes the cache, `userId`'s when none is open; whether one was open (`forgetLocalCache`). */
	readonly forget: (userId?: UserId) => Promise<boolean>
	/** A new page: the open collections hold rows of a cache that is gone. */
	readonly reload: () => void
}

export const makeRememberedSession = (cache: RememberedCache) => {
	const startOver = Effect.sync(cache.reload).pipe(Effect.andThen(Effect.never))
	/** Forgets the remembered user and deletes their cached rows; whether a cache was open. */
	const clear = Effect.gen(function* () {
		const remembered = yield* stored
		yield* forgetUser
		return yield* Effect.promise(() => cache.forget(Option.getOrUndefined(remembered)?.id))
	})
	return {
		clear,
		/** The session has ended. A page showing the cached rows loads again, signed out. */
		forget: Effect.gen(function* () {
			if (yield* clear) yield* startOver
		}),
		/**
		 * `user.me` answered with `user`. A store that is full or blocked only costs the next load
		 * its head start. A load that started as someone else has their rows on screen: it starts over.
		 */
		settle: (user: CurrentUser): Effect.Effect<void> =>
			Effect.gen(function* () {
				const remembered = yield* stored
				const isOther = Option.isSome(remembered) && remembered.value.id !== user.id
				// Removed first: should the write below fail, the next load must not start as them.
				if (isOther) yield* forgetUser
				yield* writeStored(REMEMBERED_USER_KEY, CurrentUser, user).pipe(Effect.ignore)
				if (!isOther) return
				if (yield* Effect.promise(() => cache.forget(remembered.value.id))) yield* startOver
			}),
	}
}

const session = makeRememberedSession({
	forget: (userId) => {
		if (userId !== undefined) forgetRememberedOrganizations(userId)
		return forgetLocalCache(userId)
	},
	reload: () => window.location.reload(),
})

/** Sign-out: the caller loads a new page itself. */
export const clearRememberedSession: Effect.Effect<boolean> = session.clear
export const forgetRememberedSession: Effect.Effect<void> = session.forget
export const settleRememberedUser = session.settle
