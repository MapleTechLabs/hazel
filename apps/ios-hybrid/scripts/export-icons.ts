/**
 * HazelUI's checked-in resources (`icon-catalog`, `illustration-asset`): every `IconName` as a template
 * image in `Resources/Icons.xcassets` (the web's own SVG, `packages/ui/src/web/icons.ts`; `currentColor`
 * becomes black, its opacities stay; an icon with no `currentColor`, the Slack mark, keeps its colours),
 * and the empty state's illustrations in `Resources/Illustrations`.
 *   bun scripts/export-icons.ts            rewrite the resources
 *   bun scripts/export-icons.ts --check    fail when they are stale
 *   bun scripts/export-icons.ts <out>      the spike app's catalog (`hazel.<name>`, `build-effect-ui.sh`)
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { svg } from "../../../packages/ui/src/web/icons.ts"
import { iconNames } from "../../../packages/ui/src/vocabulary/options.ts"

const here = dirname(fileURLToPath(import.meta.url))
const resources = join(here, "../HazelUI/Sources/HazelUI/Resources")
const images = join(here, "../../web-foldkit/public/images")

/** An icon drawn in its own colours: its markup never uses the ink (the web's Discord icon does). */
const isOriginal = (name: string) => !svg(name).includes("currentColor")
/** `emptyIllustrations` (`style/schema.ts`) and the web picture each one is. */
const illustrations = { squirrel: "squirrle_ocean.webp" } as const

/** The web's markup as a catalog SVG: black ink, and the view box as its size (the natural size). */
const catalogSvg = (name: string) => {
	const markup = svg(name).replace(' aria-hidden="true"', "")
	const box = /viewBox="([\d.\s-]+)"/.exec(markup)?.[1]?.trim().split(/\s+/) ?? ["0", "0", "18", "18"]
	const sized = middleBaselines(markup.replace("<svg ", `<svg width="${box[2]}" height="${box[3]}" `))
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

/** HazelUI's resources, by path inside `Resources/`. */
const resourceFiles = () => {
	const files = new Map<string, string | Buffer>()
	for (const [path, content] of catalog("")) files.set(`Icons.xcassets/${path}`, content)
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
