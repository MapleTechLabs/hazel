/**
 * The two UUID versions Hazel mints (RFC 9562): v7 for new ids that sort by creation time, v5 for ids
 * derived from a name so client and server compute the same one.
 */

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"))

const format = (bytes: Uint8Array): string => {
	let out = ""
	for (let i = 0; i < 16; i++) {
		if (i === 4 || i === 6 || i === 8 || i === 10) out += "-"
		out += HEX[bytes[i] ?? 0]
	}
	return out
}

const parse = (uuid: string): Uint8Array => {
	const hex = uuid.replace(/-/g, "")
	if (!/^[0-9a-f]{32}$/i.test(hex)) throw new TypeError(`Invalid UUID: ${uuid}`)
	const bytes = new Uint8Array(16)
	for (let i = 0; i < 16; i++) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
	return bytes
}

/** Sets the version nibble and the RFC 4122 variant bits. */
const stamp = (bytes: Uint8Array, version: number): Uint8Array => {
	bytes[6] = ((bytes[6] ?? 0) & 0x0f) | (version << 4)
	bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
	return bytes
}

/** A v7 UUID: the current Unix time in milliseconds, then random bits. */
export const uuidv7 = (nowMs: number = Date.now()): string => {
	const bytes = crypto.getRandomValues(new Uint8Array(16))
	let ms = nowMs
	for (let i = 5; i >= 0; i--) {
		bytes[i] = ms % 256
		ms = Math.floor(ms / 256)
	}
	return format(stamp(bytes, 7))
}

const rotl = (x: number, n: number) => (x << n) | (x >>> (32 - n))

/** SHA-1 of `data`, synchronous so ids can be derived inside pure code. */
const sha1 = (data: Uint8Array): Uint8Array => {
	const bitLength = data.length * 8
	const padded = new Uint8Array((((data.length + 8) >> 6) + 1) * 64)
	padded.set(data)
	padded[data.length] = 0x80
	const view = new DataView(padded.buffer)
	view.setUint32(padded.length - 8, Math.floor(bitLength / 2 ** 32))
	view.setUint32(padded.length - 4, bitLength >>> 0)

	let h0 = 0x67452301
	let h1 = 0xefcdab89
	let h2 = 0x98badcfe
	let h3 = 0x10325476
	let h4 = 0xc3d2e1f0
	const w = new Uint32Array(80)
	for (let offset = 0; offset < padded.length; offset += 64) {
		for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4)
		for (let i = 16; i < 80; i++)
			w[i] = rotl((w[i - 3] ?? 0) ^ (w[i - 8] ?? 0) ^ (w[i - 14] ?? 0) ^ (w[i - 16] ?? 0), 1)
		let a = h0
		let b = h1
		let c = h2
		let d = h3
		let e = h4
		for (let i = 0; i < 80; i++) {
			const [f, k] =
				i < 20
					? [(b & c) | (~b & d), 0x5a827999]
					: i < 40
						? [b ^ c ^ d, 0x6ed9eba1]
						: i < 60
							? [(b & c) | (b & d) | (c & d), 0x8f1bbcdc]
							: [b ^ c ^ d, 0xca62c1d6]
			const temp = (rotl(a, 5) + f + e + k + (w[i] ?? 0)) >>> 0
			e = d
			d = c
			c = rotl(b, 30) >>> 0
			b = a
			a = temp
		}
		h0 = (h0 + a) >>> 0
		h1 = (h1 + b) >>> 0
		h2 = (h2 + c) >>> 0
		h3 = (h3 + d) >>> 0
		h4 = (h4 + e) >>> 0
	}
	const out = new Uint8Array(20)
	const outView = new DataView(out.buffer)
	;[h0, h1, h2, h3, h4].forEach((h, i) => outView.setUint32(i * 4, h))
	return out
}

/** A v5 UUID: the SHA-1 of `namespace` and `name`, the same for the same inputs everywhere. */
export const uuidv5 = (name: string, namespace: string): string => {
	const nameBytes = new TextEncoder().encode(name)
	const input = new Uint8Array(16 + nameBytes.length)
	input.set(parse(namespace))
	input.set(nameBytes, 16)
	return format(stamp(sha1(input).slice(0, 16), 5))
}
