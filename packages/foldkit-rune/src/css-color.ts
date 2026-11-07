// CSS Color 4/5 to `#rrggbbaa` sRGB: hex, named, rgb/hsl, lab/lch, oklab/oklch, color(),
// color-mix() in any rectangular or polar space, and relative colours (`rgb(from x r g b / 15%)`).
// Out-of-gamut results are clipped per channel, as Chromium paints them.

/** Gamma-encoded sRGB channels in 0..1 (unclipped) plus alpha. */
type Rgba = [number, number, number, number]
type Vec3 = [number, number, number]
type Space =
	| "srgb"
	| "srgb-linear"
	| "display-p3"
	| "hsl"
	| "lab"
	| "lch"
	| "oklab"
	| "oklch"
	| "xyz-d65"
	| "xyz-d50"

const NAMED = new Map([
	["black", "#000000"],
	["white", "#ffffff"],
	["red", "#ff0000"],
	["green", "#008000"],
	["lime", "#00ff00"],
	["blue", "#0000ff"],
	["yellow", "#ffff00"],
	["orange", "#ffa500"],
	["purple", "#800080"],
	["gray", "#808080"],
	["grey", "#808080"],
	["silver", "#c0c0c0"],
	["cyan", "#00ffff"],
	["magenta", "#ff00ff"],
])

const mul = (m: ReadonlyArray<Vec3>, v: Vec3): Vec3 => {
	const [a, b, c] = m
	if (a === undefined || b === undefined || c === undefined) return v
	return [
		a[0] * v[0] + a[1] * v[1] + a[2] * v[2],
		b[0] * v[0] + b[1] * v[1] + b[2] * v[2],
		c[0] * v[0] + c[1] * v[1] + c[2] * v[2],
	]
}

const LIN_TO_XYZ: Array<Vec3> = [
	[0.41239079926595934, 0.357584339383878, 0.1804807884018343],
	[0.21263900587151027, 0.715168678767756, 0.07219231536073371],
	[0.01933081871559182, 0.11919477979462598, 0.9505321522496607],
]
const XYZ_TO_LIN: Array<Vec3> = [
	[3.2409699419045226, -1.537383177570094, -0.4986107602930034],
	[-0.9692436362808796, 1.8759675015077202, 0.04155505740717559],
	[0.05563007969699366, -0.20397695888897652, 1.0569715142428786],
]
const D65_TO_D50: Array<Vec3> = [
	[1.0479298208405488, 0.022946793341019088, -0.05019222954313557],
	[0.029627815688159344, 0.990434484573249, -0.01707382502938514],
	[-0.009243058152591178, 0.015055144896577895, 0.7518742899580008],
]
const D50_TO_D65: Array<Vec3> = [
	[0.9554734527042182, -0.023098536874261423, 0.0632593086610217],
	[-0.028369706963208136, 1.0099954580058226, 0.021041398966943008],
	[0.012314001688319899, -0.020507696433477912, 1.3303659366080753],
]
const P3_TO_XYZ: Array<Vec3> = [
	[0.4865709486482162, 0.26566769316909306, 0.1982172852343625],
	[0.2289745640697488, 0.6917385218365064, 0.079286914093745],
	[0, 0.04511338185890264, 1.043944368900976],
]
const XYZ_TO_P3: Array<Vec3> = [
	[2.493496911941425, -0.9313836179191239, -0.40271078445071684],
	[-0.8294889695615747, 1.7626640603183463, 0.023624685841943577],
	[0.03584583024378447, -0.07617238926804182, 0.9568845240076872],
]
const D50_WHITE: Vec3 = [0.3457 / 0.3585, 1, (1 - 0.3457 - 0.3585) / 0.3585]
const KAPPA = 24389 / 27
const EPSILON = 216 / 24389

const toLinear = (x: number) => {
	const s = Math.sign(x) || 1
	const a = Math.abs(x)
	return a <= 0.04045 ? x / 12.92 : s * ((a + 0.055) / 1.055) ** 2.4
}
const toGamma = (x: number) => {
	const s = Math.sign(x) || 1
	const a = Math.abs(x)
	return a <= 0.0031308 ? 12.92 * x : s * (1.055 * a ** (1 / 2.4) - 0.055)
}
const lin = (v: Vec3): Vec3 => [toLinear(v[0]), toLinear(v[1]), toLinear(v[2])]
const gam = (v: Vec3): Vec3 => [toGamma(v[0]), toGamma(v[1]), toGamma(v[2])]

