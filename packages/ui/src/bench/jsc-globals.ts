/**
 * What a bare JavaScriptCore context lacks: UTF-8 codecs, `queueMicrotask`, `console`, and a
 * macrotask queue (`setImmediate`, `setTimeout`) that Swift drains with `__bench.tick()`, so
 * Effect's scheduler stays in JS (microtasks run when each call into the context returns).
 */
const g = globalThis as Record<string, unknown>

if (g.TextEncoder === undefined) {
	g.TextEncoder = class {
		readonly encoding = "utf-8"
		encode(input = ""): Uint8Array {
			const binary = unescape(encodeURIComponent(input))
			const out = new Uint8Array(binary.length)
			for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
			return out
		}
	}
}

if (g.TextDecoder === undefined) {
	g.TextDecoder = class {
		readonly encoding = "utf-8"
		decode(input?: ArrayBufferView | ArrayBuffer): string {
			if (input === undefined) return ""
			const bytes =
				input instanceof ArrayBuffer
					? new Uint8Array(input)
					: new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
			let binary = ""
			for (const byte of bytes) binary += String.fromCharCode(byte)
			return decodeURIComponent(escape(binary))
		}
	}
}

if (g.queueMicrotask === undefined) {
	g.queueMicrotask = (task: () => void) => {
		Promise.resolve().then(task)
	}
}

if (g.console === undefined) {
	const noop = () => {}
	g.console = { log: noop, info: noop, warn: noop, error: noop, debug: noop }
}

interface Timer {
	readonly id: number
	readonly at: number
	readonly run: () => void
}
const timers: Array<Timer> = []
let nextTimer = 1
const now = 0

const schedule = (run: () => void, ms = 0): number => {
	const id = nextTimer++
	timers.push({ id, at: now + Math.max(0, ms), run })
	return id
}
const cancel = (id: unknown) => {
	const index = timers.findIndex((t) => t.id === id)
	if (index >= 0) timers.splice(index, 1)
}

g.setImmediate = (run: () => void) => schedule(run)
g.clearImmediate = cancel
g.setTimeout = (run: () => void, ms?: number) => schedule(run, ms)
g.clearTimeout = cancel

/**
 * Runs the next due macrotask (delayed ones stay queued: nothing here waits on time). Returns -1 when
 * none was due, so Swift loops until a call runs nothing (microtasks drain as each call returns).
 */
export const tick = (): number => {
	const next = timers.find((t) => t.at <= now)
	if (next === undefined) return -1
	cancel(next.id)
	next.run()
	return timers.filter((t) => t.at <= now).length
}
