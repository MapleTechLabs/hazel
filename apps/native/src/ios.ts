/**
 * The iOS platform: the runtime runs in a Web Worker inside a hidden `WKWebView` (every web API,
 * WebKit's JIT), and its page relays between the worker and the Rune host (`host/ios`). Protocol
 * messages cross as JSON lines (strings); the platform's own requests as objects.
 */
import type { PrecompiledStyles } from "@hazel/foldkit-rune"
import { parseHostLine } from "@hazel/foldkit-rune"
import type { NativePlatform } from "./platform"

/** What the page set before this worker's source: the host's environment. */
declare const __HAZEL_ENV__: Record<string, string>
/** The stylesheet compiled for every class the app's sources use (`scripts/build-ios.ts`). */
declare const __HAZEL_STYLES__: PrecompiledStyles

/** A request to the host that is not render protocol. */
export type IosRequest = { readonly log: string } | { readonly open: string } | { readonly copy: string }

// Captured before the shims put the window they fake over the worker's globals.
const post = globalThis.postMessage.bind(globalThis)
const request = (message: IosRequest) => post(message)
const early: Array<string> = []
let deliver: ((line: string) => void) | undefined
globalThis.onmessage = (event: MessageEvent<string>) => {
	if (deliver === undefined) early.push(event.data)
	else deliver(event.data)
}

// Bun's, which some of the app's dependencies schedule with.
Object.assign(globalThis, {
	setImmediate: (callback: (...args: Array<unknown>) => void, ...args: Array<unknown>) =>
		setTimeout(callback, 0, ...args),
	clearImmediate: (handle: ReturnType<typeof setTimeout>) => clearTimeout(handle),
})
// The runtime and the web app read their settings from `process.env`, as under Bun.
Object.assign(globalThis, { process: { env: { ...__HAZEL_ENV__ }, platform: "ios" } })
const log = (line: string) => request({ log: line })
for (const name of ["log", "info", "debug", "warn", "error"] as const)
	console[name] = (...parts: Array<unknown>) => log(parts.map(String).join(" "))
/** An error's name, message and stack: WebKit's `stack` holds the frames alone. */
const describe = (error: unknown) =>
	error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ""}` : String(error)
// Handled here, with its stack: the page's `worker.onerror` then hears only load failures.
globalThis.addEventListener("error", (event) => {
	event.preventDefault()
	log(`[uncaught error] ${describe(event.error ?? event.message)}`)
})
globalThis.addEventListener("unhandledrejection", (event) =>
	log(`[uncaught rejection] ${describe(event.reason)}`),
)

const platform: NativePlatform = {
	connect: (onMessage) => {
		// As the Bun platform's transport reads them: a malformed line is reported and skipped.
		deliver = (line) => {
			const parsed = parseHostLine(line)
			if ("message" in parsed) onMessage(parsed.message)
			else log(`[native] bad host line: ${parsed.error}`)
		}
		for (const line of early.splice(0)) deliver(line)
		return {
			send: (message) => {
				const line = JSON.stringify(message)
				post(line)
				return line.length
			},
		}
	},
	log,
	openUrl: (href) => request({ open: href }),
	copyText: (text) => request({ copy: text }),
	// The bundle carries the sheet compiled for every class the app's sources use.
	loadStyles: async () => {
		const { StyleResolver } = await import("@hazel/foldkit-rune")
		return StyleResolver.fromPrecompiled(__HAZEL_STYLES__, "styles.css")
	},
}

const { startRuntime } = await import("./runtime")
await startRuntime(platform)
