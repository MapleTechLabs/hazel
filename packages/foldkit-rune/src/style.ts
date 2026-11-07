// Resolves Tailwind class lists to plain computed styles with Tailwind's own compiler and the
// app's real stylesheet (theme tokens, light/dark, breakpoints). The native host never sees a
// class name: it gets px numbers, colours and a handful of enums.
import { compile } from "@tailwindcss/node"
import postcss from "postcss"
import { readFile } from "node:fs/promises"
import { Scanner } from "@tailwindcss/oxide"

type Decl = { prop: string; value: string }
type AttrCond = Array<[string, string | null]>
type Cond = { attrs: AttrCond; tag?: string; cls?: string; notClassContains?: string; prev?: AttrCond }
type Mode = "base" | "hover" | "groupHover"
/** A rule on the element that carries the class. */
type Rule = {
	order: number
	mode: Mode
	dark: boolean
	minWidth: number
	when: AttrCond
	has?: Cond
	childGap: boolean
	decls: Array<Decl>
}
/** A rule a class pushes onto its children (`*:`) or descendants (`**:`, `[&_…]`). */
type Scoped = {
	id: number
	order: number
	rel: "child" | "desc"
	originHover: boolean
	dark: boolean
	minWidth: number
	target: Cond
	decls: Array<Decl>
}

/** What an element passes down: inherited custom properties and the scoped rules in force. */
export type Scope = { id: number; vars: Map<string, string>; child: Array<Scoped>; desc: Array<Scoped> }

export type ElementInput = {
	classes: ReadonlyArray<string>
	attrs: Record<string, string>
	/** `h.Style` declarations: applied after every class rule, as inline styles are. */
	inline?: Record<string, string>
	prevAttrs?: Record<string, string>
	hasDescendant: (cond: Cond) => boolean
}

export type Px = number | "full" | "auto"
export type Style = {
	display?: "flex" | "block" | "inline" | "grid" | "none" | "contents"
	dir?: "row" | "col"
	wrap?: boolean
	gapRow?: number
	gapCol?: number
	childGap?: number
	pad?: [number, number, number, number]
	margin?: [number, number, number, number]
	w?: Px
	h?: Px
	minW?: number
	minH?: number
	maxW?: number
	grow?: number
	shrink?: number
	items?: string
	justify?: string
	self?: string
	bg?: string
	hoverBg?: string
	color?: string
	hoverColor?: string
	border?: [number, number, number, number]
	borderColor?: string
	radius?: [number, number, number, number]
	fontSize?: number
	lineHeight?: number
	fontWeight?: number
	opacity?: number
	scrollY?: boolean
	clip?: boolean
	truncate?: boolean
	nowrap?: boolean
	/** `inline`, `inline-flex`, `inline-block`: flows within its line rather than starting one. */
	inline?: boolean
	absolute?: [number | null, number | null, number | null, number | null]
	gridCols?: Array<string>
	colSpanFull?: boolean
	subgrid?: boolean
	textAlign?: string
	hoverGroup?: boolean
	centerY?: boolean
	/** Resolution scratch: whether insets apply. Never sent. */
	position?: "absolute" | "static"
	groupOpacity?: number
}

const REM = 16
/** The window, for viewport units: set by the resolver before each resolution. */
const viewportSize = { width: 1280, height: 800 }

/** The page's own background and text colour. */
type PageStyle = { bg?: string; color?: string }

export class StyleResolver {
	private rules = new Map<string, Array<Rule>>()
	private scoped = new Map<string, Array<Scoped>>()
	private vars = { light: new Map<string, string>(), dark: new Map<string, string>() }
	private known = new Set<string>()
	/** Declarations on `html` and `body`: the page behind the app's root element. */
	private pageDecls: Array<Decl> = []
	private hasRuleClasses = new Set<string>()
	private scopes = new Map<string, Scope>()
	private resolved = new Map<string, { style: Style; scope: Scope }>()
	private nextScopedId = 0
	/** Never reset: a Scope held across a re-parse must not collide with a new one in the cache. */
	private nextScopeId = 0
	readonly unsupportedClasses = new Map<string, number>()
	readonly unsupportedProps = new Map<string, number>()

