/**
 * Element matching and layout metrics for the conformance harness. Both sides are flattened into
 * `El` lists in document order; `matchElements` pairs them, `layoutMetrics` summarises the deltas.
 */

export interface Rect {
	readonly x: number
	readonly y: number
	readonly w: number
	readonly h: number
}

export interface El {
	readonly index: number
	readonly path: string
	readonly tag: string
	/** Own text (direct text nodes), whitespace-collapsed, dynamic parts replaced by tokens. */
	readonly text: string
	readonly fullText: string
	readonly attrs: Readonly<Record<string, string>>
	readonly className: string
	/** Null when the element is not drawn. */
	readonly rect: Rect | null
	readonly parent: number
	/** Index among the parent's exported element children. */
	readonly childIndex: number
	readonly children: Array<number>
}

/** Attributes that identify an element across both renderers. */
export const ID_ATTRS = ["data-slot", "role", "aria-label", "href", "src", "placeholder", "alt"]

/** Collapses whitespace and swaps text that differs run to run (clock times, build version) for tokens. */
export const normalizeText = (text: string) =>
	text
		.replace(/\s+/g, " ")
		.trim()
		.replace(/(?<!\d)\d{1,2}:\d{2}(\s?[AP]M)?(?!\d)/gi, "{time}")
		.replace(/^v(\d+\.\d+\.\d+|native)$/, "{version}")

export type Matching = {
	readonly webToNative: Map<number, number>
	readonly nativeToWeb: Map<number, number>
	readonly phase: Map<number, "root" | "text" | "attrs" | "structure">
}

/** Longest common subsequence of two key sequences, as index pairs. */
const lcs = (a: ReadonlyArray<string>, b: ReadonlyArray<string>): Array<[number, number]> => {
	const n = a.length
	const m = b.length
	const table = new Uint32Array((n + 1) * (m + 1))
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			table[i * (m + 1) + j] =
				a[i] === b[j]
					? (table[(i + 1) * (m + 1) + j + 1] ?? 0) + 1
					: Math.max(table[(i + 1) * (m + 1) + j] ?? 0, table[i * (m + 1) + j + 1] ?? 0)
		}
	}
	const pairs: Array<[number, number]> = []
	let i = 0
	let j = 0
	while (i < n && j < m) {
		if (a[i] === b[j]) {
			pairs.push([i, j])
			i++
			j++
		} else if ((table[(i + 1) * (m + 1) + j] ?? 0) >= (table[i * (m + 1) + j + 1] ?? 0)) i++
		else j++
	}
	return pairs
}

const textKey = (el: El) => (el.text === "" ? null : `${el.tag}|${el.text}`)

const attrKey = (el: El) => {
	const parts = ID_ATTRS.flatMap((name) => {
		const value = el.attrs[name]
		return value === undefined ? [] : [`${name}=${value}`]
	})
	return parts.length === 0 ? null : `${el.tag}|${parts.join("|")}`
}

