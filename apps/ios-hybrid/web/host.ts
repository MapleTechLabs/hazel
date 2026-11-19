/**
 * The desktop host APIs the app's sign-in uses (`web-foldkit/src/platform/desktop-auth.ts`), on
 * `window.__TAURI__` as the Tauri app has them, answered by the shell (`HostBridge.swift`):
 * `core.invoke` for the keychain vault and the auth API's requests, `opener` for the system's
 * sign-in sheet, `deepLink` for the callback it hands back. Only these: a feature checks for the
 * API it uses, so everything else stays off as in a browser.
 */

import type { HostAnswer, HostRequest } from "./bridge"

/** Asks the shell; a failed command rejects with its error. */
const ask = async (body: HostRequest): Promise<HostAnswer["value"]> => {
	const host = window.webkit?.messageHandlers?.host
	if (host === undefined) throw new Error("no host")
	const answer = await host.postMessage(body)
	if (answer.error !== undefined) throw new Error(answer.error)
	return answer.value ?? null
}

export const installHost = () => {
	const listeners = new Set<(urls: Array<string>) => void>()
	Object.assign(window, {
		/** The shell hands a callback URL (the sign-in sheet's) to the page. */
		__hazelOpenUrl: (url: string) => {
			for (const listener of listeners) listener([url])
		},
	})
	const tauri = {
		core: {
			invoke: (command: string, args?: Record<string, unknown>) => ask({ command, args: args ?? {} }),
		},
		deepLink: {
			onOpenUrl: async (listener: (urls: Array<string>) => void) => {
				listeners.add(listener)
				return () => listeners.delete(listener)
			},
			getCurrent: async () => null,
		},
		opener: {
			openUrl: (url: string) => ask({ command: "open_url", args: { url } }).then(() => undefined),
		},
	}
	Object.assign(window, { __TAURI__: tauri })
}
