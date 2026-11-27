// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * What my settings ask of the platform the app runs in: the desktop app's launch at login and
 * version, and the notification previews. The web app implements them over Tauri and its sound
 * manager (`web-foldkit/src/my-settings/platform.ts`); a platform without them leaves them out.
 */
import { UiSchema } from "@effect/ui"
import { Context, type Effect, Schema } from "effect"

/** Why an update install did not finish (today's `platform/updates.ts`). */
export const InstallFailure = Schema.Literals([
	"NoUpdate",
	"DownloadFailed",
	"InstallFailed",
	"RestartUnavailable",
	"RestartFailed",
])
export type InstallFailure = typeof InstallFailure.Type

/** The desktop app's update check and install, as the app holds it. */
export const DesktopUpdate = UiSchema.TaggedEnum({
	Idle: {},
	Checking: {},
	Available: { version: Schema.String, body: Schema.NullOr(Schema.String) },
	UpToDate: { checkedAtMs: Schema.Finite },
	CheckFailed: {},
	Downloading: { downloadedBytes: Schema.Finite, totalBytes: Schema.NullOr(Schema.Finite) },
	Installing: {},
	Restarting: {},
	InstallFailed: { reason: InstallFailure },
})
export type DesktopUpdate = typeof DesktopUpdate.Type

/** A desktop plugin call (autostart, the app's version) rejected. */
export class DesktopPluginError extends Schema.TaggedError<
	DesktopPluginError,
	{ readonly brand: unique symbol }
>()("DesktopPluginError", {
	cause: Schema.Defect(),
}) {}

export class DesktopApp extends Context.Service<
	DesktopApp,
	{
		readonly isAutostartEnabled: Effect.Effect<boolean, DesktopPluginError>
		readonly setAutostart: (isEnabled: boolean) => Effect.Effect<void, DesktopPluginError>
		/** The installed version, `null` when the app does not say. */
		readonly version: Effect.Effect<string | null, DesktopPluginError>
	}
>()("hazel/my-settings/DesktopApp") {}

/** A sound or notification preview threw (audio playback, the notification plugin). */
export class PreviewError extends Schema.TaggedError<PreviewError, { readonly brand: unique symbol }>()(
	"PreviewError",
	{
		cause: Schema.Defect(),
	},
) {}

export class NotificationPreviews extends Context.Service<
	NotificationPreviews,
	{
		/** Plays the chosen sound once; best effort. */
		readonly testSound: Effect.Effect<void, PreviewError>
		/** Shows a test notification; false where the app has no notifications or permission. */
		readonly testNotification: Effect.Effect<boolean, PreviewError>
	}
>()("hazel/my-settings/NotificationPreviews") {}
