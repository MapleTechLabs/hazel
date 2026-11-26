/**
 * The globals every host must have before the package loads: the JS runtime, not the platform.
 * Effect's scheduler, TanStack DB and the sync connection (`setInterval` heartbeat) use them
 * directly. A bare JSContext has none of them; the iOS runtime installs them first.
 */
export const RUNTIME_BASELINE = [
	"setTimeout",
	"clearTimeout",
	"setInterval",
	"clearInterval",
	"queueMicrotask",
	"console",
] as const
