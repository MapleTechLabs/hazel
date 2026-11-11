/**
 * Chart math, pure and unit-tested: linear scales, nice ticks, x positions, SVG paths, stacking.
 *
 * The charts draw in a percent space: an SVG `viewBox="0 0 100 100"` stretched over its box
 * (`preserveAspectRatio="none"`, strokes `vector-effect: non-scaling-stroke`), with dots, labels and
 * tooltips as HTML placed at the same percentages. So a chart fills any container width without
 * measuring it.
 */

export type Point = readonly [x: number, y: number]

/** Maps `domain` onto `range` linearly; a zero-width domain maps everything to the range's start. */
export const scaleLinear =
	(domain: readonly [number, number], range: readonly [number, number]) =>
	(value: number): number => {
		const [d0, d1] = domain
		const [r0, r1] = range
		return d1 === d0 ? r0 : r0 + ((value - d0) / (d1 - d0)) * (r1 - r0)
	}

/** The "nice" step (1, 2, 2.5 or 5 × 10ⁿ) that splits `span` into about `count` parts. */
export const niceStep = (span: number, count: number): number => {
	if (span <= 0 || count <= 0) return 1
	const raw = span / count
	const magnitude = 10 ** Math.floor(Math.log10(raw))
	const residual = raw / magnitude
	const nice = residual <= 1 ? 1 : residual <= 2 ? 2 : residual <= 2.5 ? 2.5 : residual <= 5 ? 5 : 10
	return nice * magnitude
}

/**
 * A domain covering `[min, max]` widened to whole steps, with its ticks. Always includes 0 for data
 * that crosses or touches it; an all-zero (or empty) range gets `[0, 1]`.
 */
export const niceTicks = (
	min: number,
	max: number,
	count = 4,
): Readonly<{ min: number; max: number; ticks: ReadonlyArray<number> }> => {
	const lo = Math.min(min, 0)
	const hi = Math.max(max, 0)
	if (lo === hi) return { min: 0, max: 1, ticks: [0, 1] }
	const step = niceStep(hi - lo, count)
	const niceMin = Math.floor(lo / step) * step
	const niceMax = Math.ceil(hi / step) * step
	const ticks: Array<number> = []
	// Integer steps, so float drift never adds or drops a tick.
	const steps = Math.round((niceMax - niceMin) / step)
	for (let index = 0; index <= steps; index++) ticks.push(roundTo(niceMin + index * step, step))
	return { min: niceMin, max: niceMax, ticks }
}

/** Rounds away float noise at the step's precision (0.1 + 0.2 → 0.3). */
const roundTo = (value: number, step: number): number => {
	const decimals = Math.max(0, -Math.floor(Math.log10(step)) + 2)
	return Number(value.toFixed(decimals))
}

/** `[min, max]` of the values (`[0, 0]` when empty). */
export const extent = (values: ReadonlyArray<number>): readonly [number, number] =>
	values.length === 0 ? [0, 0] : [Math.min(...values), Math.max(...values)]

/** x of point `index` of `count` on a line: first at 0, last at 100 (a single point sits in the middle). */
export const pointX = (index: number, count: number): number =>
	count <= 1 ? 50 : (index / (count - 1)) * 100

/** x of the center of band `index` of `count` equal bands across 0–100. */
export const bandX = (index: number, count: number): number => ((index + 0.5) / count) * 100

/** Each band's width, percent. */
export const bandWidth = (count: number): number => (count <= 0 ? 0 : 100 / count)

/** Which of `count` indexes get an axis label: about `max` of them, evenly spaced, always the last. */
export const tickIndexes = (count: number, max: number): ReadonlyArray<number> => {
	if (count <= 0) return []
	if (count <= max) return Array.from({ length: count }, (_, index) => index)
	const every = Math.max(1, Math.round((count - 1) / Math.max(max - 1, 1)))
	const indexes: Array<number> = []
	for (let index = count - 1; index >= 0; index -= every) indexes.unshift(index)
	return indexes
}

