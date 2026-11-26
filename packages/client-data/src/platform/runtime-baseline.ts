/**
 * The globals every host must have before the package loads: the JS runtime, not the platform.
 * Effect's scheduler and HTTP client, TanStack DB and the sync connection (`setInterval` heartbeat)
 * use them directly. A bare JSContext has none of them: the iOS shell installs the timers, `console`
 * and `performance` (`HazelUI/Runtime/JSEngine.swift`), and `jsc/runtime-shims.ts` the rest.
 */
export const RUNTIME_BASELINE = [
	"setTimeout",
	"clearTimeout",
	"setInterval",
	"clearInterval",
	"queueMicrotask",
	"console",
	"performance",
	"TextEncoder",
	"TextDecoder",
	"URL",
	"URLSearchParams",
	"AbortController",
	"AbortSignal",
] as const