const xyzToLab = (xyz: Vec3): Vec3 => {
	const f = xyz.map((v, i) => {
		const x = v / (D50_WHITE[i] ?? 1)
		return x > EPSILON ? Math.cbrt(x) : (KAPPA * x + 16) / 116
	})
	const [f0 = 0, f1 = 0, f2 = 0] = f
	return [116 * f1 - 16, 500 * (f0 - f1), 200 * (f1 - f2)]
}
const labToXyz = ([L, a, b]: Vec3): Vec3 => {
	const f1 = (L + 16) / 116
	const f0 = a / 500 + f1
	const f2 = f1 - b / 200
	const x = f0 ** 3 > EPSILON ? f0 ** 3 : (116 * f0 - 16) / KAPPA
	const y = L > KAPPA * EPSILON ? ((L + 16) / 116) ** 3 : L / KAPPA
	const z = f2 ** 3 > EPSILON ? f2 ** 3 : (116 * f2 - 16) / KAPPA
	return [x * D50_WHITE[0], y * D50_WHITE[1], z * D50_WHITE[2]]
}
const linToOklab = ([r, g, b]: Vec3): Vec3 => {
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
	const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
	const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
	return [
		0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
		1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
		0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
	]
}
const oklabToLin = ([L, a, b]: Vec3): Vec3 => {
	const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
	const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
	const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
	return [
		4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
		-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
		-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
	]
}
const toPolar = ([L, a, b]: Vec3): Vec3 => {
	const c = Math.hypot(a, b)
	const h = c < 1e-6 ? Number.NaN : ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360
	return [L, c, h]
}
const fromPolar = ([L, c, h]: Vec3): Vec3 => {
	const r = ((Number.isNaN(h) ? 0 : h) * Math.PI) / 180
	return [L, c * Math.cos(r), c * Math.sin(r)]
}
const hslToRgb = ([h, s, l]: Vec3): Vec3 => {
	const hue = Number.isNaN(h) ? 0 : h
	const f = (n: number) => {
		const k = (n + hue / 30) % 12
		const a = s * Math.min(l, 1 - l)
		return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
	}
	return [f(0), f(8), f(4)]
}
const rgbToHsl = ([r, g, b]: Vec3): Vec3 => {
	const max = Math.max(r, g, b)
	const min = Math.min(r, g, b)
	const l = (max + min) / 2
	const d = max - min
	if (d === 0) return [Number.NaN, 0, l]
	const s = l === 0 || l === 1 ? 0 : (max - l) / Math.min(l, 1 - l)
	const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
	return [h * 60, s, l]
}

/** sRGB (gamma) to a space's own coordinates, hue in degrees, NaN for a powerless hue. */
const fromSrgb = (rgb: Vec3, space: Space): Vec3 => {
	switch (space) {
		case "srgb":
			return rgb
		case "srgb-linear":
			return lin(rgb)
		case "hsl":
			return rgbToHsl(rgb)
		case "display-p3":
			return gam(mul(XYZ_TO_P3, mul(LIN_TO_XYZ, lin(rgb))))
		case "xyz-d65":
			return mul(LIN_TO_XYZ, lin(rgb))
		case "xyz-d50":
			return mul(D65_TO_D50, mul(LIN_TO_XYZ, lin(rgb)))
		case "lab":
			return xyzToLab(mul(D65_TO_D50, mul(LIN_TO_XYZ, lin(rgb))))
		case "lch":
			return toPolar(xyzToLab(mul(D65_TO_D50, mul(LIN_TO_XYZ, lin(rgb)))))
		case "oklab":
			return linToOklab(lin(rgb))
		case "oklch":
			return toPolar(linToOklab(lin(rgb)))
	}
}

