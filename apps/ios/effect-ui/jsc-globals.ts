/**
 * What a bare JavaScriptCore context lacks that Effect reads at load: UTF-8 `TextEncoder` /
 * `TextDecoder` and `queueMicrotask`. Timers and `console` come from the shell (`EffectUiRuntime.swift`).
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
