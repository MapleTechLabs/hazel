/**
 * The web's my-settings platform (lane PS6): the Tauri app's autostart and version, and the
 * notification previews over the app's sound manager and native notifications.
 */
import {
	DesktopApp,
	DesktopPluginError,
	NotificationPreviews,
	PreviewError,
} from "@hazel/shared-screens/my-settings/platform"
import { Effect, Layer } from "effect"
import { testNativeNotification } from "~/lib/native-notifications"
import { notificationSoundManager } from "~/lib/notification-sound-manager"
import { disableAutostart, enableAutostart, isAutostartEnabled } from "../platform/autostart"
import { getTauriApp } from "../platform/tauri"

const plugin = <A>(run: () => Promise<A>) =>
	Effect.tryPromise({ try: run, catch: (cause) => new DesktopPluginError({ cause }) })

const preview = <A>(run: () => Promise<A>) =>
	Effect.tryPromise({ try: run, catch: (cause) => new PreviewError({ cause }) })

export const desktopAppLayer = Layer.succeed(DesktopApp, {
	isAutostartEnabled: plugin(isAutostartEnabled),
	setAutostart: (isEnabled) => Effect.asVoid(plugin(isEnabled ? enableAutostart : disableAutostart)),
	version: plugin(async () => (await getTauriApp()?.getVersion()) ?? null),
})

export const notificationPreviewsLayer = Layer.succeed(NotificationPreviews, {
	testSound: Effect.asVoid(preview(() => notificationSoundManager.testSound())),
	testNotification: preview(testNativeNotification),
})
