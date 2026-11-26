// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The shell's Commands: today's root Commands (`git show cd159551c:apps/web-foldkit/src/app/command.ts`),
 * each the same Effect, as Effect UI Commands. I/O that needs a service is a `Command.Service`.
 */
import { Command, Component } from "@effect/ui"
import { ChannelId, NotificationId, OrganizationId, UserId } from "@hazel/schema"
import { Duration, Effect, Layer, Schedule, Schema } from "effect"
import { warmSyncObjects } from "~/db/warm"
import { readAccessToken } from "~/lib/access-token"
import { isRetryableError } from "~/lib/error-messages"
import { Overrides } from "~/lib/keybindings/keymap"
import { readSession, signOut } from "../app/auth"
import { deliverNotifications } from "../app/notification-sinks"
import { settleRememberedUser } from "../app/remembered-user"
import { catchCommon } from "../data/actions"
import { rememberLastOrganization } from "../data/last-organization"
import { saveKeybindingOverrides } from "../keybindings"
import { saveSoundSettings, SoundSettings } from "../notification-sound"
import { clearNoteDrafts } from "../page/customers/detail/note-drafts"
import { applyBadge, Badge } from "../platform/badge"
import { HazelAuthClient } from "../auth/client"
import { HazelRpc } from "../rpc"
import type { CurrentUser } from "../session"
import { applyTheme, ResolvedTheme, saveThemePreference, ThemeCustomization, ThemePreference } from "../theme"
import { AppMessage } from "./message"

/** How long the app waits before asking again after the API did not answer. */
export const RETRY_DELAY = Duration.seconds(10)

const silent = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
	effect.pipe(Effect.ignore, Effect.as(Component.noop))

export const ApplyTheme = Command.make(
	"ApplyTheme",
	{ args: { resolved: ResolvedTheme, customization: ThemeCustomization } },
	({ resolved, customization }) => silent(applyTheme(resolved, customization)),
)

/** The favicon's red dot, or the desktop icon's mention count (`platform/badge.ts`). */
export const ApplyBadge = Command.make("ApplyBadge", { args: { badge: Badge } }, ({ badge }) =>
	silent(applyBadge(badge)),
)

export const SaveThemePreference = Command.make(
	"SaveThemePreference",
	{ args: { preference: ThemePreference } },
	({ preference }) =>
		saveThemePreference(preference).pipe(
			Effect.as(Component.noop),
			Effect.catchTag("StorageWriteError", () =>
				Effect.succeed(AppMessage.FailedSaveThemePreference()),
			),
		),
)

export const SaveSoundSettings = Command.make(
	"SaveSoundSettings",
	{ args: { settings: SoundSettings } },
	({ settings }) =>
		saveSoundSettings(settings).pipe(
			Effect.as(Component.noop),
			Effect.catchTag("StorageWriteError", () => Effect.succeed(AppMessage.FailedSaveSoundSettings())),
		),
)

export const SaveKeybindings = Command.make(
	"SaveKeybindings",
	{ args: { overrides: Overrides } },
	({ overrides }) =>
		saveKeybindingOverrides(overrides).pipe(
			Effect.as(Component.noop),
			Effect.catchTag("StorageWriteError", () => Effect.succeed(AppMessage.FailedSaveKeybindings())),
		),
)

/** The organization the user opened, for the next app start (`page/root`). */
export const RememberLastOrganization = Command.make(
	"RememberLastOrganization",
	{ args: { organizationId: OrganizationId } },
	({ organizationId }) => silent(rememberLastOrganization(organizationId)),
)

/** `notificationOrchestrator.enqueue(events)`; it skips what it has already processed. */
export const DeliverNotifications = Command.make(
	"DeliverNotifications",
	{ args: { ids: Schema.Array(NotificationId) } },
	({ ids }) => silent(deliverNotifications(ids)),
)

/** A new sign-in: the previous user's unsent customer notes go. */
export const ClearNoteDrafts = Command.make("ClearNoteDrafts", { args: {} }, () => silent(clearNoteDrafts))

/** A full page load: every query, sync and token starts over. */
export const Reload = Command.make("Reload", { args: {} }, () =>
	silent(Effect.sync(() => window.location.reload())),
)

