import { Effect } from "effect"

/**
 * This device's push registration, where the app runs in a shell that has one: the iOS app
 * (`apps/native/src/push.ts`) registers its APNs token with the API itself, and installs this on
 * the global object before the app starts, as it installs `system-ui.ts`'s controls. Sign-out
 * forgets the device first, while the session can still say whose it is. A browser has none.
 */
export type PushDevice = Readonly<{
	/** Forgets this device's token on the API (`pushDevice.unregister`); never rejects. */
	unregister: () => Promise<void>
}>

/** The global a shell installs its push registration as. */
export const PUSH_DEVICE_GLOBAL = "__HAZEL_PUSH_DEVICE__"

type PushDeviceGlobal = typeof globalThis & { [PUSH_DEVICE_GLOBAL]?: PushDevice }

/** How long sign-out waits for the API to forget the device. */
const UNREGISTER_TIMEOUT = "3 seconds"

/** Forgets this device's push token before signing out; a browser, or a failure, does nothing. */
export const unregisterPushDevice: Effect.Effect<void> = Effect.suspend(() => {
	const device = (globalThis as PushDeviceGlobal)[PUSH_DEVICE_GLOBAL]
	if (device === undefined) return Effect.void
	return Effect.tryPromise(() => device.unregister()).pipe(
		Effect.timeout(UNREGISTER_TIMEOUT),
		Effect.ignore,
	)
})