	private constructor(private compiler: Awaited<ReturnType<typeof compile>>) {}

	/**
	 * Compiles the stylesheet and, like Tailwind's build, scans its `@source` files for every class
	 * the app can use, so a commit that shows new markup never waits on a rebuild.
	 */
	static async load(stylesheet: string): Promise<StyleResolver> {
		const base = stylesheet.slice(0, stylesheet.lastIndexOf("/") + 1)
		const css = await readFile(stylesheet, "utf8")
		const compiler = await compile(css, { base, from: stylesheet, onDependency() {} })
		const resolver = new StyleResolver(compiler)
		const sources = [...compiler.sources]
		if (compiler.root !== null && compiler.root !== "none")
			sources.push({ ...compiler.root, negated: false })
		if (sources.length > 0) resolver.ensure(new Scanner({ sources }).scan())
		return resolver
	}

	/** Make sure every class in `classes` has compiled rules; rebuilds the sheet when new ones appear. */
	ensure(classes: Iterable<string>) {
		let added = false
		for (const c of classes)
			if (!this.known.has(c)) {
				this.known.add(c)
				added = true
			}
		if (!added && this.rules.size > 0) return
		this.parse(this.compiler.build([...this.known]))
	}

	rootScope(dark: boolean): Scope {
		return this.intern(`root:${dark}`, () => ({
			vars: dark ? new Map([...this.vars.light, ...this.vars.dark]) : new Map(this.vars.light),
			child: [],
			desc: [],
		}))
	}

	/** The page's own background and text colour, from the stylesheet's `html`/`body` rules. */
	pageStyle(dark: boolean): PageStyle {
		const style: Style = {}
		const vars = this.rootScope(dark).vars
		for (const d of this.pageDecls) this.apply(style, d, vars, false, "base")
		const page: PageStyle = {}
		if (style.bg !== undefined) page.bg = style.bg
		if (style.color !== undefined) page.color = style.color
		return page
	}

	/** One Scope object per distinct (parent, local vars, scoped rules): the id keys the style cache. */
	private intern(key: string, make: () => Omit<Scope, "id">): Scope {
		const existing = this.scopes.get(key)
		if (existing) return existing
		const scope = { id: ++this.nextScopeId, ...make() }
		this.scopes.set(key, scope)
		return scope
	}

	private parse(css: string) {
		this.rules.clear()
		this.scoped.clear()
		this.pageDecls = []
		this.hasRuleClasses.clear()
		this.scopes.clear()
		this.resolved.clear()
		this.vars = { light: new Map(), dark: new Map() }
		let order = 0
		postcss.parse(css).walkRules((rule: any) => {
			order += 1
			const decls: Array<Decl> = []
			rule.each((node: any) => {
				if (node.type === "decl") decls.push({ prop: node.prop, value: node.value })
				// `@supports (color-mix…)` nests the preferred value inside the rule.
				if (node.type === "atrule" && node.name === "supports")
					node.walkDecls((d: any) => decls.push({ prop: d.prop, value: d.value }))
			})
			let minWidth = 0
			for (let p = rule.parent; p && p.type !== "root"; p = p.parent) {
				if (p.type === "rule") return
				if (p.type !== "atrule") continue
				if (p.name === "media") {
					const m = /width\s*>=\s*([\d.]+)(rem|px)/.exec(p.params)
					if (m) minWidth = Number(m[1]) * (m[2] === "rem" ? REM : 1)
					else if (!/hover:\s*hover/.test(p.params)) return
				} else if (p.name !== "layer" && p.name !== "supports") {
					return // @starting-style, @container, …: enter animations and container queries, not modelled yet
				}
			}
			for (const raw of rule.selectors as Array<string>)
				this.addSelector(raw.trim(), order, minWidth, decls)
		})
	}