const toSrgb = (v: Vec3, space: Space): Vec3 => {
	switch (space) {
		case "srgb":
			return v
		case "srgb-linear":
			return gam(v)
		case "hsl":
			return hslToRgb(v)
		case "display-p3":
			return gam(mul(XYZ_TO_LIN, mul(P3_TO_XYZ, lin(v))))
		case "xyz-d65":
			return gam(mul(XYZ_TO_LIN, v))
		case "xyz-d50":
			return gam(mul(XYZ_TO_LIN, mul(D50_TO_D65, v)))
		case "lab":
			return gam(mul(XYZ_TO_LIN, mul(D50_TO_D65, labToXyz(v))))
		case "lch":
			return gam(mul(XYZ_TO_LIN, mul(D50_TO_D65, labToXyz(fromPolar(v)))))
		case "oklab":
			return gam(oklabToLin(v))
		case "oklch":
			return gam(oklabToLin(fromPolar(v)))
	}
}

const POLAR = new Set<Space>(["hsl", "lch", "oklch"])
const hueIndex = (space: Space) => (space === "hsl" ? 0 : 2)

/** Splits on `sep` outside parentheses. */
const splitTop = (text: string, sep: RegExp): Array<string> => {
	const out: Array<string> = []
	let depth = 0
	let start = 0
	for (let i = 0; i < text.length; i++) {
		const ch = text[i] ?? ""
		if (ch === "(") depth++
		else if (ch === ")") depth--
		else if (depth === 0 && sep.test(ch)) {
			out.push(text.slice(start, i))
			start = i + 1
		}
	}
	out.push(text.slice(start))
	return out.map((s) => s.trim()).filter((s) => s !== "")
}

/** A number, percentage (scaled to `pctScale` at 100%), angle or `none`. */
const component = (token: string, pctScale: number, vars: ReadonlyMap<string, number>): number | null => {
	const t = token.trim()
	if (t === "none") return 0
	const known = vars.get(t)
	if (known !== undefined) return known
	if (t.startsWith("calc(")) return calcWith(t.slice(5, -1), vars)
	const m = /^(-?[\d.]+(?:e-?\d+)?)(%|deg|rad|grad|turn)?$/.exec(t)
	if (!m) return null
	const n = Number(m[1])
	switch (m[2]) {
		case "%":
			return (n / 100) * pctScale
		case "rad":
			return (n * 180) / Math.PI
		case "grad":
			return n * 0.9
		case "turn":
			return n * 360
		default:
			return n
	}
}

/** `calc()` over numbers and relative-colour channel keywords. */
const calcWith = (expr: string, vars: ReadonlyMap<string, number>): number | null => {
	const replaced = expr.replace(/[a-z]+/g, (word) => String(vars.get(word) ?? Number.NaN))
	if (!/^[\d.\s+\-*/()eNa]+$/.test(replaced)) return null
	const tokens = replaced.match(/NaN|\d*\.?\d+(?:e-?\d+)?|[+\-*/()]/g) ?? []
	let i = 0
	const atom = (): number => {
		const t = tokens[i++]
		if (t === "(") {
			const v = sum()
			i++
			return v
		}
		if (t === "-") return -atom()
		return Number(t)
	}
	const product = (): number => {
		let v = atom()
		while (tokens[i] === "*" || tokens[i] === "/") v = tokens[i++] === "*" ? v * atom() : v / atom()
		return v
	}
	const sum = (): number => {
		let v = product()
		while (tokens[i] === "+" || tokens[i] === "-") v = tokens[i++] === "+" ? v + product() : v - product()
		return v
	}
	const v = sum()
	return Number.isFinite(v) ? v : null
}

/** Each function's space, channel keywords and the value 100% means per channel. */
type FunctionSpec = { space: Space; names: [string, string, string]; pct: Vec3 }
const FUNCTIONS = new Map<string, FunctionSpec>([
	["rgb", { space: "srgb", names: ["r", "g", "b"], pct: [255, 255, 255] }],
	["rgba", { space: "srgb", names: ["r", "g", "b"], pct: [255, 255, 255] }],
	["hsl", { space: "hsl", names: ["h", "s", "l"], pct: [1, 100, 100] }],
	["hsla", { space: "hsl", names: ["h", "s", "l"], pct: [1, 100, 100] }],
	["lab", { space: "lab", names: ["l", "a", "b"], pct: [100, 125, 125] }],
	["lch", { space: "lch", names: ["l", "c", "h"], pct: [100, 150, 1] }],
	["oklab", { space: "oklab", names: ["l", "a", "b"], pct: [1, 0.4, 0.4] }],
	["oklch", { space: "oklch", names: ["l", "c", "h"], pct: [1, 0.4, 1] }],
])

