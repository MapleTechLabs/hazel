/** Pixel diff of two same-size screenshots: overall score, per-tile scores and a heatmap. */
import { blankImage, blit, type Image, strokeRect } from "./png"
import type { Rect } from "./match"

/** A pixel matches when no channel differs by more than this. */
export const TOLERANCE = 24
export const GRID = { cols: 16, rows: 10 }

export interface Tile {
	readonly col: number
	readonly row: number
	/** In device pixels. */
	readonly x: number
	readonly y: number
	readonly w: number
	readonly h: number
	readonly score: number
}

const pixelDiff = (a: Image, b: Image, i: number) =>
	Math.max(
		Math.abs((a.data[i] ?? 0) - (b.data[i] ?? 0)),
		Math.abs((a.data[i + 1] ?? 0) - (b.data[i + 1] ?? 0)),
		Math.abs((a.data[i + 2] ?? 0) - (b.data[i + 2] ?? 0)),
	)

export const visualDiff = (native: Image, web: Image) => {
	if (native.width !== web.width || native.height !== web.height)
		throw new Error(
			`screenshot sizes differ: ${native.width}x${native.height} vs ${web.width}x${web.height}`,
		)
	const { width, height } = native
	const tileW = width / GRID.cols
	const tileH = height / GRID.rows
	const tileMatches = new Float64Array(GRID.cols * GRID.rows)
	const tileTotals = new Float64Array(GRID.cols * GRID.rows)
	// Heatmap at half resolution: the web render faded, each 2x2 block tinted by its worst pixel.
	const heat = blankImage(width >> 1, height >> 1, [255, 255, 255, 255])
	let matching = 0
	for (let y = 0; y < height; y++) {
		const row = Math.min(GRID.rows - 1, Math.floor(y / tileH))
		for (let x = 0; x < width; x++) {
			const i = (y * width + x) * 4
			const diff = pixelDiff(native, web, i)
			const tile = row * GRID.cols + Math.min(GRID.cols - 1, Math.floor(x / tileW))
			tileTotals[tile] = (tileTotals[tile] ?? 0) + 1
			if (diff <= TOLERANCE) {
				matching++
				tileMatches[tile] = (tileMatches[tile] ?? 0) + 1
			}
			const h = ((y >> 1) * heat.width + (x >> 1)) * 4
			if (x % 2 === 0 && y % 2 === 0) {
				const grey =
					0.299 * (web.data[i] ?? 0) +
					0.587 * (web.data[i + 1] ?? 0) +
					0.114 * (web.data[i + 2] ?? 0)
				const faded = Math.round(200 + grey * 0.2)
				heat.data.set([faded, faded, faded, 255], h)
			}
			if (diff > TOLERANCE) {
				const strength = Math.min(1, diff / 160)
				const current = heat.data[h + 1] ?? 255
				const g = Math.round(Math.min(current, 200 * (1 - strength)))
				heat.data.set([255, g, Math.round(g * 0.6), 255], h)
			}
		}
	}
	const tiles: Array<Tile> = []
	for (let row = 0; row < GRID.rows; row++) {
		for (let col = 0; col < GRID.cols; col++) {
			const t = row * GRID.cols + col
			tiles.push({
				col,
				row,
				x: Math.round(col * tileW),
				y: Math.round(row * tileH),
				w: Math.round(tileW),
				h: Math.round(tileH),
				score: Math.round((10000 * (tileMatches[t] ?? 0)) / Math.max(1, tileTotals[t] ?? 1)) / 100,
			})
		}
	}
	for (const tile of tiles) {
		strokeRect(heat, { x: tile.x / 2, y: tile.y / 2, w: tile.w / 2, h: tile.h / 2 }, [220, 220, 235, 255])
	}
	return { score: Math.round((10000 * matching) / (width * height)) / 100, tiles, heatmap: heat }
}

/** native | web, side by side, of one device-pixel region, with optional outlines per panel. */
export const sideBySide = (
	native: Image,
	web: Image,
	region: Rect,
	outlines: ReadonlyArray<{ rect: Rect; rgba: readonly [number, number, number, number] }> = [],
) => {
	const gap = 12
	const out = blankImage(region.w * 2 + gap, region.h, [255, 0, 255, 255])
	for (const [panel, src] of [native, web].entries()) {
		const dx = panel * (region.w + gap)
		blit(src, out, region, dx, 0)
		for (const { rect, rgba } of outlines) {
			strokeRect(out, { x: rect.x - region.x + dx, y: rect.y - region.y, w: rect.w, h: rect.h }, rgba)
		}
	}
	return out
}
