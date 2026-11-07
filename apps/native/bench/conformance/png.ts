/**
 * Minimal dependency-free PNG codec for the conformance diff: decodes 8-bit non-interlaced
 * greyscale, RGB, palette and RGBA images to RGBA, and encodes RGBA.
 */
import { deflateSync, inflateSync } from "node:zlib"

export interface Image {
	readonly width: number
	readonly height: number
	/** RGBA, row-major, 4 bytes per pixel. */
	readonly data: Uint8Array
}

const SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
	let c = n
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
	return c >>> 0
})

const crc32 = (bytes: Uint8Array) => {
	let c = 0xffffffff
	for (const byte of bytes) c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8)
	return (c ^ 0xffffffff) >>> 0
}

const CHANNELS = new Map([
	[0, 1],
	[2, 3],
	[3, 1],
	[4, 2],
	[6, 4],
])

const paeth = (a: number, b: number, c: number) => {
	const p = a + b - c
	const pa = Math.abs(p - a)
	const pb = Math.abs(p - b)
	const pc = Math.abs(p - c)
	return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

export const decodePng = (file: Uint8Array): Image => {
	if (!SIGNATURE.every((byte, i) => file[i] === byte)) throw new Error("not a PNG")
	const view = new DataView(file.buffer, file.byteOffset, file.byteLength)
	let offset = 8
	let width = 0
	let height = 0
	let colorType = 0
	let palette: Uint8Array = new Uint8Array(0)
	let transparency: Uint8Array = new Uint8Array(0)
	const idat: Array<Uint8Array> = []
	while (offset < file.length) {
		const length = view.getUint32(offset)
		const type = String.fromCharCode(...file.subarray(offset + 4, offset + 8))
		const body = file.subarray(offset + 8, offset + 8 + length)
		if (type === "IHDR") {
			width = view.getUint32(offset + 8)
			height = view.getUint32(offset + 12)
			const depth = body[8]
			colorType = body[9] ?? 0
			if (depth !== 8 || body[12] !== 0) throw new Error("only 8-bit non-interlaced PNGs are supported")
		} else if (type === "PLTE") palette = body
		else if (type === "tRNS") transparency = body
		else if (type === "IDAT") idat.push(body)
		else if (type === "IEND") break
		offset += 12 + length
	}
	const channels = CHANNELS.get(colorType)
	if (channels === undefined) throw new Error(`unsupported PNG colour type ${colorType}`)
	const raw = inflateSync(Buffer.concat(idat))
	const stride = width * channels
	const pixels = new Uint8Array(stride * height)
	for (let y = 0; y < height; y++) {
		const filter = raw[y * (stride + 1)]
		const src = y * (stride + 1) + 1
		const row = y * stride
		for (let x = 0; x < stride; x++) {
			const value = raw[src + x] ?? 0
			const left = x >= channels ? (pixels[row + x - channels] ?? 0) : 0
			const up = y > 0 ? (pixels[row - stride + x] ?? 0) : 0
			const upLeft = y > 0 && x >= channels ? (pixels[row - stride + x - channels] ?? 0) : 0
			const predicted =
				filter === 1
					? left
					: filter === 2
						? up
						: filter === 3
							? (left + up) >> 1
							: filter === 4
								? paeth(left, up, upLeft)
								: 0
			pixels[row + x] = (value + predicted) & 0xff
		}
	}
	const data = new Uint8Array(width * height * 4)
	for (let i = 0; i < width * height; i++) {
		const s = i * channels
		const d = i * 4
		const a = pixels[s] ?? 0
		if (colorType === 6) data.set(pixels.subarray(s, s + 4), d)
		else if (colorType === 2) data.set([a, pixels[s + 1] ?? 0, pixels[s + 2] ?? 0, 255], d)
		else if (colorType === 3)
			data.set(
				[
					palette[a * 3] ?? 0,
					palette[a * 3 + 1] ?? 0,
					palette[a * 3 + 2] ?? 0,
					transparency[a] ?? 255,
				],
				d,
			)
		else if (colorType === 4) data.set([a, a, a, pixels[s + 1] ?? 0], d)
		else data.set([a, a, a, 255], d)
	}
	return { width, height, data }
}

const chunk = (type: string, body: Uint8Array) => {
	const out = new Uint8Array(12 + body.length)
	const view = new DataView(out.buffer)
	view.setUint32(0, body.length)
	out.set(Buffer.from(type, "latin1"), 4)
	out.set(body, 8)
	view.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)))
	return out
}

export const encodePng = (image: Image): Uint8Array => {
	const header = new Uint8Array(13)
	const view = new DataView(header.buffer)
	view.setUint32(0, image.width)
	view.setUint32(4, image.height)
	header.set([8, 6, 0, 0, 0], 8)
	const stride = image.width * 4
	const raw = new Uint8Array((stride + 1) * image.height)
	for (let y = 0; y < image.height; y++) {
		raw.set(image.data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1)
	}
	return Buffer.concat([
		SIGNATURE,
		chunk("IHDR", header),
		chunk("IDAT", deflateSync(raw, { level: 6 })),
		chunk("IEND", new Uint8Array(0)),
	])
}

export const blankImage = (
	width: number,
	height: number,
	rgba: readonly [number, number, number, number],
) => {
	const data = new Uint8Array(width * height * 4)
	for (let i = 0; i < width * height; i++) data.set(rgba, i * 4)
	return { width, height, data }
}

/** Copies a region of `src` (clamped to its bounds) into `dst` at (dx, dy). */
export const blit = (
	src: Image,
	dst: Image,
	region: { x: number; y: number; w: number; h: number },
	dx: number,
	dy: number,
) => {
	for (let y = 0; y < region.h; y++) {
		const sy = region.y + y
		const ty = dy + y
		if (sy < 0 || sy >= src.height || ty < 0 || ty >= dst.height) continue
		for (let x = 0; x < region.w; x++) {
			const sx = region.x + x
			const tx = dx + x
			if (sx < 0 || sx >= src.width || tx < 0 || tx >= dst.width) continue
			const s = (sy * src.width + sx) * 4
			dst.data.set(src.data.subarray(s, s + 4), (ty * dst.width + tx) * 4)
		}
	}
}

/** Draws a 2px rectangle outline. */
export const strokeRect = (
	image: Image,
	rect: { x: number; y: number; w: number; h: number },
	rgba: readonly [number, number, number, number],
) => {
	const put = (x: number, y: number) => {
		if (x < 0 || y < 0 || x >= image.width || y >= image.height) return
		image.data.set(rgba, (y * image.width + x) * 4)
	}
	const x0 = Math.round(rect.x)
	const y0 = Math.round(rect.y)
	const x1 = Math.round(rect.x + rect.w) - 1
	const y1 = Math.round(rect.y + rect.h) - 1
	for (let t = 0; t < 2; t++) {
		for (let x = x0; x <= x1; x++) {
			put(x, y0 + t)
			put(x, y1 - t)
		}
		for (let y = y0; y <= y1; y++) {
			put(x0 + t, y)
			put(x1 - t, y)
		}
	}
}
