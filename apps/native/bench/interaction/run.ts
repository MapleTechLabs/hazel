/**
 * Interaction checks: drives the native app headless and asserts what should always hold.
 *   bun apps/native/bench/interaction/run.ts [--only <check name substring>] [--skip-build]
 * - every overlay closes with Escape, a press outside and a second press on its trigger, and
 *   leaves the page interactive;
 * - nothing stays hovered once the pointer has moved to an empty spot;
 * - nothing moves or flickers while the pointer holds still;
 * - a press on a text field puts the caret in it.
 * Writes out/report.md and exits non-zero when a check fails.
 */
import { spawnSync } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

const here = import.meta.dirname
const appDir = resolve(here, "../..")
const outDir = join(here, "out")
const host = join(appDir, "host/target/release/hazel-native")
const CONTENT_TEXT = "Shipping it. Thanks everyone"
/** An empty stretch of the channel header: pressing or hovering it does nothing. */
const NEUTRAL: Point = [1000, 28]

type Point = [number, number]
type Step = Record<string, unknown>

/** An overlay, how to open it, and text that shows only while it is open. */
type Overlay = {
	readonly name: string
	readonly open: ReadonlyArray<Step>
	readonly shows: string
	/** Pressing the trigger again closes it (menus, popovers; not dialogs or the palette). */
	readonly toggles?: boolean
}

const OVERLAYS: ReadonlyArray<Overlay> = [
	{ name: "org menu", open: [{ clickText: "Hazel" }], shows: "Switch Server", toggles: true },
	{
		name: "sidebar channel menu",
		// Over Favorites' first channel, the first row with a dots trigger: `clickLabel` presses
		// the first trigger in the tree, which shows only while its own row is hovered.
		open: [{ move: [200, 270] }, { wait: 250 }, { clickLabel: "Channel options" }],
		// The item a panel drawn inside its row (clipped there) would still show.
		shows: "Settings",
		toggles: true,
	},
	{
		name: "section menu",
		open: [{ clickLabel: "Section actions" }],
		shows: "Join existing channel",
		toggles: true,
	},
	{ name: "user menu", open: [{ clickText: "Ada Lovelace" }], shows: "My Settings", toggles: true },
	{ name: "command palette", open: [{ clickText: "Browse channels" }], shows: "Quick Actions" },
	{ name: "context menu", open: [{ rightClickText: CONTENT_TEXT }], shows: "Copy Text" },
	{
		name: "pinned popover",
		open: [{ clickLabel: "View pinned messages" }],
		shows: "Pinned Messages",
		toggles: true,
	},
	{ name: "GIF picker", open: [{ clickText: "GIF" }], shows: "Powered by", toggles: true },
	{
		name: "message actions menu",
		open: [{ move: [700, 410] }, { wait: 300 }, { clickLabel: "More actions" }],
		shows: "Pin message",
	},
	{
		name: "set status dialog",
		open: [{ clickText: "Ada Lovelace" }, { settle: 500 }, { clickText: "Set status" }],
		shows: "Set a status",
	},
]

type Closer = "Escape" | "outside" | "trigger"

/** Text fields, and how to press into them. */
const FIELDS: ReadonlyArray<{ name: string; steps: ReadonlyArray<Step> }> = [
	{ name: "composer (text line)", steps: [{ clickAt: [700, 731] }] },
	{ name: "composer (box padding)", steps: [{ clickAt: [700, 716] }] },
	{ name: "palette search", steps: [{ clickText: "Browse channels" }, { settle: 500 }] },
]

/** Where the pointer rests while nothing may change, after reaching it by a glide. */
const STILL_SPOTS: ReadonlyArray<{ name: string; from: Point; to: Point }> = [
	{ name: "message", from: [700, 120], to: [700, 410] },
	{ name: "next message", from: [700, 410], to: [700, 505] },
	{ name: "message toolbar", from: [700, 410], to: [1150, 365] },
	{ name: "sidebar channel", from: [200, 600], to: [200, 470] },
	{ name: "empty header", from: [700, 410], to: NEUTRAL },
]

const args = process.argv.slice(2)
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : undefined
const wanted = (name: string) => only === undefined || name.includes(only)

