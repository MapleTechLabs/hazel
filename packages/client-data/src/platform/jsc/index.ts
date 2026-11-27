/**
 * The platform services in a bare JavaScriptCore context, each a thin call into the host's Swift
 * (`__native`, `./bridge.ts`; `HazelUI/Runtime/NativePlatform.swift`). Run `installRuntimeShims`
 * before the package loads.
 */
import { Layer } from "effect"
import { ClientDataConfig, Connectivity, Ids, KeyValue, Sockets } from "../services"
import { nativeBridge } from "./bridge"
import { HttpClientJsc } from "./http-client"
import { LocalCacheJsc } from "./local-cache"
import { SessionJsc } from "./session"
import { NativeWebSocket } from "./sockets"

export type { NativeBridge, NativeFile, NativeHttpEvent, NativeSocketEvent } from "./bridge"
export { HttpClientJsc, makeNativeHttpClient, nativeHttpClient } from "./http-client"
export { LocalCacheJsc, makeNativeLocalCache, makeSqliteHost } from "./local-cache"
export { installRuntimeShims } from "./runtime-shims"
export { makeNativeSession, NativeSessionControls, onSessionRejected, SessionJsc } from "./session"
export { makeNativeWebSocket, NativeWebSocket } from "./sockets"
export { ClipboardJsc, makeFilesJsc } from "./ui-services"

/** `UUID()`. */
export const IdsJsc = Layer.sync(Ids, () => {
	const native = nativeBridge()
	return { randomUUID: () => native.uuid() }
})

/** `UserDefaults`. */
export const KeyValueJsc = Layer.sync(KeyValue, () => {
	const { kv } = nativeBridge()
	return {
		get: (key) => kv.get(key) ?? null,
		set: (key, value) => kv.set(key, value),
		remove: (key) => kv.remove(key),
	}
})

/** `URLSessionWebSocketTask`. */
export const SocketsJsc = Layer.succeed(Sockets, { WebSocket: NativeWebSocket })

/** `NWPathMonitor`: calls back when the path becomes satisfied again. */
export const ConnectivityJsc = Layer.sync(Connectivity, () => {
	const { connectivity } = nativeBridge()
	return {
		subscribeOnline: (listener) => {
			const id = connectivity.onOnline(listener)
			return () => connectivity.off(id)
		},
	}
})

/** The server the shell chose. */
export const ClientDataConfigJsc = Layer.sync(ClientDataConfig, () => ({
	apiUrl: nativeBridge().config.apiUrl,
	isRetryableError: () => false,
}))

/** Every data-layer service, Swift-backed. The UI services take a target: `makeFilesJsc`, `ClipboardJsc`. */
export const PlatformJsc = Layer.mergeAll(
	SessionJsc.pipe(Layer.provide(Layer.merge(HttpClientJsc, ClientDataConfigJsc))),
	IdsJsc,
	KeyValueJsc,
	SocketsJsc,
	ConnectivityJsc,
	LocalCacheJsc,
	ClientDataConfigJsc,
	HttpClientJsc,
)
