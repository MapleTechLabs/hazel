import { NotificationId } from "@hazel/schema"
import { Duration, Effect, Schedule, Schema } from "effect"
import { Command } from "foldkit"
import { load, pushUrl, replaceUrl } from "foldkit/navigation"
import { readAccessToken } from "~/lib/access-token"
import { isRetryableError } from "~/lib/error-messages"
import { catchCommon } from "../data/actions"
import { saveSoundSettings, SoundSettings } from "../notification-sound"
import { HazelRpc } from "../rpc"
import { applyTheme, ResolvedTheme, saveThemePreference, ThemeCustomization, ThemePreference } from "../theme"
import { readSession, signOut } from "./auth"
import { Message } from "./message"
import { deliverNotifications } from "./notification-sinks"

export const NavigateInternal = Command.define("NavigateInternal", {
	args: { url: Schema.String },
	messages: [Message.CompletedNavigateInternal],
	execute: ({ url }) => pushUrl(url).pipe(Effect.as(Message.CompletedNavigateInternal())),
})

/** Redirects replace the history entry, so Back never lands on a page that forwards again. */
export const ReplaceUrl = Command.define("ReplaceUrl", {
	args: { url: Schema.String },
	messages: [Message.CompletedReplaceUrl],
	execute: ({ url }) => replaceUrl(url).pipe(Effect.as(Message.CompletedReplaceUrl())),
})

/** A full page load of `href`: another site, or the app itself after sign-out so every cache starts over. */
export const LoadExternal = Command.define("LoadExternal", {
	args: { href: Schema.String },
	messages: [Message.CompletedLoadExternal],
	execute: ({ href }) => load(href).pipe(Effect.as(Message.CompletedLoadExternal())),
})

export const ApplyTheme = Command.define("ApplyTheme", {
	args: { resolved: ResolvedTheme, customization: ThemeCustomization },
	messages: [Message.CompletedApplyTheme],
	execute: ({ resolved, customization }) =>
		applyTheme(resolved, customization).pipe(Effect.as(Message.CompletedApplyTheme())),
})

export const SaveThemePreference = Command.define("SaveThemePreference", {
	args: { preference: ThemePreference },
	messages: [Message.CompletedSaveThemePreference, Message.FailedSaveThemePreference],
	execute: ({ preference }) =>
		saveThemePreference(preference).pipe(
			Effect.as(Message.CompletedSaveThemePreference()),
			Effect.catchTag("StorageWriteError", () => Effect.succeed(Message.FailedSaveThemePreference())),
		),
})

export const SaveSoundSettings = Command.define("SaveSoundSettings", {
	args: { settings: SoundSettings },
	messages: [Message.CompletedSaveSoundSettings, Message.FailedSaveSoundSettings],
	execute: ({ settings }) =>
		saveSoundSettings(settings).pipe(
			Effect.as(Message.CompletedSaveSoundSettings()),
			Effect.catchTag("StorageWriteError", () => Effect.succeed(Message.FailedSaveSoundSettings())),
		),
})

/** `notificationOrchestrator.enqueue(events)`; it skips what it has already processed. */
export const DeliverNotifications = Command.define("DeliverNotifications", {
	args: { ids: Schema.Array(NotificationId) },
	messages: [Message.CompletedDeliverNotifications],
	execute: ({ ids }) => deliverNotifications(ids).pipe(Effect.as(Message.CompletedDeliverNotifications())),
})

/** How long the app waits before asking again after the API did not answer. */
export const RETRY_DELAY = Duration.seconds(10)

const checkSession = readSession.pipe(
	Effect.map((auth) => Message.ChangedAuth({ auth })),
	Effect.catchTag("SessionCheckError", ({ reason }) =>
		Effect.succeed(Message.FailedCheckSession({ reason })),
	),
	catchCommon((reason) => Message.FailedCheckSession({ reason })),
)

/** Whether the API has a session for this browser. */
export const CheckSession = Command.define("CheckSession", {
	messages: [Message.ChangedAuth, Message.FailedCheckSession],
	execute: checkSession,
})

/** The session check again after a pause, while the API has not answered. */
export const RetryCheckSession = Command.define("RetryCheckSession", {
	messages: [Message.ChangedAuth, Message.FailedCheckSession],
	execute: Effect.sleep(RETRY_DELAY).pipe(Effect.andThen(checkSession)),
})

/** A full page load: every query, sync and token starts over. */
export const Reload = Command.define("Reload", {
	messages: [Message.CompletedReload],
	execute: Effect.sync(() => window.location.reload()).pipe(Effect.as(Message.CompletedReload())),
})

export const SignOut = Command.define("SignOut", {
	messages: [Message.SucceededSignOut, Message.FailedSignOut],
	execute: signOut.pipe(
		Effect.as(Message.SucceededSignOut()),
		Effect.catchTag("SignOutError", ({ reason }) => Effect.succeed(Message.FailedSignOut({ reason }))),
		catchCommon((reason) => Message.FailedSignOut({ reason })),
	),
})

/** A momentary `user.me` failure is retried in place before it is reported. */
const retryBlip = Schedule.exponential("500 millis").pipe(Schedule.jittered)

const fetchCurrentUser = Effect.gen(function* () {
	const client = yield* HazelRpc
	const user = yield* client("user.me", undefined).pipe(
		Effect.retry({ schedule: retryBlip, times: 2, while: isRetryableError }),
	)
	return Message.SucceededFetchCurrentUser({
		user: {
			id: user.id,
			firstName: user.firstName ?? "",
			lastName: user.lastName ?? "",
			email: user.email,
			avatarUrl: user.avatarUrl ?? null,
			isOnboarded: user.isOnboarded,
		},
	})
}).pipe(catchCommon((reason) => Message.FailedFetchCurrentUser({ reason })))

export const FetchCurrentUser = Command.define("FetchCurrentUser", {
	messages: [Message.SucceededFetchCurrentUser, Message.FailedFetchCurrentUser],
	execute: fetchCurrentUser,
})

/**
 * Exchanges the sync token at boot, beside the session check, so the sync sockets need not wait
 * for it once `user.me` answers. A refused exchange is reported by `readAccessToken` itself.
 */
export const WarmAccessToken = Command.define("WarmAccessToken", {
	messages: [Message.CompletedWarmAccessToken],
	// Best effort: a failed exchange is asked again by the sockets' own read.
	execute: Effect.tryPromise(readAccessToken).pipe(
		Effect.ignore,
		Effect.as(Message.CompletedWarmAccessToken()),
	),
})

/** `user.me` again after a pause, while the API keeps failing to answer it. */
export const RetryFetchCurrentUser = Command.define("RetryFetchCurrentUser", {
	messages: [Message.SucceededFetchCurrentUser, Message.FailedFetchCurrentUser],
	execute: Effect.sleep(RETRY_DELAY).pipe(Effect.andThen(fetchCurrentUser)),
})
