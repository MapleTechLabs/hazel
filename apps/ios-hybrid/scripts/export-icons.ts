/**
 * HazelUI's checked-in resources (`icon-catalog`, `illustration-asset`): every `IconName` as a 96px PNG
 * in `Resources/Icons` (the web's own SVG, `packages/ui/src/web/icons.generated.ts`, drawn by CoreSVG
 * through `rasterize-icons.swift`; `currentColor` becomes black, its opacities stay; an icon with no
 * `currentColor`, the Slack mark, keeps its colours as `<name>.original.png`), and the empty state's
 * illustrations in `Resources/Illustrations`. Plain files, not an asset catalog: the catalog's packed
 * renditions drew nothing on a device (TestFlight 3186.6).
 *   bun scripts/export-icons.ts            rewrite the resources
 *   bun scripts/export-icons.ts --check    fail when they are stale
 *   bun scripts/export-icons.ts <out>      the spike app's catalog (`hazel.<name>`, `build-effect-ui.sh`)
 */
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { iconNames, type IconName } from "../../../packages/ui/src/vocabulary/options.ts"
import { iconSvgs } from "../../../packages/ui/src/web/icons.generated.ts"

const here = dirname(fileURLToPath(import.meta.url))
const resources = join(here, "../HazelUI/Sources/HazelUI/Resources")
const images = join(here, "../../web-foldkit/public/images")

/** An icon drawn in its own colours: its markup never uses the ink (the web's Discord icon does). */
const isOriginal = (name: IconName) => !iconSvgs[name].includes("currentColor")
/** `emptyIllustrations` (`style/schema.ts`) and the web picture each one is. */
const illustrations = { squirrel: "squirrle_ocean.webp" } as const

/** The web's markup as a catalog SVG: black ink, and the view box as its size (the natural size). */
const catalogSvg = (name: IconName) => {
	const markup = iconSvgs[name].replace(' aria-hidden="true"', "")
	const box = /viewBox="([\d.\s-]+)"/.exec(markup)?.[1]?.trim().split(/\s+/) ?? ["0", "0", "18", "18"]
	const sized = outlinedText(
		middleBaselines(markup.replace("<svg ", `<svg width="${box[2]}" height="${box[3]}" `)),
	)
	return isOriginal(name) ? sized : sized.replaceAll("currentColor", "#000")
}

/** CoreSVG ignores `dominant-baseline="middle"`: move such text down to its baseline (centre plus a
 * third of the font size, Inter's half x-height) and drop the attribute. */
const middleBaselines = (markup: string) =>
	markup.replace(/<text ([^>]*)>/g, (tag, attrs: string) => {
		const y = /\by="([\d.]+)"/.exec(attrs)?.[1]
		const size = /font-size="([\d.]+)"/.exec(attrs)?.[1]
		if (!attrs.includes('dominant-baseline="middle"') || y === undefined || size === undefined) return tag
		const baseline = Math.round((Number(y) + Number(size) / 3) * 100) / 100
		const moved = attrs
			.replace(/\by="[\d.]+"/, `y="${baseline}"`)
			.replace(' dominant-baseline="middle"', "")
		return `<text ${moved}>`
	})

/**
 * Text in an icon, as Inter outlines (`scripts/outline-text.py <text> <size> <weight> <x> <y>`):
 * CoreSVG sets `<text>` in whatever system font it finds, so it drew differently per machine.
 */
const textOutlines = new Map([
	[
		"GIF",
		"M6.47 12.56Q5.86 12.56 5.4 12.29Q4.94 12.02 4.68 11.51Q4.42 11.01 4.42 10.32Q4.42 9.61 4.69 9.11Q4.96 8.61 5.42 8.34Q5.88 8.08 6.45 8.08Q6.82 8.08 7.14 8.18Q7.46 8.29 7.71 8.49Q7.95 8.68 8.11 8.95Q8.27 9.22 8.31 9.54H7.41Q7.36 9.39 7.28 9.26Q7.19 9.14 7.07 9.05Q6.96 8.96 6.8 8.92Q6.65 8.87 6.47 8.87Q6.13 8.87 5.87 9.04Q5.62 9.21 5.47 9.53Q5.33 9.85 5.33 10.31Q5.33 10.78 5.47 11.1Q5.61 11.42 5.87 11.59Q6.13 11.76 6.48 11.76Q6.8 11.76 7.02 11.65Q7.25 11.54 7.37 11.32Q7.49 11.11 7.49 10.83L7.68 10.85H6.54V10.17H8.36V10.72Q8.36 11.29 8.12 11.7Q7.87 12.12 7.45 12.34Q7.02 12.56 6.47 12.56ZM9.94 8.13V12.5H9.04V8.13ZM10.73 12.5V8.13H13.6V8.88H11.62V10.09H13.41V10.82H11.62V12.5Z",
	],
])