export const matchElements = (web: ReadonlyArray<El>, native: ReadonlyArray<El>): Matching => {
	const webToNative = new Map<number, number>()
	const nativeToWeb = new Map<number, number>()
	const phase: Matching["phase"] = new Map()
	const pair = (w: number, n: number, how: "root" | "text" | "attrs" | "structure") => {
		webToNative.set(w, n)
		nativeToWeb.set(n, w)
		phase.set(w, how)
	}
	if (web.length > 0 && native.length > 0) pair(0, 0, "root")

	// Key phases: an in-order alignment first, then same-key leftovers paired in order.
	const byKey = (key: (el: El) => string | null, how: "text" | "attrs") => {
		const keyed = (els: ReadonlyArray<El>, taken: Map<number, number>) =>
			els.flatMap((el) => {
				const k = key(el)
				return k === null || taken.has(el.index) ? [] : [{ el, k }]
			})
		const ws = keyed(web, webToNative)
		const ns = keyed(native, nativeToWeb)
		for (const [i, j] of lcs(
			ws.map((x) => x.k),
			ns.map((x) => x.k),
		)) {
			const w = ws[i]
			const n = ns[j]
			if (w !== undefined && n !== undefined) pair(w.el.index, n.el.index, how)
		}
		const leftovers = new Map<string, Array<number>>()
		for (const { el, k } of ns) {
			if (nativeToWeb.has(el.index)) continue
			leftovers.set(k, [...(leftovers.get(k) ?? []), el.index])
		}
		for (const { el, k } of ws) {
			if (webToNative.has(el.index)) continue
			const queue = leftovers.get(k)
			const n = queue?.shift()
			if (n !== undefined) pair(el.index, n, how)
		}
	}
	// Repeated text (author names, counts) first matches with its two following texts as context,
	// so a row rendered on one side only cannot shift the pairing of the rows after it.
	const withContext = (els: ReadonlyArray<El>) => {
		const texts = els.filter((el) => el.text !== "")
		const context = new Map<El, string>()
		for (const [i, el] of texts.entries()) {
			context.set(el, `${el.tag}|${el.text}|${texts[i + 1]?.text ?? ""}|${texts[i + 2]?.text ?? ""}`)
		}
		return context
	}
	const webContext = withContext(web)
	const nativeContext = withContext(native)
	// Strongest context first: the text of an ancestor a few levels up (the message row).
	const ancestorText = (els: ReadonlyArray<El>, el: El, levels: number) => {
		let at: El | undefined = el
		for (let i = 0; i < levels && at !== undefined; i++) at = els[at.parent]
		// Native joins text nodes with spaces where the DOM does not, so compare without whitespace.
		return (at?.fullText ?? "").replace(/\s+/g, "")
	}
	for (const levels of [6, 3]) {
		byKey((el) => {
			const key = textKey(el)
			if (key === null) return null
			const els = webContext.has(el) ? web : native
			return `${key}|${ancestorText(els, el, levels)}`
		}, "text")
	}
	byKey((el) => webContext.get(el) ?? nativeContext.get(el) ?? null, "text")
	byKey(textKey, "text")
	byKey(attrKey, "attrs")

	// Structure: parents of matched children first (they anchor keyed, virtualised lists), then
	// children of matched parents by index and tag, only where both sides hold the same child count.
	const bottomUp = () => {
		let changed = false
		// Deepest first, so a chain of wrappers resolves in one pass.
		for (const n of [...native].reverse()) {
			if (nativeToWeb.has(n.index) || n.children.length === 0) continue
			const votes = new Map<number, number>()
			for (const c of n.children) {
				const wc = nativeToWeb.get(c)
				const wp = wc === undefined ? undefined : web[wc]?.parent
				if (wp !== undefined && wp >= 0 && !webToNative.has(wp))
					votes.set(wp, (votes.get(wp) ?? 0) + 1)
			}
			const best = [...votes].sort((a, b) => b[1] - a[1])[0]
			if (best !== undefined && web[best[0]]?.tag === n.tag) {
				pair(best[0], n.index, "structure")
				changed = true
			}
		}
		return changed
	}
	const topDown = () => {
		let changed = false
		for (const [w, n] of [...webToNative]) {
			const wAll = web[w]?.children ?? []
			const nAll = native[n]?.children ?? []
			const wKids = wAll.filter((c) => !webToNative.has(c))
			const nKids = nAll.filter((c) => !nativeToWeb.has(c))
			if (wKids.length === 0 || nKids.length === 0) continue
			if (wAll.length === nAll.length) {
				for (const wc of wKids) {
					const we = web[wc]
					const nc = nKids.find(
						(c) =>
							!nativeToWeb.has(c) &&
							native[c]?.childIndex === we?.childIndex &&
							native[c]?.tag === we?.tag,
					)
					if (nc !== undefined) {
						pair(wc, nc, "structure")
						changed = true
					}
				}
			}
			const wRest = wKids.filter((c) => !webToNative.has(c))
			const nRest = nKids.filter((c) => !nativeToWeb.has(c))
			if (wRest.length !== nRest.length) continue
			for (const [i, j] of lcs(
				wRest.map((c) => web[c]?.tag ?? ""),
				nRest.map((c) => native[c]?.tag ?? ""),
			)) {
				const wc = wRest[i]
				const nc = nRest[j]
				if (wc !== undefined && nc !== undefined) {
					pair(wc, nc, "structure")
					changed = true
				}
			}
		}
		return changed
	}
	for (let rounds = 0; rounds < 50; rounds++) {
		while (bottomUp()) {
			// Repeat until no parent is left to infer.
		}
		if (!topDown()) break
	}
	return { webToNative, nativeToWeb, phase }
}

