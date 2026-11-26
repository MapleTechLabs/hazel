/**
 * The `__native` bridge a JavaScriptCore host installs before the package loads
 * (`apps/ios-hybrid/EffectUiSpike/Platform/HazelPlatform.swift`). Calls are synchronous into Swift;
 * Swift answers asynchronous work (sockets, HTTP, connectivity) through the callbacks given here.
 */

/** One socket event: `open` (the selected subprotocol), `message`, `close` (code, reason), `error`. */
export type NativeSocketEvent =
	| { readonly type: "open"; readonly protocol: string }
	| { readonly type: "message"; readonly data: string }
	| { readonly type: "close"; readonly code: number; readonly reason: string }
	| { readonly type: "error"; readonly message: string }

/** A finished HTTP exchange: the body is base64 (bytes cross the bridge as a string). */
export interface NativeHttpResult {
	readonly status: number
	readonly url: string
	readonly headers: Readonly<Record<string, string>>
	readonly bodyBase64: string
}

export interface NativeBridge {
	readonly uuid: () => string
	readonly kv: {
		readonly get: (key: string) => string | null | undefined
		readonly set: (key: string, value: string) => void
		readonly remove: (key: string) => void
	}
	readonly socket: {
		/** Opens a socket; returns its id. `onEvent` is called on the JS thread. */
		readonly open: (url: string, protocols: Array<string>, onEvent: (event: NativeSocketEvent) => void) => number
		readonly send: (id: number, data: string) => void
		readonly close: (id: number, code: number, reason: string) => void
	}
	readonly http: {
		/** Starts a request; `done` gets the result, or an error message. Returns its id. */
		readonly request: (
			method: string,
			url: string,
			headers: Record<string, string>,
			bodyBase64: string | null,
			done: (result: NativeHttpResult | null, error: string | null) => void,
		) => number
		readonly cancel: (id: number) => void
	}
	readonly connectivity: {
		/** Calls `listener` each time the network becomes reachable again; returns an id for `off`. */
		readonly onOnline: (listener: () => void) => number
		readonly off: (id: number) => void
	}
	/** The server and credentials this build talks to. */
	readonly config: { readonly apiUrl: string; readonly token: string | null }
}

declare const __native: NativeBridge | undefined

/** The host's bridge; throws when the context has none (a host that forgot to install it). */
export const nativeBridge = (): NativeBridge => {
	if (typeof __native === "undefined" || __native.socket === undefined)
		throw new Error("@hazel/client-data/jsc: the host installed no __native platform bridge")
	return __native
}