/** Each `<text>` with an outline above becomes that path, in the text's fill. */
const outlinedText = (markup: string) =>
	markup.replace(/<text ([^>]*)>([^<]*)<\/text>/g, (tag, attrs: string, text: string) => {
		const d = textOutlines.get(text)
		if (d === undefined) return tag
		const fill = /\bfill="([^"]+)"/.exec(attrs)?.[1] ?? "currentColor"
		return `<path d="${d}" fill="${fill}"></path>`
	})

const json = (value: unknown) => `${JSON.stringify(value, null, "\t")}\n`

/** Every file of a catalog, by path inside it. */
const catalog = (prefix: string) => {
	const files = new Map<string, string | Buffer>([
		["Contents.json", json({ info: { author: "xcode", version: 1 } })],
	])
	for (const name of iconNames) {
		const set = `${prefix}${name}.imageset`
		files.set(`${set}/${name}.svg`, catalogSvg(name))
		files.set(
			`${set}/Contents.json`,
			json({
				images: [{ filename: `${name}.svg`, idiom: "universal" }],
				info: { author: "xcode", version: 1 },
				properties: {
					"preserves-vector-representation": true,
					"template-rendering-intent": isOriginal(name) ? "original" : "template",
				},
			}),
		)
	}
	return files
}

/** Each icon's pixels: four times the 24pt an icon is drawn at most, at 3x. */
const ICON_PIXELS = 96

/** Every icon as a PNG, drawn by CoreSVG (`rasterize-icons.swift`), by file name. */
const iconPngs = () => {
	const work = mkdtempSync(join(tmpdir(), "hazel-icons-"))
	try {
		const svgs = join(work, "svg"), pngs = join(work, "png")
		mkdirSync(svgs)
		for (const name of iconNames) writeFileSync(join(svgs, `${name}.svg`), catalogSvg(name))
		const run = spawnSync("swift", [join(here, "rasterize-icons.swift"), svgs, pngs, String(ICON_PIXELS)], {
			encoding: "utf8",
		})
		if (run.status !== 0) throw new Error(`rasterize-icons failed: ${run.stderr}`)
		return new Map(
			iconNames.map((name) => [
				isOriginal(name) ? `${name}.original.png` : `${name}.png`,
				readFileSync(join(pngs, `${name}.png`)),
			]),
		)
	} finally {
		rmSync(work, { recursive: true, force: true })
	}
}

/** HazelUI's resources, by path inside `Resources/`. */
const resourceFiles = () => {
	const files = new Map<string, string | Buffer>()
	for (const [file, content] of iconPngs()) files.set(`Icons/${file}`, content)
	for (const [name, source] of Object.entries(illustrations))
		files.set(`Illustrations/${name}.webp`, readFileSync(join(images, source)))
	return files
}

const write = (root: string, files: Map<string, string | Buffer>) => {
	rmSync(root, { recursive: true, force: true })
	for (const [path, content] of files) {
		mkdirSync(dirname(join(root, path)), { recursive: true })
		writeFileSync(join(root, path), content)
	}
}

const listed = (root: string): ReadonlyArray<string> =>
	existsSync(root)
		? readdirSync(root, { recursive: true, withFileTypes: true })
				.filter((entry) => entry.isFile())
				.map((entry) => relative(root, join(entry.parentPath, entry.name)))
		: []

/** Paths that differ between `files` and what is on disk under `root`. */
const stale = (root: string, files: Map<string, string | Buffer>) => {
	const out = listed(root).filter((path) => !files.has(path))
	for (const [path, content] of files) {
		const file = join(root, path)
		if (!existsSync(file) || !readFileSync(file).equals(Buffer.from(content))) out.push(path)
	}
	return out
}

const arg = process.argv[2]
if (arg === "--check") {
	const paths = stale(resources, resourceFiles())
	if (paths.length > 0) {
		console.error(
			`HazelUI resources are stale (${paths.slice(0, 5).join(", ")}); run bun scripts/export-icons.ts`,
		)
		process.exit(1)
	}
	console.log(`HazelUI resources are current (${iconNames.length} icons)`)
} else if (arg !== undefined) {
	write(arg, catalog("hazel."))
	console.log(`${iconNames.length} icons -> ${arg}`)
} else {
	write(resources, resourceFiles())
	console.log(
		`${iconNames.length} icons, ${Object.keys(illustrations).length} illustrations -> ${resources}`,
	)
}