/** A function's channels in its CSS units to the space's coordinates (rgb 0..255 to 0..1, hsl % to 0..1). */
const unitsToCoords = (fn: string, v: Vec3): Vec3 => {
	if (fn.startsWith("rgb")) return [v[0] / 255, v[1] / 255, v[2] / 255]
	if (fn.startsWith("hsl")) return [v[0], v[1] / 100, v[2] / 100]
	return v
}
const coordsToUnits = (fn: string, v: Vec3): Vec3 => {
	if (fn.startsWith("rgb")) return [v[0] * 255, v[1] * 255, v[2] * 255]
	if (fn.startsWith("hsl")) return [v[0], v[1] * 100, v[2] * 100]
	return v
}

const parseFunction = (fn: string, body: string, current: Rgba | null): Rgba | null => {
	if (fn === "color-mix") return parseMix(body, current)
	if (fn === "color") return parseColorFn(body)
	const spec = FUNCTIONS.get(fn)
	if (spec === undefined) return null
	let rest = body.trim()
	let origin: Rgba | null = null
	const vars = new Map<string, number>()
	if (rest.startsWith("from ")) {
		const parts = splitTop(rest.slice(5), /\s/)
		origin = parseRgba(parts[0] ?? "", current)
		if (origin === null) return null
		const units = coordsToUnits(fn, fromSrgb([origin[0], origin[1], origin[2]], spec.space))
		spec.names.forEach((name, i) => vars.set(name, Number.isNaN(units[i] ?? 0) ? 0 : (units[i] ?? 0)))
		vars.set("alpha", origin[3])
		rest = parts.slice(1).join(" ")
	}
	const [main = "", alphaText] = splitTop(rest, /\//)
	const parts = splitTop(main, /[\s,]/)
	const alphaToken = alphaText ?? (parts.length === 4 ? parts[3] : undefined)
	const values = [0, 1, 2].map((i) => component(parts[i] ?? "", spec.pct[i] ?? 1, vars))
	const [a, b, c] = values
	if (a === null || b === null || c === null || a === undefined || b === undefined || c === undefined)
		return null
	const alpha = alphaToken === undefined ? (origin?.[3] ?? 1) : component(alphaToken, 1, vars)
	if (alpha === null) return null
	const hueNaN = (parts[spec.names.indexOf("h")] ?? "") === "none"
	const coords = unitsToCoords(fn, [a, b, c])
	if (hueNaN) coords[hueIndex(spec.space)] = Number.NaN
	const rgb = toSrgb(coords, spec.space)
	return [rgb[0], rgb[1], rgb[2], Math.min(1, Math.max(0, alpha))]
}

const COLOR_SPACES = new Map<string, Space>([
	["srgb", "srgb"],
	["srgb-linear", "srgb-linear"],
	["display-p3", "display-p3"],
	["xyz", "xyz-d65"],
	["xyz-d65", "xyz-d65"],
	["xyz-d50", "xyz-d50"],
])

const parseColorFn = (body: string): Rgba | null => {
	const [main = "", alphaText] = splitTop(body, /\//)
	const parts = splitTop(main, /\s/)
	const space = COLOR_SPACES.get(parts[0] ?? "")
	if (space === undefined) return null
	const values = [1, 2, 3].map((i) => component(parts[i] ?? "0", 1, new Map()))
	const alpha = alphaText === undefined ? 1 : component(alphaText, 1, new Map())
	const [a, b, c] = values
	if (
		a === null ||
		b === null ||
		c === null ||
		a === undefined ||
		b === undefined ||
		c === undefined ||
		alpha === null
	)
		return null
	const rgb = toSrgb([a, b, c], space)
	return [rgb[0], rgb[1], rgb[2], alpha]
}

const MIX_SPACES = new Map<string, Space>([
	...COLOR_SPACES,
	["hsl", "hsl"],
	["lab", "lab"],
	["lch", "lch"],
	["oklab", "oklab"],
	["oklch", "oklch"],
])

const parseMix = (body: string, current: Rgba | null): Rgba | null => {
	const [method = "", first = "", second = ""] = splitTop(body, /,/)
	const sm = /^in\s+([a-z0-9-]+)(?:\s+(shorter|longer|increasing|decreasing)\s+hue)?$/.exec(method.trim())
	const space = MIX_SPACES.get(sm?.[1] ?? "")
	if (space === undefined) return null
	const side = (text: string) => {
		const m = /^(.*?)\s+(-?[\d.]+)%$/.exec(text) ?? /^(-?[\d.]+)%\s+(.*)$/.exec(text)
		if (m === null) return { c: parseRgba(text, current), p: null as number | null }
		const pctFirst = /^-?[\d.]+%/.test(text)
		return { c: parseRgba((pctFirst ? m[2] : m[1]) ?? "", current), p: Number(pctFirst ? m[1] : m[2]) }
	}
	const a = side(first)
	const b = side(second)
	if (a.c === null || b.c === null) return null
	let pa = a.p ?? (b.p === null ? 50 : 100 - b.p)
	let pb = b.p ?? 100 - pa
	const total = pa + pb
	if (total <= 0) return null
	const scale = total < 100 ? total / 100 : 1
	pa /= total
	pb /= total
	const ca = fromSrgb([a.c[0], a.c[1], a.c[2]], space)
	const cb = fromSrgb([b.c[0], b.c[1], b.c[2]], space)
	const alpha = a.c[3] * pa + b.c[3] * pb
	const out: Array<number> = [0, 0, 0]
	const hue = POLAR.has(space) ? hueIndex(space) : -1
	for (let i = 0; i < 3; i++) {
		let x = ca[i] ?? 0
		let y = cb[i] ?? 0
		if (i === hue) {
			// A powerless (or transparent) side takes the other's hue; then the shorter arc.
			if (Number.isNaN(x) || a.c[3] === 0) x = y
			if (Number.isNaN(y) || b.c[3] === 0) y = x
			if (Number.isNaN(x)) {
				out[i] = Number.NaN
				continue
			}
			if (y - x > 180) x += 360
			else if (x - y > 180) y += 360
			out[i] = (x * pa + y * pb) % 360
			continue
		}
		out[i] = alpha === 0 ? 0 : (x * a.c[3] * pa + y * b.c[3] * pb) / alpha
	}
	const rgb = toSrgb([out[0] ?? 0, out[1] ?? 0, out[2] ?? 0], space)
	return [rgb[0], rgb[1], rgb[2], alpha * scale]
}

/** A colour value to unclipped sRGB + alpha; `current` stands in for `currentColor`. */
const parseRgba = (value: string, current: Rgba | null): Rgba | null => {
	const t = value.trim().toLowerCase()
	if (t === "transparent") return [0, 0, 0, 0]
	if (t === "currentcolor") return current
	const named = NAMED.get(t)
	if (named !== undefined) return parseRgba(named, current)
	if (t.startsWith("#")) {
		const h = t.slice(1)
		if (!/^[0-9a-f]+$/.test(h) || ![3, 4, 6, 8].includes(h.length)) return null
		const full = h.length <= 4 ? [...h].map((c) => c + c).join("") : h
		const ch = (i: number) => parseInt(full.slice(i, i + 2), 16) / 255
		return [ch(0), ch(2), ch(4), full.length === 8 ? ch(6) : 1]
	}
	const fn = /^([a-z-]+)\(([\s\S]*)\)$/.exec(t)
	if (fn === null) return null
	return parseFunction(fn[1] ?? "", fn[2] ?? "", current)
}

const hex2 = (x: number): string =>
	Math.round(Math.min(1, Math.max(0, x)) * 255)
		.toString(16)
		.padStart(2, "0")

/** CSS colour to `#rrggbbaa` (sRGB, clipped), or null when unknown or `currentColor` without `current`. */
export function color(value: string, current?: string): string | null {
	const cur = current === undefined ? null : parseRgba(current, null)
	const rgba = parseRgba(value, cur)
	if (rgba === null) return null
	return `#${hex2(rgba[0])}${hex2(rgba[1])}${hex2(rgba[2])}${hex2(rgba[3])}`
}