	private addSelector(selector: string, order: number, minWidth: number, decls: Array<Decl>) {
		if (selector === ":root" || selector === ":host") {
			for (const d of decls) if (d.prop.startsWith("--")) this.vars.light.set(d.prop, d.value)
			return
		}
		if (selector === "html" || selector === "body" || selector === "html, body") {
			this.pageDecls.push(...decls.filter((d) => d.prop === "background-color" || d.prop === "color"))
			return
		}
		if (selector === ".dark") {
			for (const d of decls) if (d.prop.startsWith("--")) this.vars.dark.set(d.prop, d.value)
			return
		}
		let dark = false
		let sel = selector
		if (sel.includes(":is(.dark *)")) {
			dark = true
			sel = sel.replace(":is(.dark *)", "")
		}
		const CLS = "((?:\\\\.|[^\\s:.\\[\\]>#\\\\()*])+)"
		const unescape = (c: string) => c.replace(/\\(.)/g, "$1")
		const ATTRS = /^((?:\[[\w-]+(?:="?[^\]"]*"?)?\])*)/
		const attrs = (text: string): AttrCond =>
			[...text.matchAll(/\[([\w-]+)(?:="?([^\]"]*)"?)?\]/g)].map(
				(m) => [m[1], m[2] ?? null] as [string, string | null],
			)
		// space-y / space-x: margins between children, which become a gap on the container.
		let m = new RegExp(`^:where\\(\\.${CLS} > :not\\(:last-child\\)\\)$`).exec(sel)
		if (m)
			return this.push(this.rules, unescape(m[1]), {
				order,
				mode: "base",
				dark,
				minWidth,
				when: [],
				childGap: true,
				decls,
			})
		// *:x, **:x and hover:**:x: rules a class applies to its children or descendants.
		m = new RegExp(`^:is\\(\\.${CLS}(:hover)?( >)? \\*\\)((?:\\[[^\\]]+\\])+)$`).exec(sel)
		if (m)
			return this.push(this.scoped, unescape(m[1]), {
				id: 0,
				order,
				rel: m[3] ? "child" : "desc",
				originHover: m[2] !== undefined,
				dark,
				minWidth,
				target: { attrs: attrs(m[4]) },
				decls,
			})
		// [&_[attr]:not([class*='x'])] and [&>[attr]]: arbitrary descendant / child variants.
		m = new RegExp(`^\\.${CLS} (> )?((?:\\[[^\\]]+\\])+)(?::not\\(\\[class\\*='([^']+)'\\]\\))?$`).exec(
			sel,
		)
		if (m)
			return this.push(this.scoped, unescape(m[1]), {
				id: 0,
				order,
				rel: m[2] ? "child" : "desc",
				originHover: false,
				dark,
				minWidth,
				target: { attrs: attrs(m[3]), notClassContains: m[4] },
				decls,
			})
		// [&>[a]+[b]]: a child right after a sibling.
		m = new RegExp(`^\\.${CLS} > ((?:\\[[^\\]]+\\])+) \\+ ((?:\\[[^\\]]+\\])+)$`).exec(sel)
		if (m)
			return this.push(this.scoped, unescape(m[1]), {
				id: 0,
				order,
				rel: "child",
				originHover: false,
				dark,
				minWidth,
				target: { attrs: attrs(m[3]), prev: attrs(m[2]) },
				decls,
			})
		// [&_.x]: descendants carrying class x.
		m = new RegExp(`^\\.${CLS} \\.([\\w-]+)$`).exec(sel)
		if (m)
			return this.push(this.scoped, unescape(m[1]), {
				id: 0,
				order,
				rel: "desc",
				originHover: false,
				dark,
				minWidth,
				target: { attrs: [], cls: m[2] },
				decls,
			})
		// group-hover/x: when the named group ancestor is hovered (opacity only, as Rune's hover_group).
		m = new RegExp(`^\\.${CLS}:is\\(:where\\(\\.group(?:\\\\/[\\w-]+)?\\):hover \\*\\)$`).exec(sel)
		if (m)
			return this.push(this.rules, unescape(m[1]), {
				order,
				mode: "groupHover",
				dark,
				minWidth,
				when: [],
				childGap: false,
				decls,
			})
		m = new RegExp(`^\\.${CLS}(.*)$`).exec(sel)
		if (!m) return
		const cls = unescape(m[1])
		let suffix = m[2]
		let mode: Mode = "base"
		let has: Cond | undefined
		// ATTRS matches any string: its only group may match empty.
		const own = ATTRS.exec(suffix)?.[1] ?? ""
		suffix = suffix.slice(own.length)
		if (suffix.startsWith(":hover")) {
			mode = "hover"
			suffix = suffix.slice(6)
		}
		const hasMatch = /^:has\(:is\(([a-z][a-z0-9]*)?((?:\[[^\]]+\])*)\)\)/.exec(suffix)
		if (hasMatch) {
			has = { attrs: attrs(hasMatch[2] ?? "") }
			if (hasMatch[1] !== undefined) has.tag = hasMatch[1]
			suffix = suffix.slice(hasMatch[0].length)
		}
		if (suffix !== "") return this.bump(this.unsupportedClasses, cls)
		this.push(this.rules, cls, {
			order,
			mode,
			dark,
			minWidth,
			when: attrs(own),
			has,
			childGap: false,
			decls,
		})
	}

	private push<T>(map: Map<string, Array<T>>, cls: string, rule: T) {
		if (map === (this.scoped as unknown)) Object.assign(rule as object, { id: ++this.nextScopedId })
		if ((rule as { has?: unknown }).has !== undefined) this.hasRuleClasses.add(cls)
		const list = map.get(cls) ?? []
		list.push(rule)
		map.set(cls, list)
	}

	private bump(map: Map<string, number>, key: string) {
		map.set(key, (map.get(key) ?? 0) + 1)
	}

	/** Computes one element's style in its scope and the scope its children inherit. */
	/** The window size viewport units (`vh`, `dvh`, `svh`, `vw`) resolve against. */
	setViewport(width: number, height: number) {
		viewportSize.width = width
		viewportSize.height = height
	}

	resolve(el: ElementInput, scope: Scope, dark: boolean, viewport: number): { style: Style; scope: Scope } {
		const usesPrev = scope.child.some((r) => r.target.prev !== undefined)
		// `:has()` depends on descendants, so its outcome is part of the cache key.
		let hasBits = ""
		for (const cls of el.classes) {
			if (!this.hasRuleClasses.has(cls)) continue
			for (const r of this.rules.get(cls) ?? [])
				if (r.has) hasBits += el.hasDescendant(r.has) ? "1" : "0"
		}
		const key = `${scope.id}|${dark ? 1 : 0}|${viewport}x${viewportSize.height}|${el.classes.join(" ")}|${attrsKey(el.attrs)}|${
			usesPrev ? attrsKey(el.prevAttrs ?? {}) : ""
		}|${hasBits}|${el.inline === undefined ? "" : JSON.stringify(el.inline)}`
		const cached = this.resolved.get(key)
		if (cached) return cached
		const result = this.compute(el, scope, dark, viewport)
		this.resolved.set(key, result)
		return result
	}

	private compute(
		el: ElementInput,
		scope: Scope,
		dark: boolean,
		viewport: number,
	): { style: Style; scope: Scope } {
		const matches = (when: AttrCond) =>
			when.every(([n, v]) => (v === null ? n in el.attrs : el.attrs[n] === v))
		const live = (r: { dark: boolean; minWidth: number }) => (!r.dark || dark) && r.minWidth <= viewport
		const picked: Array<{ order: number; mode: Mode; childGap: boolean; decls: Array<Decl> }> = []
		let hoverGroup = false
		const child: Array<Scoped> = []
		const desc = [...scope.desc]
		for (const cls of el.classes) {
			const rules = this.rules.get(cls)
			const scoped = this.scoped.get(cls)
			if (!rules && !scoped && !this.unsupportedClasses.has(cls))
				this.bump(this.unsupportedClasses, cls)
			for (const r of rules ?? []) {
				if (!live(r) || !matches(r.when)) continue
				if (r.has && !el.hasDescendant(r.has)) continue
				picked.push(r)
			}
			for (const r of scoped ?? []) {
				if (!live(r)) continue
				;(r.rel === "child" ? child : desc).push(r)
				if (r.originHover) hoverGroup = true
			}
		}
		const { prevAttrs } = el
		const prevMatches = (prev: AttrCond) =>
			prevAttrs !== undefined &&
			prev.every(([n, v]) => (v === null ? n in prevAttrs : prevAttrs[n] === v))
		for (const r of [...scope.child, ...scope.desc]) {
			const t = r.target
			if (!matches(t.attrs) || (t.cls !== undefined && !el.classes.includes(t.cls))) continue
			const excluded = t.notClassContains
			if (excluded !== undefined && el.classes.some((c) => c.includes(excluded))) continue
			if (t.prev !== undefined && !prevMatches(t.prev)) continue
			picked.push({
				order: r.order,
				mode: r.originHover ? "groupHover" : "base",
				childGap: false,
				decls: r.decls,
			})
		}
		picked.sort((a, b) => a.order - b.order)
		// Custom properties first: set on this element, visible to its own declarations and inherited.
		const local = new Map<string, string>()
		for (const r of picked)
			if (r.mode === "base")
				for (const d of r.decls) if (d.prop.startsWith("--")) local.set(d.prop, d.value)
		const inline = Object.entries(el.inline ?? {})
		for (const [prop, value] of inline) if (prop.startsWith("--")) local.set(prop, value)
		const vars = new Map([...scope.vars, ...local])
		for (const [k, v] of local) vars.set(k, substitute(v, vars))
		const style: Style = {}
		for (const r of picked) for (const d of r.decls) this.apply(style, d, vars, r.childGap, r.mode)
		// Insets place an element only when it is taken out of flow (`sticky` and `relative` stay in it).
		if (style.position !== "absolute") delete style.absolute
		delete style.position
		for (const [prop, value] of inline) this.apply(style, { prop, value }, vars, false, "base")
		if (hoverGroup || el.classes.some((c) => c === "group" || c.startsWith("group/")))
			style.hoverGroup = true
		const childScope = this.intern(
			`${scope.id}|${[...local].map(([k, v]) => `${k}:${v}`).join(";")}|${child.map((r) => r.id).join(",")}|${desc
				.slice(scope.desc.length)
				.map((r) => r.id)
				.join(",")}`,
			() => ({ vars, child, desc }),
		)
		return { style, scope: childScope }
	}

	private apply(s: Style, d: Decl, vars: Map<string, string>, childGap: boolean, mode: Mode) {
		if (d.prop.startsWith("--")) return
		const v = substitute(d.value, vars)
		const len = () => length(v)
		const num = () => {
			const n = length(v)
			return typeof n === "number" ? n : 0
		}
		const sides = (key: "pad" | "margin" | "border", idx: Array<number>) => {
			const cur = s[key] ?? [0, 0, 0, 0]
			for (const i of idx) cur[i] = num()
			s[key] = cur
		}
		if (childGap) {
			if (d.prop === "margin-block-end" || d.prop === "margin-inline-end") s.childGap = num()
			return
		}
		if (mode === "groupHover") {
			if (d.prop === "opacity")
				s.groupOpacity = v.endsWith("%") ? Number(v.slice(0, -1)) / 100 : Number(v)
			return
		}
		if (mode === "hover") {
			if (d.prop === "background-color") s.hoverBg = color(v) ?? undefined
			else if (d.prop === "color") s.hoverColor = color(v) ?? undefined
			return
		}
		switch (d.prop) {
			case "display":
				s.inline = v.startsWith("inline")
				s.display =
					v === "contents"
						? "contents"
						: v === "flex" || v === "inline-flex"
							? "flex"
							: v === "grid" || v === "inline-grid"
								? "grid"
								: v === "none"
									? "none"
									: v.startsWith("inline")
										? "inline"
										: "block"
				break
			case "flex-direction":
				s.dir = v.startsWith("column") ? "col" : "row"
				break
			case "flex-wrap":
				s.wrap = v === "wrap"
				break
			case "gap":
				s.gapRow = num()
				s.gapCol = num()
				break
			case "row-gap":
				s.gapRow = num()
				break
			case "column-gap":
				s.gapCol = num()
				break
			case "padding":
				sides("pad", [0, 1, 2, 3])
				break
			case "padding-inline":
				sides("pad", [1, 3])
				break
			case "padding-block":
				sides("pad", [0, 2])
				break
			case "padding-top":
				sides("pad", [0])
				break
			case "padding-right":
			case "padding-inline-end":
				sides("pad", [1])
				break
			case "padding-bottom":
				sides("pad", [2])
				break
			case "padding-left":
			case "padding-inline-start":
				sides("pad", [3])
				break
			case "margin":
				sides("margin", [0, 1, 2, 3])
				break
			case "margin-inline":
				sides("margin", [1, 3])
				break
			case "margin-block":
				sides("margin", [0, 2])
				break
			case "margin-top":
				sides("margin", [0])
				break
			case "margin-right":
			case "margin-inline-end":
				sides("margin", [1])
				break
			case "margin-bottom":
				sides("margin", [2])
				break
			case "margin-left":
			case "margin-inline-start":
				sides("margin", [3])
				break
			case "width":
				s.w = len()
				break
			case "height":
				s.h = len()
				break
			case "min-width":
				s.minW = num()
				break
			case "min-height":
				s.minH = num()
				break
			case "max-width":
				if (typeof len() === "number") s.maxW = num()
				break
			case "flex": {
				const [g, sh] = v.split(/\s+/)
				s.grow = Number(g) || 0
				s.shrink = Number(sh ?? 1)
				break
			}
			case "flex-grow":
				s.grow = Number(v)
				break
			case "flex-shrink":
				s.shrink = Number(v)
				break
			case "align-items":
				s.items = v
				break
			case "justify-content":
				s.justify = v
				break
			case "align-self":
				s.self = v
				break
			case "background-color":
				s.bg = color(v) ?? undefined
				break
			case "color":
				s.color = color(v) ?? undefined
				break
			case "border-width":
				sides("border", [0, 1, 2, 3])
				break
			case "border-top-width":
				sides("border", [0])
				break
			case "border-right-width":
				sides("border", [1])
				break
			case "border-bottom-width":
				sides("border", [2])
				break
			case "border-left-width":
				sides("border", [3])
				break
			case "border-color":
			case "border-right-color":
			case "border-bottom-color":
			case "border-top-color":
			case "border-left-color":
				s.borderColor = color(v) ?? s.borderColor
				break
			case "border-radius": {
				const r = num()
				s.radius = [r, r, r, r]
				break
			}
			case "border-top-left-radius":
			case "border-top-right-radius":
			case "border-bottom-right-radius":
			case "border-bottom-left-radius": {
				const r = s.radius ?? [0, 0, 0, 0]
				r[
					[
						"border-top-left-radius",
						"border-top-right-radius",
						"border-bottom-right-radius",
						"border-bottom-left-radius",
					].indexOf(d.prop)
				] = num()
				s.radius = r
				break
			}
			case "font-size":
				s.fontSize = num()
				break
			case "line-height": {
				// Unitless (often `calc(1.25 / 0.875)`) is a multiple of the font size.
				const unitless = !/(px|rem|em)\b/.test(v)
				s.lineHeight = unitless ? num() * (s.fontSize ?? 16) : num()
				break
			}
			case "inset-block":
			case "top":
				if ((v.includes("100%") && v.includes("1/2")) || v.trim() === "50%") {
					s.absolute = s.absolute ?? [null, null, null, null]
					s.centerY = true
					break
				}
				{
					const a = s.absolute ?? [null, null, null, null]
					a[1] = num()
					if (d.prop === "inset-block") a[3] = num()
					s.absolute = a
				}
				break
			case "inset-inline": {
				const a = s.absolute ?? [null, null, null, null]
				a[0] = num()
				a[2] = num()
				s.absolute = a
				break
			}
			case "translate":
				break
			case "font-weight":
				s.fontWeight = Number(v) || 400
				break
			case "opacity":
				s.opacity = v.endsWith("%") ? Number(v.slice(0, -1)) / 100 : Number(v)
				break
			case "overflow":
			case "overflow-y":
				if (v === "auto" || v === "scroll") s.scrollY = true
				else if (v === "hidden" || v === "clip") s.clip = true
				break
			case "overflow-x":
				if (v === "hidden" || v === "clip") s.clip = true
				break
			case "text-overflow":
				if (v === "ellipsis") s.truncate = true
				break
			// `sr-only`: screen-reader text, never drawn.
			case "clip-path":
				if (v.replace(/\s/g, "") === "inset(50%)") s.display = "none"
				break
			case "position":
				s.position = v === "absolute" || v === "fixed" ? "absolute" : "static"
				if (s.position === "absolute") s.absolute = s.absolute ?? [null, null, null, null]
				break
			case "inset": {
				const n = num()
				s.absolute = [n, n, n, n]
				break
			}
			case "right":
			case "bottom":
			case "left": {
				const a = s.absolute ?? [null, null, null, null]
				a[["left", "top", "right", "bottom"].indexOf(d.prop)] = num()
				s.absolute = a
				break
			}
			case "grid-template-columns":
				if (v === "subgrid") s.subgrid = true
				else s.gridCols = expandRepeat(v)
				break
			case "grid-column":
				if (v === "1 / -1") s.colSpanFull = true
				else this.bump(this.unsupportedProps, `grid-column: ${v}`)
				break
			case "text-align":
				s.textAlign = v
				break
			// Paint-free or cosmetic in this renderer; not worth a warning.
			case "white-space":
				if (v === "nowrap" || v === "pre") s.nowrap = true
				break
			case "border-style":
			case "border-right-style":
			case "border-bottom-style":
			case "border-top-style":
			case "border-left-style":
			case "outline-style":
			case "cursor":
			case "user-select":
			case "-webkit-font-smoothing":
			case "-moz-osx-font-smoothing":
			case "font-family":
			case "touch-action":
			case "transition-property":
			case "transition-timing-function":
			case "transition-duration":
			case "pointer-events":
				break
			default:
				this.bump(this.unsupportedProps, d.prop)
		}
	}
}

function expandRepeat(v: string): Array<string> {
	const rep = /^repeat\((\d+),\s*(.+)\)$/.exec(v)
	if (rep) return Array.from({ length: Number(rep[1]) }, () => rep[2].replace(/minmax\(0,\s*(.+)\)/, "$1"))
	return v.split(/\s+/)
}

/** Replaces `var(--x, fallback)`, fallbacks may nest parentheses and further `var()`s. */
export function substitute(value: string, vars: Map<string, string>, depth = 0): string {
	if (depth > 12) return value
	let out = ""
	let i = 0
	for (let at = value.indexOf("var(", i); at >= 0; at = value.indexOf("var(", i)) {
		out += value.slice(i, at)
		let level = 0
		let comma = -1
		let end = at + 4
		for (; end < value.length; end++) {
			const ch = value[end]
			if (ch === "(") level++
			else if (ch === ")") {
				if (level === 0) break
				level--
			} else if (ch === "," && level === 0 && comma < 0) comma = end
		}
		const name = value.slice(at + 4, comma < 0 ? end : comma).trim()
		const fallback = comma < 0 ? "" : value.slice(comma + 1, end).trim()
		const found = vars.get(name)
		out += substitute(found !== undefined && found !== "" ? found : fallback, vars, depth + 1)
		i = end + 1
	}
	return out + value.slice(i)
}

/** A CSS length to px, `'full'` for 100%, `'auto'` otherwise. */
function length(v: string): Px {
	const t = v.trim()
	if (t === "100%") return "full"
	if (t === "auto" || t.endsWith("%") || t === "fit-content" || t === "max-content" || t === "min-content")
		return "auto"
	const n = evalCalc(t)
	return n === null ? "auto" : n
}

const unitPx = (unit: string | undefined): number => {
	if (unit === undefined || unit === "px") return 1
	if (unit === "rem" || unit === "em") return REM
	return (unit.endsWith("h") ? viewportSize.height : viewportSize.width) / 100
}

function evalCalc(expr: string): number | null {
	const src = expr
		.replace(/calc\(/g, "(")
		.replace(/infinity/g, "99999")
		.replace(/(-?\d*\.?\d+)(rem|em|px|[dsl]?v[hw])?/g, (_, n: string, unit?: string) =>
			String(Number(n) * unitPx(unit)),
		)
	if (!/^[\d.\s+\-*/()]+$/.test(src)) return null
	let i = 0
	const peek = () => {
		while (src[i] === " ") i++
		return src[i]
	}
	const atom = (): number => {
		const c = peek()
		if (c === "(") {
			i++
			const v = sum()
			peek()
			i++
			return v
		}
		if (c === "-") {
			i++
			return -atom()
		}
		const m = /^\d*\.?\d+/.exec(src.slice(i))
		if (!m) throw new Error("calc")
		i += m[0].length
		return Number(m[0])
	}
	const product = (): number => {
		let v = atom()
		for (let c = peek(); c === "*" || c === "/"; c = peek()) {
			i++
			v = c === "*" ? v * atom() : v / atom()
		}
		return v
	}
	const sum = (): number => {
		let v = product()
		for (let c = peek(); c === "+" || c === "-"; c = peek()) {
			i++
			v = c === "+" ? v + product() : v - product()
		}
		return v
	}
	try {
		return sum()
	} catch {
		return null
	}
}

/** CSS colour to `#rrggbbaa` (sRGB), or null for currentColor / unknown. */
export function color(v: string): string | null {
	const t = v.trim().toLowerCase()
	if (t === "transparent") return "#00000000"
	const mix = /^color-mix\(in [a-z]+,\s*(.+?)\s+([\d.]+)%,\s*transparent\)$/.exec(t)
	if (mix) {
		const inner = color(mix[1])
		if (!inner) return null
		const a = (parseInt(inner.slice(7, 9), 16) / 255) * (Number(mix[2]) / 100)
		return inner.slice(0, 7) + hex2(a)
	}
	if (t.startsWith("#")) {
		const h = t.slice(1)
		const full = h.length <= 4 ? [...h].map((c) => c + c).join("") : h
		return "#" + (full.length === 6 ? full + "ff" : full)
	}
	const fn = /^(rgba?|oklch|oklab)\((.*)\)$/.exec(t)
	if (!fn) return null
	const [main, alphaPart] = fn[2].split("/")
	const parts = main.trim().split(/[\s,]+/)
	const alpha = alphaPart === undefined ? (parts.length === 4 ? pct(parts[3]) : 1) : pct(alphaPart.trim())
	if (fn[1].startsWith("rgb")) {
		return (
			"#" +
			parts
				.slice(0, 3)
				.map((p) => hex2(pct(p, 255) / 255))
				.join("") +
			hex2(alpha)
		)
	}
	let L = pct(parts[0])
	let a: number
	let b: number
	if (fn[1] === "oklch") {
		const C = Number(parts[1])
		const H = (Number(parts[2]) || 0) * (Math.PI / 180)
		a = C * Math.cos(H)
		b = C * Math.sin(H)
	} else {
		a = Number(parts[1])
		b = Number(parts[2])
	}
	const l_ = L + 0.3963377774 * a + 0.2158037573 * b
	const m_ = L - 0.1055613458 * a - 0.0638541728 * b
	const s_ = L - 0.0894841775 * a - 1.291485548 * b
	const [l, m, s] = [l_ ** 3, m_ ** 3, s_ ** 3]
	const lin = [
		4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
		-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
		-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
	]
	const gamma = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055)
	return "#" + lin.map((x) => hex2(gamma(Math.min(1, Math.max(0, x))))).join("") + hex2(alpha)
}

function pct(p: string, scale = 1): number {
	return p.endsWith("%") ? (Number(p.slice(0, -1)) / 100) * scale : Number(p)
}

function hex2(x: number): string {
	return Math.round(Math.min(1, Math.max(0, x)) * 255)
		.toString(16)
		.padStart(2, "0")
}

/** Attributes that can select styles; `value` changes on every keystroke and selects nothing. */
const attrsKey = (attrs: Record<string, string>): string => {
	let key = ""
	for (const name in attrs) if (name !== "value") key += `${name}=${attrs[name]};`
	return key
}
