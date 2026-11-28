/**
 * The session as it changes (`Session`, `./session`): the one "who and where" a shell reads. Switching
 * organization, or a refreshed `user.me`, is a new value here; the shell redraws on it, no restart.
 */
import { Context, type Effect, type Stream } from "effect"
import type { Session } from "./session"

export class CurrentSession extends Context.Service<
	CurrentSession,
	{
		/** The session now and after each change; `organization: null` when the user has none here. */
		readonly changes: Stream.Stream<Session>
		/**
		 * Moves to the user's organization at `orgSlug` (a link into it); `false` when they are not a
		 * member there.
		 */
		readonly switchTo: (orgSlug: string) => Effect.Effect<boolean>
	}
>()("hazel/app/CurrentSession") {}