/** A full page load of `href`, as after sign-out so every cache starts over. */
export const LoadExternal = Command.make("LoadExternal", { args: { href: Schema.String } }, ({ href }) =>
	silent(Effect.sync(() => window.location.assign(href))),
)

/**
 * Exchanges the sync token at boot, beside the session check, so the sync sockets need not wait
 * for it once `user.me` answers. A refused exchange is reported by `readAccessToken` itself.
 */
export const WarmAccessToken = Command.make("WarmAccessToken", { args: {} }, () =>
	silent(Effect.tryPromise(readAccessToken)),
)

/** Wakes the objects this load opens, where `index.html` has not (`core/db/warm.ts`). */
export const WarmSyncObjects = Command.make(
	"WarmSyncObjects",
	{ args: { userId: Schema.NullOr(UserId), channelId: Schema.NullOr(ChannelId) } },
	({ userId, channelId }) => silent(warmSyncObjects(userId, channelId)),
)

const checkSession = readSession.pipe(
	Effect.map((auth) => AppMessage.ChangedAuth({ auth })),
	Effect.catchTag("SessionCheckError", ({ reason }) =>
		Effect.succeed(AppMessage.FailedCheckSession({ reason })),
	),
	catchCommon((reason) => AppMessage.FailedCheckSession({ reason })),
)

/** Whether the API has a session for this browser; `delayed`, after the pause the retries wait. */
export class CheckSession extends Command.Service<CheckSession>()("shell/CheckSession", {
	args: { delayed: Schema.Boolean },
	success: AppMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.map(
			Effect.service(HazelAuthClient),
			(client) =>
				({ delayed }) =>
					(delayed
						? Effect.sleep(RETRY_DELAY).pipe(Effect.andThen(checkSession))
						: checkSession
					).pipe(Effect.provideService(HazelAuthClient, client)),
		),
	)
}

export class SignOut extends Command.Service<SignOut>()("shell/SignOut", {
	args: {},
	success: AppMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.map(
			Effect.service(HazelAuthClient),
			(client) => () =>
				signOut.pipe(
					Effect.as(AppMessage.SucceededSignOut()),
					Effect.catchTag("SignOutError", ({ reason }) =>
						Effect.succeed(AppMessage.FailedSignOut({ reason })),
					),
					catchCommon((reason) => AppMessage.FailedSignOut({ reason })),
					Effect.provideService(HazelAuthClient, client),
				),
		),
	)
}

/** A momentary `user.me` failure is retried in place before it is reported. */
const retryBlip = Schedule.exponential("500 millis").pipe(Schedule.jittered)

const fetchCurrentUser = Effect.gen(function* () {
	const client = yield* HazelRpc
	const user = yield* client("user.me", undefined).pipe(
		Effect.retry({ schedule: retryBlip, times: 2, while: isRetryableError }),
	)
	const current: CurrentUser = {
		id: user.id,
		firstName: user.firstName ?? "",
		lastName: user.lastName ?? "",
		email: user.email,
		avatarUrl: user.avatarUrl ?? null,
		isOnboarded: user.isOnboarded,
	}
	// The next load starts as this user; one that started as someone else starts over.
	yield* settleRememberedUser(current)
	return AppMessage.SucceededFetchCurrentUser({ user: current })
}).pipe(catchCommon((reason) => AppMessage.FailedFetchCurrentUser({ reason })))

/** `user.me`; `delayed`, after the pause the retries wait. */
export class FetchCurrentUser extends Command.Service<FetchCurrentUser>()("shell/FetchCurrentUser", {
	args: { delayed: Schema.Boolean },
	success: AppMessage,
}) {
	static readonly layer = this.toLayer(
		Effect.map(
			Effect.service(HazelRpc),
			(rpc) =>
				({ delayed }) =>
					(delayed
						? Effect.sleep(RETRY_DELAY).pipe(Effect.andThen(fetchCurrentUser))
						: fetchCurrentUser
					).pipe(Effect.provideService(HazelRpc, rpc)),
		),
	)
}

/** The Layers the shell's Commands need, on the app's RPC and auth clients. */
export const commandsLayer = Layer.mergeAll(CheckSession.layer, SignOut.layer, FetchCurrentUser.layer)