type Probe = {
	focused: Array<{ path: string; role: string; label: string | null; vis: boolean; text: string }>
	hovered: Array<{ path: string; hover: number; text: string; rect: [number, number, number, number] }>
	inert: number
	shown: Array<{ text: string; rect: [number, number, number, number] | null }>
}
type Watch = {
	frames: number
	trees: number
	changing: Array<{ path: string; changes: number; text: string }>
}

type Failure = { check: string; detail: string }
const failures: Array<Failure> = []
const passes: Array<string> = []
const record = (check: string, ok: boolean, detail: string) => {
	if (ok) passes.push(check)
	else failures.push({ check, detail })
}

/** Runs one capture script and returns its probes and watches by label. */
const capture = (name: string, steps: ReadonlyArray<Step>) => {
	const script = join(outDir, `${name.replaceAll(/\W+/g, "-")}.json`)
	const boot = [{ waitText: CONTENT_TEXT }, { settle: 2500 }]
	writeFileSync(script, JSON.stringify([...boot, ...steps]))
	const result = spawnSync(host, ["--capture", script], {
		cwd: appDir,
		env: { ...process.env, HAZEL_NATIVE_ENTRY: "dist/entry.js", NATIVE_THEME: "dark" },
		encoding: "utf8",
		timeout: 240_000,
	})
	const probes = new Map<string, Probe>()
	const watches = new Map<string, Watch>()
	const misses: Array<string> = []
	/** Errors the runtime threw: a browser logs them; here each is a failed check. */
	const errors: Array<string> = []
	for (const line of (result.stderr ?? "").split("\n")) {
		const probe = /^\[probe (.+?)\] (\{.*)$/.exec(line)
		if (probe?.[1] && probe[2]) {
			// SAFETY: the host's probe step prints this shape (apps/native/host/src/capture.rs).
			probes.set(probe[1], JSON.parse(probe[2]) as Probe)
		}
		const watch = /^\[watch (.+?)\] (\{.*)$/.exec(line)
		if (watch?.[1] && watch[2]) {
			// SAFETY: the host's watch step prints this shape.
			watches.set(watch[1], JSON.parse(watch[2]) as Watch)
		}
		if (line.startsWith("[capture]")) misses.push(line)
		if (/^\[uncaught |^(TypeError|ReferenceError|RangeError|SyntaxError): /.test(line)) errors.push(line)
	}
	if (result.status !== 0) misses.push(`exit ${result.status}: ${(result.stderr ?? "").slice(-400)}`)
	record(`${name}: no runtime errors`, errors.length === 0, errors.slice(0, 3).join(" | "))
	return { probes, watches, misses }
}

const contains = ([x, y, w, h]: [number, number, number, number], [px, py]: Point) =>
	px >= x && px <= x + w && py >= y && py <= y + h

/** Hovered elements the pointer at `at` is not over: a hover that stayed behind. */
const stuckHovers = (probe: Probe | undefined, at: Point) =>
	(probe?.hovered ?? []).filter((h) => !contains(h.rect, at)).map((h) => `"${h.text}" ${h.path.slice(-40)}`)

const isShown = (probe: Probe | undefined, text: string) =>
	probe?.shown.some((s) => s.text === text && s.rect !== null) ?? false

const resetSteps: ReadonlyArray<Step> = [
	{ press: "Escape" },
	{ press: "Escape" },
	{ clickAt: NEUTRAL },
	{ settle: 400 },
	{ wait: 200 },
]

mkdirSync(outDir, { recursive: true })
if (!args.includes("--skip-build")) {
	spawnSync("bun", ["run", "build"], { cwd: appDir, stdio: "inherit" })
	spawnSync("cargo", ["build", "--release"], { cwd: join(appDir, "host"), stdio: "inherit" })
}

/** Frames after opening an overlay in which its panel may not stand anywhere but where it settles. */
const APPEAR_FRAMES = 6

// OVERLAYS: open, check it shows, close one way, check it is gone and the page is usable.
for (const overlay of OVERLAYS.filter((o) => wanted(o.name))) {
	const closers: Array<Closer> = ["Escape", "outside", ...(overlay.toggles ? (["trigger"] as const) : [])]
	const steps: Array<Step> = []
	for (const closer of closers) {
		const label = `${overlay.name}/${closer}`
		const close: Array<Step> =
			closer === "Escape"
				? [{ press: "Escape" }]
				: closer === "outside"
					? [{ clickAt: NEUTRAL }]
					: overlay.open.filter((s) => !("move" in s) && !("wait" in s))
		// The first frames after opening: the panel must appear where it settles, never elsewhere first.
		const frames: Array<Step> =
			closer === "Escape"
				? // The first probe reads the frame the click's own round trip drew, before any wait.
					Array.from({ length: APPEAR_FRAMES }, (_, i) => [
						...(i === 0 ? [] : [{ wait: 16 }]),
						{ probe: { label: `${label}/frame${i}`, texts: [overlay.shows] } },
					]).flat()
				: []
		steps.push(
			...overlay.open,
			...frames,
			{ settle: 700 },
			{ wait: 200 },
			{ probe: { label: `${label}/open`, texts: [overlay.shows] } },
			...close,
			{ settle: 600 },
			// `settle` waits for the runtime to go quiet; `wait` lets the frames (a fading hover) run.
			{ move: NEUTRAL },
			{ wait: 400 },
			{ probe: { label: `${label}/closed`, texts: [overlay.shows] } },
			...resetSteps,
		)
	}
	console.log(`overlay: ${overlay.name}`)
	const { probes, misses } = capture(`overlay-${overlay.name}`, steps)
	for (const miss of misses) console.warn(`  ${miss}`)
	for (const closer of closers) {
		const label = `${overlay.name}/${closer}`
		const opened = probes.get(`${label}/open`)
		const closed = probes.get(`${label}/closed`)
		record(
			`${label}: opens`,
			isShown(opened, overlay.shows),
			`"${overlay.shows}" not shown after opening`,
		)
		if (!isShown(opened, overlay.shows)) continue
		record(
			`${label}: closes`,
			!isShown(closed, overlay.shows),
			`"${overlay.shows}" still shown after ${closer}`,
		)
		record(`${label}: page usable`, (closed?.inert ?? 0) === 0, `${closed?.inert} elements still inert`)
		if (closer === "Escape") {
			const settled = opened?.shown.find((s) => s.text === overlay.shows)?.rect
			const jumps = Array.from({ length: APPEAR_FRAMES }, (_, i) => {
				const rect = probes
					.get(`${label}/frame${i}`)
					?.shown.find((s) => s.text === overlay.shows)?.rect
				const off = rect && settled && rect.some((v, k) => Math.abs(v - (settled[k] ?? 0)) > 1)
				return off ? `frame ${i} at ${rect.map(Math.round).join(",")}` : undefined
			}).filter((j) => j !== undefined)
			record(
				`${overlay.name}: appears in place`,
				jumps.length === 0,
				`settles at ${settled?.map(Math.round).join(",")}; ${jumps.join("; ")}`,
			)
		}
		const stuck = stuckHovers(closed, NEUTRAL)
		record(`${label}: no hover left`, stuck.length === 0, `still hovered: ${stuck.join("; ")}`)
	}
}

// SUBMENU: Escape inside a submenu closes it and leaves its menu open.
if (wanted("submenu")) {
	const steps: Array<Step> = [
		{ clickText: "Hazel" },
		{ settle: 700 },
		{ hoverText: "Switch Server" },
		{ settle: 500 },
		{ wait: 300 },
		{ press: "ArrowRight" },
		// Off the trigger: a pointer resting on it would hover the submenu open again.
		{ move: [700, 600] },
		{ settle: 500 },
		{ wait: 200 },
		{ probe: { label: "submenu/open", texts: ["Create server", "Switch Server"] } },
		{ press: "Escape" },
		{ settle: 500 },
		{ wait: 200 },
		{ probe: { label: "submenu/escaped", texts: ["Create server", "Switch Server"] } },
	]
	console.log("submenu")
	const { probes } = capture("submenu", steps)
	const opened = probes.get("submenu/open")
	const escaped = probes.get("submenu/escaped")
	record("submenu: opens from the keyboard", isShown(opened, "Create server"), "submenu not shown")
	if (isShown(opened, "Create server")) {
		record(
			"submenu/Escape: closes the submenu",
			!isShown(escaped, "Create server"),
			"submenu still shown",
		)
		record(
			"submenu/Escape: keeps its menu open",
			isShown(escaped, "Switch Server"),
			"the whole menu closed",
		)
	}
}

// SHORTCUTS: the app's key bindings listen on `document`.
const SHORTCUTS: ReadonlyArray<{ name: string; before: ReadonlyArray<Step>; keys: string; shows: string }> = [
	{ name: "⌘K from the window", before: [{ clickAt: NEUTRAL }], keys: "Meta+k", shows: "Quick Actions" },
	{
		name: "⌘K from the composer",
		before: [{ clickAt: [700, 731] }],
		keys: "Meta+k",
		shows: "Quick Actions",
	},
]
for (const shortcut of SHORTCUTS.filter((s) => wanted(s.name))) {
	const steps: Array<Step> = [
		...shortcut.before,
		{ settle: 300 },
		{ press: shortcut.keys },
		{ settle: 600 },
		{ wait: 200 },
		{ probe: { label: shortcut.name, texts: [shortcut.shows] } },
	]
	console.log(`shortcut: ${shortcut.name}`)
	const { probes } = capture(`shortcut-${shortcut.name}`, steps)
	record(
		`${shortcut.name}: opens`,
		isShown(probes.get(shortcut.name), shortcut.shows),
		`"${shortcut.shows}" not shown`,
	)
}

// STILLNESS: glide to a spot, hold still, nothing may change.
if (wanted("still")) {
	const steps: Array<Step> = STILL_SPOTS.flatMap((spot) => [
		{ watch: { label: `glide ${spot.name}`, ms: 600, at: spot.from, to: spot.to, settle: 200 } },
		{ watch: { label: `still ${spot.name}`, ms: 800, settle: 350 } },
		{ probe: { label: `still ${spot.name}` } },
	])
	console.log("stillness")
	const { probes, watches, misses } = capture("stillness", steps)
	for (const miss of misses) console.warn(`  ${miss}`)
	for (const spot of STILL_SPOTS) {
		const still = watches.get(`still ${spot.name}`)
		const moving = (still?.changing ?? []).map((c) => `${c.changes}x "${c.text}" ${c.path.slice(-40)}`)
		record(`still on ${spot.name}: nothing moves`, moving.length === 0, `changing: ${moving.join("; ")}`)
		record(
			`still on ${spot.name}: no commits`,
			(still?.trees ?? 0) <= 1,
			`${still?.trees} trees while the pointer held still`,
		)
		const stuck = stuckHovers(probes.get(`still ${spot.name}`), spot.to)
		record(`still on ${spot.name}: hover under the pointer only`, stuck.length === 0, stuck.join("; "))
	}
}

// FIELDS: pressing a text field focuses its editor.
for (const field of FIELDS.filter((f) => wanted(f.name))) {
	const steps: Array<Step> = [...field.steps, { settle: 400 }, { probe: { label: field.name } }]
	console.log(`field: ${field.name}`)
	const { probes } = capture(`field-${field.name}`, steps)
	const focused = probes.get(field.name)?.focused ?? []
	const editor = focused.some((f) => f.path.endsWith("/field") || f.role === "textbox")
	record(
		`${field.name}: takes the caret`,
		editor,
		`focused: ${focused.map((f) => f.path.slice(-40)).join(", ") || "nothing"}`,
	)
}

const report = [
	"# Interaction checks",
	"",
	`${passes.length} passed, ${failures.length} failed.`,
	"",
	...(failures.length > 0
		? ["## Failures", "", ...failures.map((f) => `- **${f.check}**: ${f.detail}`), ""]
		: []),
	"## Passed",
	"",
	...passes.map((p) => `- ${p}`),
].join("\n")
writeFileSync(join(outDir, "report.md"), report)
console.log(`\n${passes.length} passed, ${failures.length} failed`)
for (const f of failures) console.log(`FAIL ${f.check}: ${f.detail}`)
process.exit(failures.length > 0 ? 1 : 0)
