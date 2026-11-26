/**
 * Resolves CSS colour literals and the schema's `mix` / `alpha` expressions to sRGB for Swift,
 * following CSS Color 4 and 5: `color-mix(in oklab, ...)` interpolates premultiplied in Oklab.
 */

/** Extended sRGB, gamma encoded, components unclamped (a wide-gamut colour leaves 0...1). */
export interface Rgba {
	readonly r: number
	readonly g: number
	readonly b: number
	readonly a: number
}

interface Oklab {
	readonly l: number
	readonly a: number
	readonly b: number
	readonly alpha: number
}

const encode = (c: number) => {
	const sign = c < 0 ? -1 : 1
	const v = Math.abs(c)
	return sign * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)
}

const decode = (c: number) => {
	const sign = c < 0 ? -1 : 1
	const v = Math.abs(c)
	return sign * (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
}

const oklabToRgba = ({ l, a, b, alpha }: Oklab): Rgba => {
	const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
	const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
	const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
	return {
		r: encode(4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_),
		g: encode(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_),
		b: encode(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_),
		a: alpha,
	}
}

const rgbaToOklab = ({ r, g, b, a }: Rgba): Oklab => {
	const lr = decode(r)
	const lg = decode(g)
	const lb = decode(b)
	const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
	const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
	const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
	return {
		l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
		a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
		b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
		alpha: a,
	}
}

const number = (token: string, percentOf = 1): number =>
	token === "none" ? 0 : token.endsWith("%") ? (Number.parseFloat(token) / 100) * percentOf : Number(token)

/** `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb(r g b / a)`, `oklch(l c h / a)`, `oklab(l a b / a)`. */
export const parseColor = (css: string): Rgba => {
	const text = css.trim()
	if (text.startsWith("#")) {
		const hex = text.slice(1)
		const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex
		const at = (i: number) => Number.parseInt(full.slice(i, i + 2), 16) / 255
		return { r: at(0), g: at(2), b: at(4), a: full.length === 8 ? at(6) : 1 }
	}
	const match = /^(rgb|oklch|oklab)\(([^)]*)\)$/.exec(text)
	if (match === null) throw new Error(`Unsupported colour literal: ${css}`)
	const [channels, alphaPart] = (match[2] ?? "").split("/")
	const parts = (channels ?? "").trim().split(/[\s,]+/)
	const alpha = alphaPart === undefined ? 1 : number(alphaPart.trim())
	const [x = "0", y = "0", z = "0"] = parts
	if (match[1] === "rgb")
		return { r: number(x, 255) / 255, g: number(y, 255) / 255, b: number(z, 255) / 255, a: alpha }
	if (match[1] === "oklab")
		return oklabToRgba({ l: number(x), a: number(y, 0.4), b: number(z, 0.4), alpha })
	const hue = (number(z) * Math.PI) / 180
	const chroma = number(y, 0.4)
	return oklabToRgba({ l: number(x), a: chroma * Math.cos(hue), b: chroma * Math.sin(hue), alpha })
}

/** `color-mix(in oklab, a p%, b)`: premultiplied interpolation, then un-premultiplied. */
export const mixOklab = (first: Rgba, percent: number, second: Rgba): Rgba => {
	const p = percent / 100
	const x = rgbaToOklab(first)
	const y = rgbaToOklab(second)
	const alpha = x.alpha * p + y.alpha * (1 - p)
	if (alpha === 0) return { r: 0, g: 0, b: 0, a: 0 }
	const channel = (u: number, v: number) => (u * x.alpha * p + v * y.alpha * (1 - p)) / alpha
	return oklabToRgba({ l: channel(x.l, y.l), a: channel(x.a, y.a), b: channel(x.b, y.b), alpha })
}

export const transparent: Rgba = { r: 0, g: 0, b: 0, a: 0 }

/** `#rrggbbaa` of the colour clamped to sRGB, for comments and tests. */
export const toHex = ({ r, g, b, a }: Rgba): string =>
	`#${[r, g, b, a]
		.map((c) =>
			Math.round(Math.min(1, Math.max(0, c)) * 255)
				.toString(16)
				.padStart(2, "0"),
		)
		.join("")}`
