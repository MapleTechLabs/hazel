/** Base64 for bytes crossing the `__native` bridge (a bare JSContext has no `btoa` / `atob`). */
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
const LOOKUP = new Map([...ALPHABET].map((char, index) => [char, index]))

export const encodeBase64 = (bytes: Uint8Array): string => {
	let out = ""
	for (let i = 0; i < bytes.length; i += 3) {
		const a = bytes[i] ?? 0
		const b = bytes[i + 1]
		const c = bytes[i + 2]
		const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0)
		out += ALPHABET.charAt((n >> 18) & 63) + ALPHABET.charAt((n >> 12) & 63)
		out += b === undefined ? "=" : ALPHABET.charAt((n >> 6) & 63)
		out += c === undefined ? "=" : ALPHABET.charAt(n & 63)
	}
	return out
}

export const decodeBase64 = (text: string): Uint8Array => {
	const clean = text.replace(/[^A-Za-z0-9+/]/g, "")
	const out = new Uint8Array(Math.floor((clean.length * 3) / 4))
	let length = 0
	for (let i = 0; i < clean.length; i += 4) {
		const n =
			((LOOKUP.get(clean.charAt(i)) ?? 0) << 18) |
			((LOOKUP.get(clean[i + 1] ?? "A") ?? 0) << 12) |
			((LOOKUP.get(clean[i + 2] ?? "A") ?? 0) << 6) |
			(LOOKUP.get(clean[i + 3] ?? "A") ?? 0)
		out[length++] = (n >> 16) & 255
		if (i + 2 < clean.length) out[length++] = (n >> 8) & 255
		if (i + 3 < clean.length) out[length++] = n & 255
	}
	return out.subarray(0, length)
}
