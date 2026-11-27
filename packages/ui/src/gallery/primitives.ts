// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * The fixture gallery (phase 1.5): every conformance case mounted on the real web host, grouped by tag.
 * `?tags=item,section` or `?lane=A4` narrows it; `?theme=dark` themes it. The browser runner
 * (`scripts/test-web.ts`) reads each case's outcome from `window.__hazelCases`.
 */
import { Renderer } from "@effect/ui"
import { Cause, Effect, Layer } from "effect"
import { cases } from "../conformance/fixtures.ts"
import type { FixtureCase } from "../conformance/schema.ts"
import { FixtureView } from "../conformance/view.ts"
import { isTagKey, tags } from "../vocabulary/spec.ts"
import { withWebHost } from "../web/mount.ts"
import { applyTheme } from "./page.ts"

/** A case's outcome: drawn, a stub or missing renderer (lanes named), or an error. */
export interface CaseOutcome {
	readonly id: string
	readonly tag: string
	readonly status: "ok" | "stub" | "missing" | "error"
	readonly lanes: ReadonlyArray<string>
	readonly error?: string
	readonly aria: FixtureCase["aria"]
	readonly kit: FixtureCase["kit"]
}

declare global {
	interface Window {
		__hazelCases?: ReadonlyArray<CaseOutcome>
	}
}

const params = new URLSearchParams(window.location.search)
const only = params.get("tags")?.split(",").filter(Boolean)
const lane = params.get("lane")
const wanted = (tag: string) =>
	(only === undefined || only.includes(tag)) &&
	(lane === null || (isTagKey(tag) && (tags[tag].web === lane || tags[tag].ios === lane)))

const el = (tag: string, attributes: Readonly<Record<string, string>>, text?: string) => {
	const node = document.createElement(tag)
	for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value)
	if (text !== undefined) node.textContent = text
	return node
}

const lanesIn = (root: Element) => [
	...new Set(
		[...root.querySelectorAll("[data-hz-stub]")].map((node) => node.getAttribute("data-hz-stub") ?? ""),
	),
]

const mount = (c: FixtureCase, container: HTMLElement) =>
	new Promise<Cause.Cause<unknown> | undefined>((resolve) => {
		const mounting = Renderer.mount(FixtureView, { root: c.root }, container).pipe(
			Effect.tap(() => Effect.sync(() => resolve(undefined))),
			Effect.tapCause((cause) => Effect.sync(() => resolve(cause))),
		)
		Effect.runFork(Layer.launch(withWebHost(mounting)))
	})

const run = async () => {
	applyTheme()
	const app = document.getElementById("app")
	if (app === null) throw new Error("primitives.html has no #app")
	const outcomes: Array<CaseOutcome> = []
	let lastTag = ""
	for (const c of cases.filter((each) => wanted(each.tag))) {
		if (c.tag !== lastTag) app.append(el("h2", { class: "tag-title" }, `hz:${c.tag}`))
		lastTag = c.tag
		const label = el("p", { class: "case-label" }, c.id)
		const frame = el("div", { class: `frame-${c.frame}`, "data-case": c.id })
		const block = el("div", { class: "case" })
		block.append(label, frame)
		app.append(block)
		const cause = await mount(c, frame)
		await new Promise((resolve) => requestAnimationFrame(resolve))
		const base = { id: c.id, tag: c.tag, aria: c.aria, kit: c.kit }
		let outcome: CaseOutcome
		if (cause !== undefined) {
			const text = Cause.pretty(cause)
			const missing = /lane (\w+) owns it/.exec(text)
			outcome =
				missing === null
					? { ...base, status: "error", lanes: [], error: text }
					: { ...base, status: "missing", lanes: [missing[1] ?? "?"] }
		} else {
			const pending = c.pending?.web
			const stubs = pending === undefined ? lanesIn(frame) : [...new Set([...lanesIn(frame), pending])]
			outcome =
				stubs.length > 0
					? { ...base, status: "stub", lanes: stubs }
					: { ...base, status: "ok", lanes: [] }
		}
		label.dataset.status = outcome.status
		if (outcome.status !== "ok")
			label.textContent = `${c.id} (${outcome.status}${outcome.lanes.length > 0 ? `: lane ${outcome.lanes.join(", ")}` : ""})`
		outcomes.push(outcome)
	}
	await document.fonts.ready
	// Whole-pixel blocks: a case of fractional height (today's 80.5px DM row) would shift every later
	// case by half a pixel and change how its text rasterises against the kit's.
	for (const block of app.querySelectorAll<HTMLElement>(".case"))
		block.style.height = `${Math.ceil(block.getBoundingClientRect().height)}px`
	window.__hazelCases = outcomes
	document.documentElement.dataset.ready = "true"
}

void run()