const fixed = (value: number): string => String(Math.round(value * 100) / 100)

/** `M x y L x y …` through the points; empty for none. */
export const linePath = (points: ReadonlyArray<Point>): string =>
	points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${fixed(x)} ${fixed(y)}`).join(" ")

/** The line closed down to `baseY`: the fill under a line. */
export const areaPath = (points: ReadonlyArray<Point>, baseY: number): string => {
	const first = points[0]
	const last = points.at(-1)
	if (first === undefined || last === undefined) return ""
	return `${linePath(points)} L${fixed(last[0])} ${fixed(baseY)} L${fixed(first[0])} ${fixed(baseY)} Z`
}

/** The values as points across `[0, width] × [height, 0]` (y up), scaled to `[min, max]`. */
export const seriesPoints = (
	values: ReadonlyArray<number>,
	options: Readonly<{ width: number; height: number; min?: number; max?: number; inset?: number }>,
): ReadonlyArray<Point> => {
	const [lo, hi] = extent(values)
	const inset = options.inset ?? 0
	const x = scaleLinear([0, Math.max(values.length - 1, 1)], [inset, options.width - inset])
	const y = scaleLinear([options.min ?? lo, options.max ?? hi], [options.height - inset, inset])
	return values.map((value, index): Point => [values.length === 1 ? options.width / 2 : x(index), y(value)])
}

/** One stacked segment: `from` → `to` in value space (`to` farther from zero). */
export type Segment = Readonly<{ key: string; from: number; to: number }>

/**
 * Stacks a bar's values from zero: positives upward in order, negatives downward in order.
 * Zero values get no segment.
 */
export const stackSegments = (
	values: ReadonlyArray<Readonly<{ key: string; value: number }>>,
): ReadonlyArray<Segment> => {
	let up = 0
	let down = 0
	const segments: Array<Segment> = []
	for (const { key, value } of values) {
		if (value > 0) {
			segments.push({ key, from: up, to: up + value })
			up += value
		} else if (value < 0) {
			segments.push({ key, from: down, to: down + value })
			down += value
		}
	}
	return segments
}

/** The lowest negative stack and highest positive stack over all bars (and any extra values, e.g. a net line). */
export const stackExtent = (
	bars: ReadonlyArray<ReadonlyArray<number>>,
	extra: ReadonlyArray<number> = [],
): readonly [number, number] => {
	let lo = 0
	let hi = 0
	for (const values of bars) {
		const up = values.reduce((sum, value) => (value > 0 ? sum + value : sum), 0)
		const down = values.reduce((sum, value) => (value < 0 ? sum + value : sum), 0)
		hi = Math.max(hi, up)
		lo = Math.min(lo, down)
	}
	for (const value of extra) {
		hi = Math.max(hi, value)
		lo = Math.min(lo, value)
	}
	return [lo, hi]
}

/**
 * Moves label positions (percent, top-down) apart so neighbours are at least `gap` apart, keeping
 * their order and staying inside `[0, 100]`. Returns positions in the input's order.
 */
export const spreadLabels = (positions: ReadonlyArray<number>, gap: number): ReadonlyArray<number> => {
	const order = positions
		.map((position, index) => ({ position, index }))
		.sort((a, b) => a.position - b.position)
	// Push each label down off the one above it…
	const down = order.reduce<ReadonlyArray<number>>((placed, { position }) => {
		const above = placed.at(-1)
		return [...placed, above === undefined ? position : Math.max(position, above + gap)]
	}, [])
	// …then a run pushed past the bottom back up (a no-op when nothing overflowed).
	const placed = down.reduceRight<ReadonlyArray<number>>((below, position) => {
		const next = below[0]
		return [Math.min(position, next === undefined ? 100 : next - gap), ...below]
	}, [])
	const result = [...positions]
	order.forEach((entry, rank) => {
		result[entry.index] = placed[rank] ?? entry.position
	})
	return result
}

/** Clamps to `[min, max]`. */
export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))