export interface Delta {
	readonly web: El
	readonly native: El
	readonly dx: number
	readonly dy: number
	readonly dw: number
	readonly dh: number
	/** Position error this element adds on top of its nearest matched ancestor's. */
	readonly ownDx: number
	readonly ownDy: number
	readonly ownDw: number
	readonly ownDh: number
	readonly score: number
	readonly ownScore: number
}

/** Drawn with a real box: 1x1 and smaller (sr-only) counts as not drawn. */
export const drawn = (rect: Rect | null): rect is Rect =>
	rect !== null && rect.w > 0 && rect.h > 0 && (rect.w > 1 || rect.h > 1)

/** The 1280x800 viewport; elements scrolled fully outside it on both sides are not compared. */
export const VIEWPORT: Rect = { x: 0, y: 0, w: 1280, h: 800 }
export const onScreen = (rect: Rect | null): rect is Rect =>
	drawn(rect) &&
	rect.x < VIEWPORT.x + VIEWPORT.w &&
	rect.x + rect.w > VIEWPORT.x &&
	rect.y < VIEWPORT.y + VIEWPORT.h &&
	rect.y + rect.h > VIEWPORT.y

export const deltas = (web: ReadonlyArray<El>, native: ReadonlyArray<El>, matching: Matching) => {
	const raw = new Map<number, { dx: number; dy: number; dw: number; dh: number }>()
	const out: Array<Delta> = []
	for (const w of web) {
		const n = native[matching.webToNative.get(w.index) ?? -1]
		if (n === undefined || !drawn(w.rect) || n.rect === null) continue
		if (!onScreen(w.rect) && !onScreen(n.rect)) continue
		const d = {
			dx: n.rect.x - w.rect.x,
			dy: n.rect.y - w.rect.y,
			dw: n.rect.w - w.rect.w,
			dh: n.rect.h - w.rect.h,
		}
		raw.set(w.index, d)
		let p = w.parent
		while (p >= 0 && !raw.has(p)) p = web[p]?.parent ?? -1
		const parent = raw.get(p) ?? { dx: 0, dy: 0, dw: 0, dh: 0 }
		const own = {
			ownDx: d.dx - parent.dx,
			ownDy: d.dy - parent.dy,
			// A child that fills its parent inherits the parent's size error, so take the smaller.
			ownDw: Math.abs(d.dw - parent.dw) < Math.abs(d.dw) ? d.dw - parent.dw : d.dw,
			ownDh: Math.abs(d.dh - parent.dh) < Math.abs(d.dh) ? d.dh - parent.dh : d.dh,
		}
		out.push({
			web: w,
			native: n,
			...d,
			...own,
			score: Math.max(Math.abs(d.dx), Math.abs(d.dy), Math.abs(d.dw), Math.abs(d.dh)),
			ownScore: Math.max(
				Math.abs(own.ownDx),
				Math.abs(own.ownDy),
				Math.abs(own.ownDw),
				Math.abs(own.ownDh),
			),
		})
	}
	return out
}

const quantile = (values: ReadonlyArray<number>, q: number) => {
	const sorted = [...values].sort((a, b) => a - b)
	if (sorted.length === 0) return Number.NaN
	return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))] ?? Number.NaN
}

const pct = (values: ReadonlyArray<number>, limit: number) =>
	values.length === 0 ? Number.NaN : round((100 * values.filter((v) => v <= limit).length) / values.length)

export const round = (value: number) => Math.round(value * 100) / 100

export const summarize = (items: ReadonlyArray<Delta>) => {
	const pos = items.map((d) => Math.max(Math.abs(d.dx), Math.abs(d.dy)))
	const size = items.map((d) => Math.max(Math.abs(d.dw), Math.abs(d.dh)))
	const axis = (pick: (d: Delta) => number) =>
		round(
			quantile(
				items.map((d) => Math.abs(pick(d))),
				0.5,
			),
		)
	return {
		count: items.length,
		posWithin1Pct: pct(pos, 1),
		posWithin4Pct: pct(pos, 4),
		sizeWithin1Pct: pct(size, 1),
		sizeWithin4Pct: pct(size, 4),
		posMedian: round(quantile(pos, 0.5)),
		posP95: round(quantile(pos, 0.95)),
		sizeMedian: round(quantile(size, 0.5)),
		sizeP95: round(quantile(size, 0.95)),
		medianAbs: {
			dx: axis((d) => d.dx),
			dy: axis((d) => d.dy),
			dw: axis((d) => d.dw),
			dh: axis((d) => d.dh),
		},
	}
}

export type Summary = ReturnType<typeof summarize>
