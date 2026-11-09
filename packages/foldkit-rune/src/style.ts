// Resolves Tailwind class lists to plain computed styles with Tailwind's own compiler and the
// app's real stylesheet (theme tokens, light/dark, breakpoints). The native host never sees a
// class name: it gets px numbers, colours and a handful of enums.
import type { compile } from "@tailwindcss/node"
import postcss, { type AtRule, type ChildNode, type Container, type Document } from "postcss"
import { readFile } from "node:fs/promises"

import { color } from "./css-color"
import { type AttrTest, type Compound, type Context, Unsupported, parseSelectorList } from "./selector"

export { color } from "./css-color"

type Decl = { prop: string; value: string; important: boolean }

/** When a rule applies beyond its selector: viewport and container bounds. */
type Gate = {
	minWidth: number
	/** Exclusive upper bound (`width < N`); Infinity when none. */
	maxWidth: number
	container?: { name: string; minWidth: number; maxWidth: number }
}

type RuleBody = Gate & { id: number; order: number; decls: Array<Decl> }
/** A rule whose subject carries its anchor class (or a tag / universal rule). */
type ElementRule = RuleBody & { subject: Compound }
/** A rule anchored on an ancestor: matched step by step down the tree (`*:x`, `[&_x]`, `**:x`). */
type ChainRule = RuleBody & {
	anchor: Compound
	steps: Array<{ rel: "child" | "desc"; compound: Compound }>
	/** `space-x/y`: margins between children, sent as the container's gap. */
	childGap: boolean
}
type Pending = { rule: ChainRule; step: number; rel: "child" | "desc"; originHover: boolean }
type Mode = "base" | "hover" | "groupHover"

/** A registered context condition (`.group[data-x] *`, `.parent > *`): matched against ancestors. */
type Condition = { id: number; comb: Context["comb"]; compound: Compound }

/** Inherited text properties the resolver needs to resolve `em`, `bolder` and `currentColor`. */
type LineSpec = { px: number } | { mult: number } | "normal"
type TextContext = { color: string; size: number; line: LineSpec; weight: number }
type Box = { w?: number; h?: number }
type ContainerBox = { names: Array<string>; w?: number; h?: number }

/** What an element passes down: inherited custom properties, pending chain rules, context. */
export type Scope = {
	id: number
	vars: Map<string, string>
	pending: Array<Pending>
	/** Condition ids an ancestor satisfies, and the ones the parent itself satisfies. */
	ancestors: ReadonlySet<number>
	parents: ReadonlySet<number>
	text: TextContext
	/** The parent's content box, when its size is known: `w-full` and container units read it. */
	box: Box
	containers: Array<ContainerBox>
	/** The parent is a flex or grid container: its children are blockified. */
	flexParent: boolean
}

/** Barely above zero: a screen-reader-only control the host must still let take focus. */
const SR_ONLY_OPACITY = 0.001

/** Reached by Tab: a control, a form field, a link, or `tabindex >= 0`. */
export const isTabStop = (el: { tag?: string; attrs: Readonly<Record<string, string>> }): boolean => {
	if ("disabled" in el.attrs) return false
	const tabIndex = el.attrs.tabindex
	if (tabIndex !== undefined) return Number(tabIndex) >= 0
	if (el.tag === "input") return el.attrs.type !== "hidden"
	return ["button", "select", "textarea"].includes(el.tag ?? "") || (el.tag === "a" && "href" in el.attrs)
}

/** Focusable at all: a Tab stop, or one script focuses (`tabindex="-1"`, a radio group's others). */
export const isFocusable = (el: { tag?: string; attrs: Readonly<Record<string, string>> }): boolean =>
	isTabStop(el) || (!("disabled" in el.attrs) && el.attrs.tabindex !== undefined)

/** An element as selectors see it: a sibling, a descendant or the element itself. */
export type NodeInfo = {
	tag: string
	classes: ReadonlyArray<string>
	attrs: Readonly<Record<string, string>>
	/** Position among the parent's element children, and how many there are. */
	index?: number
	count?: number
	/** No element children and no text (`:empty`). */
	empty?: boolean
	/** The dynamic states (`focus`, `active`…) taken as true; absent on every node but the subject. */
	states?: { has: (name: string) => boolean }
}

export type ElementInput = {
	tag?: string
	classes: ReadonlyArray<string>
	attrs: Record<string, string>
	/** `h.Style` declarations: applied after every class rule, as inline styles are. */
	inline?: Record<string, string>
	/** Element siblings before this one, nearest first. */
	prevSiblings?: ReadonlyArray<NodeInfo>
	index?: number
	count?: number
	empty?: boolean
	/** Whether a descendant (or, with `childrenOnly`, a child) matches. */
	hasDescendant: (match: (node: NodeInfo) => boolean, childrenOnly?: boolean) => boolean
}

/** px, all of the parent ("full"), a share of the parent's width (`w-1/2`), or no size. */
export type Px = number | "full" | "auto" | { frac: number }
export type Ring = { width: number; color: string; offset: number }
export type Animation =
	| { kind: "spin"; period: number }
	/** Opacity from `from` to `to` at mid-period and back, eased in and out. */
	| { kind: "pulse"; period: number; delay: number; from: number; to: number }
	/** Plays once on mount, from these values to the element's own (px, and a scale factor). */
	| { kind: "enter"; duration: number; delay: number; opacity: number; x: number; y: number; scale: number }
export type TransitionChannel = "colors" | "opacity" | "layout" | "transform"
/** Seconds, and the `cubic-bezier` control points (`linear` is `[0, 0, 1, 1]`). */
export type Timing = { duration: number; delay: number; ease: [number, number, number, number] }
export type Shadow = { x: number; y: number; blur: number; spread: number; color: string; inset: boolean }
export type Style = {
	display?: "flex" | "block" | "inline" | "grid" | "none" | "contents"
	dir?: "row" | "col"
	wrap?: boolean
	gapRow?: number
	gapCol?: number
	childGap?: number
	pad?: [number, number, number, number]
	margin?: [number, number, number, number]
	/** top right bottom left: the margin is `auto`. */
	marginAuto?: [boolean, boolean, boolean, boolean]
	w?: Px
	h?: Px
	/** px, or "full" for 100% of the parent. */
	minW?: number | "full"
	minH?: number | "full"
	maxW?: number | "full"
	maxH?: number | "full"
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
	/** `position: fixed`: placed against the window, not its parent (with `absolute`'s insets). */
	fixed?: boolean
	/** `grid-template-rows`, as written per track. */
	gridRows?: Array<string>
	/** `grid-row-start`: the row line a grid item starts at, 1 the first. */
	rowStart?: number
	/** `justify-items: center`: a grid centres each item across its cell. */
	justifyItems?: "center"
	colSpanFull?: boolean
	subgrid?: boolean
	/** CSS `text-align` as written (`left`, `center`, `right`, `justify`, `start`, `end`); inherited. */
	textAlign?: string
	hoverGroup?: boolean
	centerY?: boolean
	/** `left-1/2 -translate-x-1/2`: centred horizontally in its containing block. */
	centerX?: boolean
	/** `position: sticky; top: N`: held N px below the top of the scrolling viewport around it. */
	stickyTop?: number
	/** Resolution scratch: whether insets apply. Never sent. */
	position?: "absolute" | "sticky" | "static"
	groupOpacity?: number
	/** px, [dx, dy]: how far a positioned element moves while its group is hovered (an inset change). */
	groupShift?: [number, number]
	/** The final box-shadow list, rings included, in paint order (bottom-most first). */
	shadows?: Array<Shadow>
	/** Only when outline-style is not none and the outline is visible. */
	outline?: Ring
	/** The ring keyboard focus draws (`:focus-visible`); "none" when the author hid the outline. */
	focusRing?: Ring | "none"
	/** The ring while focus is on the element or in it, by pointer or keyboard (`:focus`, `:focus-within`). */
	focusWithinRing?: Ring
	/** Background while a press is held (`:active`). */
	pressBg?: string
	/** A keyframe animation the host can play: a rotation or opacity loop, or an entrance on mount. */
	animation?: Animation
	/** CSS transitions, by what the host animates separately; absent channels change at once. */
	transition?: Partial<Record<TransitionChannel, Timing>>
	/** `url` as written in the stylesheet; the host resolves it against the page. */
	bgImage?: { url: string } | { gradient: { angle: number; stops: Array<{ color: string; at: number }> } }
	objectFit?: "cover" | "contain" | "fill" | "none" | "scale-down"
	aspectRatio?: number
	fontFamily?: "sans" | "mono"
	italic?: boolean
	/** px */
	letterSpacing?: number
	textTransform?: "uppercase" | "lowercase" | "capitalize"
	textDecoration?: "underline" | "line-through"
	/** pre or pre-wrap: keep newlines and runs of spaces. */
	whiteSpacePre?: boolean
	visibility?: "hidden"
	/** `pointer-events`, inherited as CSS does: `none` takes no presses or hover here or below. */
	pointerEvents?: "none" | "auto"
	zIndex?: number
	/** px, from translate/transform translate only. */
	translate?: [number, number]
}

const REM = 16
/** The window, for viewport units and media queries: set by the resolver before each resolution. */
const viewportSize = { width: 1280, height: 800 }

/** The page's own background and text colour. */
type PageStyle = { bg?: string; color?: string }

/** Layer precedence: later wins; unlayered rules beat every layer. */
const LAYERS = ["ua", "properties", "theme", "base", "components", "utilities"]
const UNLAYERED = LAYERS.length

/** `html { line-height: 1.5 }` at 16px: the host's root text (layout.rs `Inherit`). */
const ROOT_TEXT: TextContext = { color: "#000000ff", size: 16, line: { mult: 1.5 }, weight: 400 }

/** One resolution's recorded dependence on the element beyond its classes and attributes. */
type Fact = { test: (el: ElementInput) => boolean; value: boolean }

export class StyleResolver {
	/** Element rules by anchor class; `*` holds tag and universal rules. */
	private rules = new Map<string, Array<ElementRule>>()
	private chains = new Map<string, Array<ChainRule>>()
	private conditions: Array<Condition> = []
	private conditionKeys = new Map<string, Condition>()
	private vars = { light: new Map<string, string>(), dark: new Map<string, string>() }
	/** `@property` initial values; `inherits: false` ones reset on every element. */
	private registered = new Map<string, { initial: string; inherits: boolean }>()
	private known = new Set<string>()
	/** Inline custom properties on `<html>`: the theme customization the app applies at runtime. */
	private rootProperties = new Map<string, string>()
	/** `@keyframes` by name: each frame's offsets (0 to 1) and declarations. */
	private keyframes = new Map<string, Array<{ at: Array<number>; decls: Array<Decl> }>>()
	private css = ""
	/** Declarations on `body`: the page behind the app's root element. */
	private pageDecls: Array<Decl> = []
	private scopes = new Map<string, Scope>()
	private resolved = new Map<
		string,
		Array<{ facts: Array<Fact>; result: { style: Style; scope: Scope } }>
	>()
	private nextRuleId = 0
	/** Never reset: a Scope held across a re-parse must not collide with a new one in the cache. */
	private nextScopeId = 0
	/**
	 * The attributes styles can depend on: those a selector tests anywhere, and the ones this
	 * resolver reads itself. The style cache keys on these alone, so an element's id or data does
	 * not make every element a cache miss.
	 */
	private referencedAttrs = new Set(["disabled", "href", "tabindex", "type"])
	/**
	 * Per attribute a selector tests, the tests made of it: a style can only see which of these
	 * pass, so the key records that rather than the value (an `#id` rule leaves ids unkeyed).
	 * The attributes the resolver reads itself key on their whole value.
	 */
	private attrTests = new Map<string, Array<AttrTest>>()
	readonly unsupportedClasses = new Map<string, number>()
	readonly unsupportedProps = new Map<string, number>()
	readonly unsupportedSelectors = new Map<string, number>()

	/** Null for a precompiled sheet until a class it lacks appears. */
	private compiler: Compiler | null
	private compiling = false
	private readonly recompiledListeners = new Set<() => void>()

	private constructor(
		compiler: Compiler | null,
		private readonly makeCompiler: () => Promise<Compiler>,
	) {
		this.compiler = compiler
	}

	/**
	 * Compiles the stylesheet and, like Tailwind's build, scans its `@source` files for every class
	 * the app can use, so a commit that shows new markup never waits on a rebuild.
	 */
	static async load(stylesheet: string): Promise<StyleResolver> {
		const compiler = await compileSheet(stylesheet)
		const resolver = new StyleResolver(compiler, () => compileSheet(stylesheet))
		resolver.ensure(await scanSources(compiler))
		return resolver
	}

	/**
	 * The sheet compiled for `classes`, by default every class its sources use: what a build ships
	 * for `fromPrecompiled`.
	 */
	static async precompile(stylesheet: string, only?: Iterable<string>): Promise<PrecompiledStyles> {
		const compiler = await compileSheet(stylesheet)
		const classes = only === undefined ? await scanSources(compiler) : [...only]
		return { css: compiler.build(classes), classes }
	}

	/**
	 * A resolver over a sheet compiled at build time: no Tailwind compile or scan at boot. A class
	 * the build did not see compiles later; `onRecompiled` listeners hear when its rules are in.
	 */
	static fromPrecompiled(precompiled: PrecompiledStyles, stylesheet: string): StyleResolver {
		const resolver = new StyleResolver(null, () => compileSheet(stylesheet))
		for (const c of precompiled.classes) resolver.known.add(c)
		resolver.css = precompiled.css
		resolver.parse(precompiled.css)
		return resolver
	}

	/** `listener` runs after classes that arrived uncompiled have their rules: restyle then. */
	onRecompiled(listener: () => void) {
		this.recompiledListeners.add(listener)
	}

	/**
	 * Make sure every class in `classes` has compiled rules; rebuilds the sheet when new ones appear.
	 * False when nothing changed, or when the compiler is still loading (`onRecompiled` follows).
	 */
	ensure(classes: Iterable<string>) {
		let added = false
		for (const c of classes)
			if (!this.known.has(c)) {
				this.known.add(c)
				added = true
			}
		if (!added && this.rules.size > 0) return false
		if (this.compiler === null) {
			this.compileLater()
			return false
		}
		return this.rebuild(this.compiler)
	}

	/** Loads the compiler once, then builds every class known by then. */
	private compileLater() {
		if (this.compiling) return
		this.compiling = true
		this.makeCompiler().then(
			(compiler) => {
				this.compiler = compiler
				this.compiling = false
				if (this.rebuild(compiler)) for (const listener of this.recompiledListeners) listener()
			},
			(cause: unknown) => {
				this.compiling = false
				process.stderr.write(`[styles] the stylesheet did not compile: ${String(cause)}\n`)
			},
		)
	}

	private rebuild(compiler: Compiler): boolean {
		const css = compiler.build([...this.known])
		// A class Tailwind does not generate (a typo, a non-utility) adds no CSS: nothing to re-parse.
		if (css === this.css) return false
		this.css = css
		this.parse(css)
		return true
	}

	/** The classes `ensure` would still have to compile, without compiling them. */
	unknown(classes: Iterable<string>): Array<string> {
		return [...classes].filter((c) => !this.known.has(c))
	}

	/** Whether a stylesheet has been compiled yet (before it, styles must compile synchronously). */
	get isCompiled() {
		return this.rules.size > 0
	}

	/** A custom property's value on the page root (`getComputedStyle(root).getPropertyValue`). */
	customProperty(name: string, dark: boolean): string {
		const vars = this.rootScope(dark).vars
		return substitute(vars.get(name) ?? "", vars).trim()
	}

	rootScope(dark: boolean): Scope {
		return this.intern(`root:${dark}:${viewportSize.width}x${viewportSize.height}`, () => {
			const vars = new Map<string, string>()
			for (const [name, p] of this.registered) vars.set(name, p.initial)
			for (const [k, v] of this.vars.light) vars.set(k, v)
			if (dark) for (const [k, v] of this.vars.dark) vars.set(k, v)
			for (const [k, v] of this.rootProperties) vars.set(k, v)
			// `<html class="dark|light">`: the root every `.dark *` condition looks for.
			const html: NodeInfo = { tag: "html", classes: [dark ? "dark" : "light"], attrs: {} }
			const ancestors = new Set<number>()
			for (const c of this.conditions)
				if (c.comb === " " && matchCompound(c.compound, html, null, () => false)) ancestors.add(c.id)
			const page = this.pageStyle(dark)
			return {
				vars,
				pending: [],
				ancestors,
				parents: new Set(),
				text: { ...ROOT_TEXT, color: page.color ?? ROOT_TEXT.color },
				box: { w: viewportSize.width, h: viewportSize.height },
				containers: [],
				flexParent: false,
			}
		})
	}

	/** The page's own background and text colour, from the stylesheet's `body` rules. */
	pageStyle(dark: boolean): PageStyle {
		const vars = new Map<string, string>(this.vars.light)
		if (dark) for (const [k, v] of this.vars.dark) vars.set(k, v)
		const page: PageStyle = {}
		for (const d of this.pageDecls) {
			const c = color(substitute(d.value, vars))
			if (c === null) continue
			if (d.prop === "background-color") page.bg = c
			if (d.prop === "color") page.color = c
		}
		return page
	}

	/** `document.documentElement.style` custom properties; they beat the stylesheet's, as inline styles do. */
	setRootProperties(properties: ReadonlyMap<string, string>) {
		this.rootProperties = new Map(properties)
		this.scopes.clear()
		this.resolved.clear()
	}

	/** Notes the attributes a selector tests (around the subject, inside `:not`/`:is`/`:has` too). */
	private noteAttrs(c: Compound) {
		for (const a of c.attrs) {
			if (a.name === "class" || this.referencedAttrs.has(a.name)) continue
			const tests = this.attrTests.get(a.name) ?? []
			if (tests.some((t) => t.op === a.op && t.value === a.value && t.insensitive === a.insensitive))
				continue
			tests.push(a)
			this.attrTests.set(a.name, tests)
			// A result cached without this test in its key may not hold any more.
			this.resolved.clear()
		}
		for (const p of c.pseudos)
			if (p.k === "not" || p.k === "is") p.list.forEach((x) => this.noteAttrs(x))
			else if (p.k === "has") p.list.forEach((r) => this.noteAttrs(r.compound))
		for (const link of c.ctx) this.noteAttrs(link.compound)
	}

	/** The cache key's part for an element's attributes: only those styles can depend on. */
	private attrsKey(attrs: Record<string, string>): string {
		let key = ""
		for (const name in attrs) {
			if (this.referencedAttrs.has(name)) key += `${name}=${attrs[name]};`
			else {
				const tests = this.attrTests.get(name)
				if (tests === undefined) continue
				key += `${name}:`
				for (const t of tests) key += matchAttr(t, { tag: "", classes: [], attrs }) ? "1" : "0"
				key += ";"
			}
		}
		return key
	}

	/** One Scope object per distinct (parent, local vars, pending rules, context): the id keys the style cache. */
	private intern(key: string, make: () => Omit<Scope, "id">): Scope {
		const existing = this.scopes.get(key)
		if (existing) return existing
		const scope = { id: ++this.nextScopeId, ...make() }
		this.scopes.set(key, scope)
		return scope
	}

	private parse(css: string) {
		this.rules.clear()
		this.chains.clear()
		this.conditions = []
		this.conditionKeys.clear()
		this.pageDecls = []
		this.scopes.clear()
		this.resolved.clear()
		this.registered.clear()
		this.keyframes.clear()
		this.vars = { light: new Map(), dark: new Map() }
		this.unsupportedSelectors.clear()
		let order = 0
		const root = postcss.parse(`@layer ua {${UA_CSS}}\n${css}`)
		root.walkAtRules("keyframes", (at: AtRule) => {
			const frames: Array<{ at: Array<number>; decls: Array<Decl> }> = []
			at.each((node: ChildNode) => {
				if (node.type !== "rule") return
				const offsets = node.selector.split(",").map((o) => {
					const t = o.trim()
					return t === "from" ? 0 : t === "to" ? 1 : Number.parseFloat(t) / 100
				})
				const decls: Array<Decl> = []
				node.walkDecls((d) => {
					decls.push({ prop: d.prop, value: d.value, important: false })
				})
				frames.push({ at: offsets, decls })
			})
			this.keyframes.set(at.params.trim(), frames)
		})
		root.walkAtRules("property", (at: AtRule) => {
			let initial = ""
			let inherits = true
			at.each((node: ChildNode) => {
				if (node.type !== "decl") return
				if (node.prop === "initial-value") initial = node.value
				if (node.prop === "inherits") inherits = node.value.trim() !== "false"
			})
			this.registered.set(at.params.trim(), { initial, inherits })
		})
		root.walkRules((rule) => {
			order += 1
			const decls: Array<Decl> = []
			rule.each((node: ChildNode) => {
				if (node.type === "decl")
					decls.push({ prop: node.prop, value: node.value, important: node.important === true })
				// `@supports (color-mix…)` nests the preferred value inside the rule.
				if (node.type === "atrule" && node.name === "supports" && supported(node.params))
					node.walkDecls((d) => {
						decls.push({ prop: d.prop, value: d.value, important: d.important === true })
					})
			})
			const gate: Gate = { minWidth: 0, maxWidth: Number.POSITIVE_INFINITY }
			let layer = UNLAYERED
			for (
				let p: Container | Document | undefined = rule.parent;
				p && p.type !== "root";
				p = p.parent
			) {
				if (p.type === "rule") return
				if (p.type !== "atrule") continue
				// SAFETY: postcss gives every container of type "atrule" the AtRule shape.
				const at = p as AtRule
				if (at.name === "media") {
					if (!applyMedia(at.params, gate))
						return this.bump(this.unsupportedSelectors, `@media ${at.params}`)
				} else if (at.name === "container") {
					const container = parseContainer(at.params)
					if (container === null)
						return this.bump(this.unsupportedSelectors, `@container ${at.params}`)
					gate.container = container
				} else if (at.name === "supports") {
					if (!supported(at.params)) return
				} else if (at.name === "layer") {
					const index = LAYERS.indexOf(at.params.trim())
					if (layer === UNLAYERED) layer = index < 0 ? 0 : index
				} else return // @starting-style, @keyframes: enter animations, not resting styles
			}
			// Layer, then specificity, then source order: an unlayered rule beats every layered one.
			for (const parsed of parseSelectorList(rule.selector)) {
				if (parsed instanceof Unsupported) this.bump(this.unsupportedSelectors, parsed.reason)
				else this.noteAttrs(parsed.selector)
				if (!(parsed instanceof Unsupported))
					this.addSelector(
						parsed.selector,
						layer * 1e12 + Math.min(parsed.specificity, 999_999) * 1e6 + order,
						gate,
						decls,
					)
			}
		})
	}

	private addSelector(subject: Compound, order: number, gate: Gate, decls: Array<Decl>) {
		const bare = subject.ctx.length === 0 && subject.attrs.length === 0 && subject.pseudos.length === 0
		if (bare && subject.classes.length === 0 && subject.tag === "html") {
			for (const d of decls) if (d.prop.startsWith("--")) this.vars.light.set(d.prop, d.value)
			return
		}
		if (bare && subject.classes.length === 0 && subject.tag === "body") {
			this.pageDecls.push(...decls.filter((d) => d.prop === "background-color" || d.prop === "color"))
			return
		}
		if (
			bare &&
			subject.tag === undefined &&
			subject.classes.length === 1 &&
			subject.classes[0] === "dark"
		) {
			for (const d of decls) if (d.prop.startsWith("--")) this.vars.dark.set(d.prop, d.value)
			return
		}
		const body: RuleBody = { ...gate, id: ++this.nextRuleId, order, decls }
		const anchor = findAnchor(subject)
		this.registerContext(subject)
		if (anchor === null || anchor.path.length === 0) {
			this.push(this.rules, anchor === null ? "*" : anchor.cls, { ...body, subject })
			return
		}
		// The anchor sits on an ancestor: build the chain from it down to the subject.
		const steps: ChainRule["steps"] = []
		let node = subject
		for (let i = 0; i < anchor.path.length; i++) {
			let link = anchor.path[i]
			if (link === undefined) break
			const step = withoutLink(node, link)
			// `[&>[a]+[b]]`: a sibling on the path is a condition on the step; its parent is the step's.
			while (link.comb === "+" || link.comb === "~") {
				const next: Context | undefined = anchor.path[i + 1]
				if (next === undefined) return this.bump(this.unsupportedSelectors, "sibling-anchored rule")
				step.ctx.push({ comb: link.comb, compound: withoutLink(link.compound, next) })
				i++
				link = next
			}
			steps.unshift({ rel: link.comb === ">" ? "child" : "desc", compound: step })
			node = link.compound
		}
		const only = steps.length === 1 ? steps[0] : undefined
		const childGap =
			only !== undefined &&
			only.rel === "child" &&
			isNotLastChild(only.compound) &&
			decls.some((d) => d.prop === "margin-block-end" || d.prop === "margin-inline-end")
		this.push(this.chains, anchor.cls, { ...body, anchor: node, steps, childGap })
	}

	/** Gives every ancestor / parent condition in `c` (and nested in it) an id the scopes track. */
	private registerContext(c: Compound) {
		for (const link of c.ctx) {
			if (link.comb === " " || link.comb === ">") {
				const key = `${link.comb}${JSON.stringify(link.compound, (k: string, v: unknown) =>
					k === "classAt" || k === "id" ? undefined : v,
				)}`
				let cond = this.conditionKeys.get(key)
				if (cond === undefined) {
					cond = { id: this.conditions.length + 1, comb: link.comb, compound: link.compound }
					this.conditions.push(cond)
					this.conditionKeys.set(key, cond)
				}
				link.id = cond.id
			}
			this.registerContext(link.compound)
		}
		for (const p of c.pseudos)
			if (p.k === "not" || p.k === "is") for (const inner of p.list) this.registerContext(inner)
	}

	private push<T>(map: Map<string, Array<T>>, key: string, rule: T) {
		const list = map.get(key) ?? []
		list.push(rule)
		map.set(key, list)
	}

	private bump(map: Map<string, number>, key: string) {
		map.set(key, (map.get(key) ?? 0) + 1)
	}

	/** The window size viewport units (`vh`, `dvh`, `svh`, `vw`) and media queries resolve against. */
	setViewport(width: number, height: number) {
		viewportSize.width = width
		viewportSize.height = height
	}

	/** Computes one element's style in its scope and the scope its children inherit. */
	resolve(el: ElementInput, scope: Scope, dark: boolean, viewport: number): { style: Style; scope: Scope } {
		const key = `${scope.id}|${dark ? 1 : 0}|${viewport}x${viewportSize.height}|${el.tag ?? ""}|${el.classes.join(
			" ",
		)}|${this.attrsKey(el.attrs)}|${el.inline === undefined ? "" : JSON.stringify(el.inline)}`
		const entries = this.resolved.get(key) ?? []
		const hit = entries.find((e) => e.facts.every((f) => f.test(el) === f.value))
		if (hit) return hit.result
		const facts: Array<Fact> = []
		const seen = new Set<string>()
		const {
			style,
			scope: childScope,
			outlineHidden,
		} = this.compute(el, scope, viewport, facts, NO_STATES, seen)
		const result = {
			style: this.withStates(style, outlineHidden, seen, (states) =>
				this.compute(el, scope, viewport, facts, states, null),
			),
			scope: childScope,
		}
		entries.push({ facts, result })
		this.resolved.set(key, entries)
		return result
	}

	/**
	 * Adds what focus and press change, from passes that take those states as true. Rune draws
	 * them itself (a keyboard ring, a ring while focused within, a press fill), so only those go.
	 */
	private withStates(
		style: Style,
		outlineHidden: boolean,
		seen: ReadonlySet<string>,
		pass: (states: ReadonlySet<string>) => { style: Style; outlineHidden: boolean },
	): Style {
		const rest = ringOf(style)
		if (seen.has("focus") || seen.has("focus-within")) {
			const pointer = ringOf(pass(POINTER_FOCUS).style)
			if (pointer !== undefined && !sameRing(pointer, rest)) style.focusWithinRing = pointer
		}
		if (style.focusWithinRing === undefined && seen.has("focus-visible")) {
			const keyboard = pass(KEYBOARD_FOCUS)
			const ring = ringOf(keyboard.style)
			if (ring !== undefined && !sameRing(ring, rest)) style.focusRing = ring
			else if (ring === undefined && keyboard.outlineHidden) style.focusRing = "none"
		} else if (style.focusWithinRing === undefined && outlineHidden && rest === undefined)
			style.focusRing = "none"
		if (seen.has("active")) {
			const pressed = pass(PRESSED).style.bg
			if (pressed !== undefined && pressed !== style.bg) style.pressBg = pressed
		}
		return style
	}

	/**
	 * `states` are the dynamic pseudo-classes taken as true; `seen` collects the ones the element's
	 * rules ask about (null: a state pass, which returns only the style, the scope unchanged).
	 */
	private compute(
		el: ElementInput,
		scope: Scope,
		viewport: number,
		facts: Array<Fact>,
		states: ReadonlySet<string>,
		seen: Set<string> | null,
	): { style: Style; scope: Scope; outlineHidden: boolean } {
		const ask = (test: (input: ElementInput) => boolean) => {
			const value = test(el)
			facts.push({ test, value })
			return value
		}
		// Position and emptiness are read lazily: only a structural rule makes them part of the result.
		const { index, count, empty } = el
		let recording = true
		const self: NodeInfo = {
			tag: el.tag ?? "div",
			classes: el.classes,
			attrs: el.attrs,
			states: {
				has: (name) => {
					if (recording) seen?.add(name)
					return states.has(name)
				},
			},
			get index() {
				ask((e) => e.index === index)
				return index
			},
			get count() {
				ask((e) => e.count === count)
				return count
			},
			get empty() {
				ask((e) => e.empty === empty)
				return empty
			},
		}
		const live = (r: Gate) => {
			if (r.minWidth > viewport || r.maxWidth <= viewport) return false
			if (r.container === undefined) return true
			const box = nearestContainer(scope.containers, r.container.name)?.w
			return box !== undefined && box >= r.container.minWidth && box < r.container.maxWidth
		}
		// Conditions the element's context answers: ancestors, parent, previous siblings.
		const context: ContextAnswer = (link) => {
			if (link.comb === " ") return link.id !== undefined && scope.ancestors.has(link.id)
			if (link.comb === ">") return link.id !== undefined && scope.parents.has(link.id)
			const adjacent = link.comb === "+"
			const compound = link.compound
			return ask((e) => {
				const before = e.prevSiblings ?? []
				return (adjacent ? before.slice(0, 1) : before).some((sib) =>
					matchCompound(compound, sib, null, () => false),
				)
			})
		}
		const hasDescendant = (match: (node: NodeInfo) => boolean, childrenOnly: boolean) =>
			ask((e) => e.hasDescendant(match, childrenOnly))
		const matches = (c: Compound) => matchCompound(c, self, context, hasDescendant)
		const hoverContext = (c: Compound) =>
			c.ctx.some((link) => link.comb === " " && link.compound.hover && context(link))

		const picked: Array<{ order: number; mode: Mode; decls: Array<Decl> }> = []
		let hoverGroup = false
		let childGap: number | undefined
		const pending: Array<Pending> = []
		const pick = (r: RuleBody, c: Compound, originHover: boolean) =>
			picked.push({
				order: r.order,
				mode: originHover || hoverContext(c) ? "groupHover" : c.hover ? "hover" : "base",
				decls: r.decls,
			})
		for (const r of this.rules.get("*") ?? [])
			if (live(r) && matches(r.subject)) pick(r, r.subject, false)
		for (const cls of el.classes) {
			const rules = this.rules.get(cls)
			const chains = this.chains.get(cls)
			if (!rules && !chains && !this.unsupportedClasses.has(cls))
				this.bump(this.unsupportedClasses, cls)
			for (const r of rules ?? []) if (live(r) && matches(r.subject)) pick(r, r.subject, false)
			for (const r of chains ?? []) {
				const first = r.steps[0]
				if (first === undefined || !live(r) || !matches(r.anchor)) continue
				if (r.childGap) {
					childGap = gapOf(r, scope, this.units(scope, scope.text.size)) ?? childGap
					continue
				}
				pending.push({ rule: r, step: 0, rel: first.rel, originHover: r.anchor.hover })
				if (r.anchor.hover) hoverGroup = true
			}
		}
		for (const p of scope.pending) {
			const step = p.rule.steps[p.step]
			if (step === undefined || !matches(step.compound)) continue
			const next = p.rule.steps[p.step + 1]
			if (next === undefined) pick(p.rule, step.compound, p.originHover)
			else pending.push({ rule: p.rule, step: p.step + 1, rel: next.rel, originHover: p.originHover })
		}
		picked.sort((a, b) => a.order - b.order)
		// Custom properties first: set on this element, visible to its own declarations and inherited.
		const local = new Map<string, string>()
		for (const important of [false, true])
			for (const r of picked)
				if (r.mode === "base")
					for (const d of r.decls)
						if (d.prop.startsWith("--") && d.important === important) local.set(d.prop, d.value)
		const inline = Object.entries(el.inline ?? {})
		for (const [prop, value] of inline) if (prop.startsWith("--")) local.set(prop, value)
		const vars = new Map(scope.vars)
		for (const [name, p] of this.registered) if (!p.inherits) vars.set(name, p.initial)
		for (const [k, v] of local) vars.set(k, v)
		for (const [k, v] of local) {
			const resolved = substituteStrict(v, vars)
			if (resolved === null) vars.delete(k)
			else vars.set(k, resolved)
		}
		// Normal declarations, then inline styles, then `!important` ones; font size and colour
		// first so `em` and `currentColor` see this element's own values.
		const ordered: Array<{ mode: Mode; d: Decl }> = []
		for (const r of picked) for (const d of r.decls) if (!d.important) ordered.push({ mode: r.mode, d })
		for (const [prop, value] of inline)
			ordered.push({ mode: "base", d: { prop, value, important: false } })
		for (const r of picked) for (const d of r.decls) if (d.important) ordered.push({ mode: r.mode, d })
		const style: Style = {}
		const acc: Accumulator = {
			tag: el.tag ?? "div",
			style,
			text: scope.text,
			vars,
			scope,
			containerType: "",
			containerNames: [],
			shadows: null,
			outline: {},
			transition: {},
		}
		for (const { mode, d } of ordered) if (d.prop === "font-size") this.apply(acc, d, mode)
		for (const { mode, d } of ordered) if (TEXT_FIRST.has(d.prop)) this.apply(acc, d, mode)
		for (const { mode, d } of ordered)
			if (!TEXT_FIRST.has(d.prop) && d.prop !== "font-size") this.apply(acc, d, mode)
		this.finish(acc)
		// `group-hover:right-8` on a positioned element: a move by the inset's change.
		if (acc.groupInset !== undefined && style.absolute !== undefined) {
			const rest = style.absolute
			const change = (side: number) => {
				const to = acc.groupInset?.[side]
				const from = rest[side]
				return to === null || to === undefined || from === null || from === undefined ? 0 : to - from
			}
			const dx = change(0) - change(2)
			const dy = change(1) - change(3)
			if (dx !== 0 || dy !== 0) style.groupShift = [dx, dy]
		}
		// A screen-reader-only control (or a hidden box holding one, as around a radio's input)
		// stays focusable: kept at its 1px clipped box, all but transparent. Other sr-only content goes.
		if (acc.srOnly) {
			if (isFocusable(el) || hasDescendant(isFocusable, false)) style.opacity = SR_ONLY_OPACITY
			else style.display = "none"
		}
		const outlineHidden = acc.outline.style !== undefined && style.outline === undefined
		if (childGap !== undefined) style.childGap = childGap
		if (hoverGroup || el.classes.some((c) => c === "group" || c.startsWith("group/")))
			style.hoverGroup = true
		if (seen === null) return { style, scope, outlineHidden }
		// Conditions that hold on this element are context for others: not a state of its own.
		recording = false
		// Conditions this element satisfies, for its descendants and children.
		const ancestors = new Set(scope.ancestors)
		const parents = new Set<number>()
		for (const c of this.conditions) {
			if (!matches(c.compound)) continue
			if (c.comb === " ") ancestors.add(c.id)
			else parents.add(c.id)
		}
		const text = childText(scope.text, style, acc)
		const box = style.display === "contents" ? scope.box : contentBox(style, scope.box)
		const containers: Array<ContainerBox> =
			acc.containerType === ""
				? scope.containers
				: [
						{
							names: acc.containerNames,
							w: box.w,
							h: acc.containerType === "size" ? box.h : undefined,
						},
						...scope.containers,
					]
		const childPending = [...scope.pending.filter((p) => p.rel === "desc"), ...pending]
		// `display: contents` has no box: its children are laid out by the grandparent.
		const contents = style.display === "contents"
		const flexParent = contents ? scope.flexParent : style.display === "flex" || style.display === "grid"
		const key = [
			flexParent ? "f" : "",
			scope.id,
			[...local].map(([k, v]) => `${k}:${v}`).join(";"),
			childPending.map((p) => `${p.rule.id}.${p.step}.${p.rel}.${p.originHover ? 1 : 0}`).join(","),
			[...ancestors].sort((a, b) => a - b).join(","),
			[...parents].sort((a, b) => a - b).join(","),
			JSON.stringify(text),
			`${box.w}x${box.h}`,
			JSON.stringify(containers),
		].join("|")
		const childScope = this.intern(key, () => ({
			vars,
			pending: childPending,
			ancestors,
			parents,
			text,
			box,
			containers,
			flexParent,
		}))
		return { style, scope: childScope, outlineHidden }
	}

	private units(scope: Scope, em: number): Units {
		const container = nearestContainer(scope.containers, "")
		return {
			em,
			vw: viewportSize.width / 100,
			vh: viewportSize.height / 100,
			cqw: container?.w === undefined ? undefined : container.w / 100,
			cqh: container?.h === undefined ? undefined : container.h / 100,
		}
	}

	private apply(acc: Accumulator, d: Decl, mode: Mode) {
		if (d.prop.startsWith("--")) return
		const s = acc.style
		const substituted = substituteStrict(d.value, acc.vars)
		// Invalid at computed-value time: the property is `unset` (inherited ones inherit).
		const v = (substituted ?? "unset").trim()
		const current = s.color ?? acc.text.color
		if (mode === "groupHover") {
			if (d.prop === "opacity") s.groupOpacity = ratio(v)
			const side = ["left", "top", "right", "bottom"].indexOf(d.prop)
			if (side !== -1) {
				const n = evalLength(v, this.units(acc.scope, s.fontSize ?? acc.text.size))
				if (n !== null) (acc.groupInset ??= [null, null, null, null])[side] = n
			}
			return
		}
		if (mode === "hover") {
			const c = color(v, d.prop === "color" ? acc.text.color : current)
			if (c !== null && d.prop === "background-color") s.hoverBg = c
			else if (c !== null && d.prop === "color") s.hoverColor = c
			return
		}
		if (v === "inherit" || v === "unset" || v === "revert" || v === "revert-layer") {
			const field = INHERITED_FIELD.get(d.prop)
			if (field !== undefined) delete s[field]
			return
		}
		const fontSize = s.fontSize ?? acc.text.size
		const units = this.units(acc.scope, d.prop === "font-size" ? acc.text.size : fontSize)
		const len = (): number | "full" | "auto" | null => {
			if (v === "100%") return "full"
			if (
				v === "auto" ||
				v === "fit-content" ||
				v === "max-content" ||
				v === "min-content" ||
				v === "none"
			)
				return "auto"
			return evalLength(v, units)
		}
		const num = (): number | null => {
			const n = len()
			return typeof n === "number" ? n : null
		}
		const unsupported = () => this.bump(this.unsupportedProps, `${d.prop}: ${d.value}`)
		const sides = (key: "pad" | "margin" | "border", idx: Array<number>, n: number | null = num()) => {
			if (n === null) return unsupported()
			const cur = s[key] ?? [0, 0, 0, 0]
			for (const i of idx) cur[i] = n
			s[key] = cur
		}
		const margin = (idx: Array<number>, value: string) => {
			const auto = value === "auto"
			const flags = s.marginAuto ?? [false, false, false, false]
			for (const i of idx) flags[i] = auto
			s.marginAuto = flags
			sides("margin", idx, auto ? 0 : evalLength(value, units))
		}
		const setLen = (key: "w" | "h") => {
			const n = len()
			// Rune sizes a share of the parent's width only (`w_frac`), not of its height.
			const frac = n === null && key === "w" ? fractionOf(v, units) : null
			if (frac !== null) s.w = { frac }
			else {
				if (n === null) unsupported()
				s[key] = n ?? "auto"
			}
		}
		const bound = (key: "minW" | "minH" | "maxW" | "maxH") => {
			const n = len()
			if (n === "auto") delete s[key]
			else if (n === null) unsupported()
			else s[key] = n
		}
		const setColor = (key: "bg" | "color" | "borderColor") => {
			const c = color(v, key === "color" ? acc.text.color : current)
			if (c === null) return unsupported()
			s[key] = c
		}
		const inset = (i: number, value: string) => {
			// A percentage is of the containing block: the window for `fixed`, else (most often) the parent.
			const horizontal = i % 2 === 0
			const basis = acc.fixed
				? horizontal
					? viewportSize.width
					: viewportSize.height
				: horizontal
					? acc.scope.box.w
					: acc.scope.box.h
			const n = value === "auto" ? null : evalLength(value, units, basis)
			if (n === null && value !== "auto") return unsupported()
			const a = s.absolute ?? [null, null, null, null]
			a[i] = n
			s.absolute = a
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
				if (v.endsWith("reverse")) unsupported()
				break
			case "flex-wrap":
				s.wrap = v === "wrap" || v === "wrap-reverse"
				break
			case "gap": {
				const [row = "", col = row] = splitTop(v, /\s/)
				const r = evalLength(row, units)
				const c = evalLength(col, units)
				if (r === null || c === null) return unsupported()
				s.gapRow = r
				s.gapCol = c
				break
			}
			case "row-gap":
			case "column-gap": {
				const n = v === "normal" ? 0 : num()
				if (n === null) return unsupported()
				if (d.prop === "row-gap") s.gapRow = n
				else s.gapCol = n
				break
			}
			case "padding":
				boxShorthand(v).forEach((p, i) => sides("pad", [i], evalLength(p, units)))
				break
			case "padding-inline":
				sides("pad", [1, 3])
				break
			case "padding-block":
				sides("pad", [0, 2])
				break
			case "padding-top":
			case "padding-block-start":
				sides("pad", [0])
				break
			case "padding-right":
			case "padding-inline-end":
				sides("pad", [1])
				break
			case "padding-bottom":
			case "padding-block-end":
				sides("pad", [2])
				break
			case "padding-left":
			case "padding-inline-start":
				sides("pad", [3])
				break
			case "margin":
				boxShorthand(v).forEach((p, i) => margin([i], p))
				break
			case "margin-inline":
			case "margin-block": {
				const [a = "0", b = a] = splitTop(v, /\s/)
				const [start, end] = d.prop === "margin-inline" ? [3, 1] : [0, 2]
				margin([start], a)
				margin([end], b)
				break
			}
			case "margin-top":
			case "margin-block-start":
				margin([0], v)
				break
			case "margin-right":
			case "margin-inline-end":
				margin([1], v)
				break
			case "margin-bottom":
			case "margin-block-end":
				margin([2], v)
				break
			case "margin-left":
			case "margin-inline-start":
				margin([3], v)
				break
			case "width":
			case "inline-size":
				setLen("w")
				break
			case "height":
			case "block-size":
				setLen("h")
				break
			case "min-width":
				bound("minW")
				break
			case "min-height":
				bound("minH")
				break
			case "max-width":
				bound("maxW")
				break
			case "max-height":
				bound("maxH")
				break
			case "flex": {
				const flex = parseFlex(v)
				if (flex === null) return unsupported()
				s.grow = flex.grow
				s.shrink = flex.shrink
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
				setColor("bg")
				break
			case "background":
				if (v === "none") delete s.bg
				else setColor("bg")
				break
			case "background-image": {
				const image = parseBackgroundImage(v, current)
				if (image === "none") delete s.bgImage
				else if (image === null) unsupported()
				else s.bgImage = image
				break
			}
			case "color":
				setColor("color")
				break
			case "border": {
				const parts = splitTop(v, /\s/)
				sides(
					"border",
					[0, 1, 2, 3],
					parts.map((p) => evalLength(p, units)).find((n) => n !== null) ?? 0,
				)
				const c = parts.map((p) => color(p, current)).find((x) => x !== null)
				if (c !== undefined && c !== null) s.borderColor = c
				break
			}
			case "border-width":
				boxShorthand(v).forEach((p, i) => sides("border", [i], evalLength(p, units)))
				break
			case "border-inline-width":
				sides("border", [1, 3])
				break
			case "border-block-width":
				sides("border", [0, 2])
				break
			case "border-top-width":
			case "border-block-start-width":
				sides("border", [0])
				break
			case "border-right-width":
			case "border-inline-end-width":
				sides("border", [1])
				break
			case "border-bottom-width":
			case "border-block-end-width":
				sides("border", [2])
				break
			case "border-left-width":
			case "border-inline-start-width":
				sides("border", [3])
				break
			case "border-color":
			case "border-inline-color":
			case "border-block-color":
			case "border-right-color":
			case "border-bottom-color":
			case "border-top-color":
			case "border-left-color":
			case "border-inline-start-color":
			case "border-inline-end-color":
				setColor("borderColor")
				break
			case "border-radius":
				boxShorthand(v.split("/")[0] ?? v).forEach((p, i) => {
					const r = evalLength(p, units)
					if (r === null) return unsupported()
					const cur = s.radius ?? [0, 0, 0, 0]
					cur[i] = r
					s.radius = cur
				})
				break
			case "border-top-left-radius":
			case "border-start-start-radius":
			case "border-top-right-radius":
			case "border-start-end-radius":
			case "border-bottom-right-radius":
			case "border-end-end-radius":
			case "border-bottom-left-radius":
			case "border-end-start-radius": {
				const r = num()
				if (r === null) return unsupported()
				const cur = s.radius ?? [0, 0, 0, 0]
				cur[CORNERS.get(d.prop) ?? 0] = r
				s.radius = cur
				break
			}
			case "font-size": {
				const n =
					v === "smaller"
						? acc.text.size / 1.2
						: v === "larger"
							? acc.text.size * 1.2
							: evalLength(v, units, acc.text.size)
				// An unknown size (a container unit with no container) is omitted, never 0.
				if (n === null) return unsupported()
				s.fontSize = n
				break
			}
			case "line-height": {
				if (v === "normal") {
					acc.line = "normal"
					delete s.lineHeight
					break
				}
				// Unitless (often `calc(1.25 / 0.875)`) is a multiple of the font size and inherits as one.
				const unitless = !/[\d.](px|r?em|%|[dsl]?v[hwib]|cq[a-z]+)/.test(v)
				const n = evalLength(v, units, fontSize)
				if (n === null) return unsupported()
				acc.line = unitless ? { mult: n } : { px: n }
				s.lineHeight = unitless ? n * fontSize : n
				break
			}
			case "font-weight": {
				const w =
					v === "bold"
						? 700
						: v === "normal"
							? 400
							: v === "bolder"
								? bolder(acc.text.weight)
								: v === "lighter"
									? lighter(acc.text.weight)
									: Number(v)
				if (Number.isNaN(w)) return unsupported()
				s.fontWeight = w
				break
			}
			case "font-family":
				s.fontFamily = /mono/i.test(v.split(",")[0] ?? "") ? "mono" : "sans"
				break
			case "font-style":
				s.italic = v.startsWith("italic") || v.startsWith("oblique")
				break
			case "font":
				unsupported()
				break
			case "letter-spacing": {
				const n = v === "normal" ? 0 : num()
				if (n === null) return unsupported()
				s.letterSpacing = n
				break
			}
			case "text-transform":
				if (v === "uppercase" || v === "lowercase" || v === "capitalize") s.textTransform = v
				else delete s.textTransform
				break
			case "text-decoration-line":
			case "text-decoration":
				if (v.includes("underline")) s.textDecoration = "underline"
				else if (v.includes("line-through")) s.textDecoration = "line-through"
				else delete s.textDecoration
				break
			case "white-space":
				s.nowrap = v === "nowrap" || v === "pre"
				s.whiteSpacePre = v === "pre" || v === "pre-wrap" || v === "break-spaces"
				break
			case "text-wrap":
			case "text-wrap-mode":
				if (v === "nowrap") s.nowrap = true
				break
			case "visibility":
				if (v === "hidden" || v === "collapse") s.visibility = "hidden"
				else delete s.visibility
				break
			case "pointer-events":
				if (v === "none" || v === "auto") s.pointerEvents = v
				else delete s.pointerEvents
				break
			case "z-index": {
				const z = v === "auto" ? null : evalLength(v, units)
				if (z === null) delete s.zIndex
				else s.zIndex = Math.round(z)
				break
			}
			case "object-fit":
				if (v === "cover" || v === "contain" || v === "none" || v === "scale-down") s.objectFit = v
				else delete s.objectFit
				break
			case "aspect-ratio": {
				const m = /^(?:auto\s+)?([\d.]+)\s*(?:\/\s*([\d.]+))?$/.exec(v)
				if (v === "auto") delete s.aspectRatio
				else if (m) s.aspectRatio = Number(m[1]) / Number(m[2] ?? 1)
				else unsupported()
				break
			}
			case "top":
			case "inset-block":
				if (percentage(v, units) === 50) {
					s.absolute = s.absolute ?? [null, null, null, null]
					s.centerY = true
					break
				}
				inset(1, v)
				if (d.prop === "inset-block") inset(3, v)
				break
			case "inset-inline":
				inset(0, v)
				inset(2, v)
				break
			case "inset": {
				const [t = "auto", r = "auto", b = "auto", l = "auto"] = boxShorthand(v)
				inset(0, l)
				inset(1, t)
				inset(2, r)
				inset(3, b)
				break
			}
			case "left":
			case "inset-inline-start":
				if (percentage(v, units) === 50) {
					s.absolute = s.absolute ?? [null, null, null, null]
					s.centerX = true
					break
				}
				inset(0, v)
				break
			case "right":
			case "inset-inline-end":
				inset(2, v)
				break
			case "bottom":
				inset(3, v)
				break
			case "translate": {
				const [tx = "0", ty = "0"] = splitTop(v, /\s/)
				const t = parseTranslate(tx, ty, units)
				if (t === "none") delete s.translate
				else if (t !== null) s.translate = t
				// `-translate-x/y-1/2` under `left/top-1/2` is the centring `centerX`/`centerY` already says.
				else {
					const xCentred =
						s.centerX === true ? percentage(tx, units) === -50 : evalLength(tx, units) === 0
					const yCentred =
						s.centerY === true ? percentage(ty, units) === -50 : evalLength(ty, units) === 0
					if (!(xCentred && yCentred)) unsupported()
				}
				break
			}
			case "transform": {
				if (v === "none") break
				const m = /^translate(X|Y)?\(([^)]*)\)$/.exec(v)
				if (!m) return unsupported()
				const args = (m[2] ?? "").split(/\s*,\s*/)
				const [tx = "0", ty = "0"] = m[1] === "Y" ? ["0", args[0] ?? "0"] : args
				const t = parseTranslate(tx, ty, units)
				if (t === null) unsupported()
				else if (t !== "none") s.translate = t
				break
			}
			case "opacity":
				s.opacity = ratio(v)
				break
			case "animation":
				// `var(a)var(b)` runs together once substituted: keep the parts apart.
				acc.animation = substituteStrict(d.value.replace(/\)(?=\s*var\()/g, ") "), acc.vars) ?? "none"
				break
			case "transition-property":
				acc.transition.property = v
				break
			case "transition-duration":
				acc.transition.duration = v
				break
			case "transition-timing-function":
				acc.transition.timing = v
				break
			case "transition-delay":
				acc.transition.delay = v
				break
			case "overflow": {
				const [x = "visible", y = x] = v.split(/\s+/)
				if (y === "auto" || y === "scroll") s.scrollY = true
				if ([x, y].some((o) => o === "hidden" || o === "clip")) s.clip = true
				break
			}
			case "overflow-y":
				if (v === "auto" || v === "scroll") s.scrollY = true
				else if (v === "hidden" || v === "clip") s.clip = true
				break
			case "overflow-x":
				if (v === "hidden" || v === "clip") s.clip = true
				else if (v === "auto" || v === "scroll") unsupported()
				break
			case "text-overflow":
				s.truncate = v === "ellipsis"
				break
			// `sr-only`: screen-reader text, never drawn (a focusable one is kept: see `resolve`).
			case "clip-path":
				if (v.replace(/\s/g, "") === "inset(50%)") acc.srOnly = true
				break
			case "position":
				acc.fixed = v === "fixed"
				if (acc.fixed) s.fixed = true
				else delete s.fixed
				s.position =
					v === "absolute" || v === "fixed" ? "absolute" : v === "sticky" ? "sticky" : "static"
				if (s.position === "absolute") s.absolute = s.absolute ?? [null, null, null, null]
				break
			case "grid-template-columns":
				if (v === "subgrid") s.subgrid = true
				else if (v === "none") delete s.gridCols
				else s.gridCols = expandRepeat(v)
				break
			case "grid-template-rows":
				if (v === "none") delete s.gridRows
				else s.gridRows = expandRepeat(v)
				break
			case "grid-row-start": {
				const line = Number.parseInt(v, 10)
				if (Number.isInteger(line) && line > 0) s.rowStart = line
				else unsupported()
				break
			}
			case "justify-items":
				if (v === "center") s.justifyItems = "center"
				else if (v === "normal" || v === "stretch" || v === "legacy") delete s.justifyItems
				else unsupported()
				break
			case "grid-column":
				if (v === "1 / -1") s.colSpanFull = true
				else unsupported()
				break
			case "text-align":
				s.textAlign = v
				break
			case "box-shadow":
				acc.shadows = v
				break
			case "outline":
				acc.outline = parseOutlineShorthand(v)
				break
			case "outline-style":
				acc.outline.style = v
				break
			case "outline-width":
				acc.outline.width = v
				break
			case "outline-color":
				acc.outline.color = v
				break
			case "outline-offset":
				acc.outline.offset = v
				break
			case "container-type":
				acc.containerType = v === "size" || v === "inline-size" ? v : ""
				break
			case "container-name":
				acc.containerNames = v.split(/\s+/)
				break
			case "container": {
				const [names = "", type = ""] = v.split("/").map((p) => p.trim())
				acc.containerNames = names.split(/\s+/)
				acc.containerType = type === "size" || type === "inline-size" ? type : ""
				break
			}
			default:
				if (!IGNORED.has(d.prop)) this.bump(this.unsupportedProps, d.prop)
		}
	}

	/** The one animation in `value` the host can play, from its keyframes; others count as unsupported. */
	private composeAnimation(value: string, acc: Accumulator, units: Units): Animation | undefined {
		const first = splitTop(value, /,/)[0]?.trim() ?? "none"
		let name = "none"
		const times: Array<number> = []
		let infinite = false
		for (const token of splitTop(first, /\s/)) {
			if (/^-?[\d.]+m?s$/.test(token)) times.push(parseSeconds(token))
			else if (token === "infinite") infinite = true
			else if (/^[a-z][\w-]*$/i.test(token) && !ANIMATION_KEYWORDS.has(token)) name = token
		}
		const frames = this.keyframes.get(name)
		if (name === "none" || frames === undefined) return undefined
		const [duration = 0, delay = 0] = times
		if (duration <= 0) return undefined
		const valueAt = (prop: string, at: number) =>
			frames
				.filter((f) => f.at.includes(at))
				.flatMap((f) => f.decls)
				.find((d) => d.prop === prop)?.value
		const props = new Set(frames.flatMap((f) => f.decls.map((d) => d.prop)))
		props.delete("animation-timing-function")
		if (
			infinite &&
			[...props].every((p) => p === "transform") &&
			frames.some((f) => f.decls.some((d) => d.value.includes("rotate(")))
		)
			return { kind: "spin", period: duration }
		if (infinite && [...props].every((p) => p === "opacity")) {
			const rest = acc.style.opacity ?? 1
			const opacityAt = (at: number) => {
				const v = valueAt("opacity", at)
				return v === undefined ? rest : ratio(substitute(v, acc.vars))
			}
			const middle = frames.flatMap((f) => f.at).filter((at) => at > 0 && at < 1)
			const peak = middle.sort((a, b) => Math.abs(a - 0.5) - Math.abs(b - 0.5))[0]
			return {
				kind: "pulse",
				period: duration,
				delay,
				from: opacityAt(0),
				to: peak === undefined ? opacityAt(0) : opacityAt(peak),
			}
		}
		const start = frames.filter((f) => f.at.includes(0)).flatMap((f) => f.decls)
		if (!infinite && start.length > 0 && [...props].every((p) => ENTER_PROPS.has(p))) {
			const read = (prop: string) => {
				const v = start.find((d) => d.prop === prop)?.value
				return v === undefined ? undefined : substitute(v, acc.vars).trim()
			}
			const opacity = read("opacity")
			const pose = parseEnterTransform(read("transform") ?? "none", units)
			if (pose !== null)
				return {
					kind: "enter",
					duration,
					delay,
					opacity: opacity === undefined ? 1 : ratio(opacity),
					...pose,
				}
		}
		this.bump(this.unsupportedProps, `animation: ${name}`)
		return undefined
	}

	/** Composes what needs the whole element (shadows, outline) and drops values equal to "unset". */
	private finish(acc: Accumulator) {
		const s = acc.style
		const current = s.color ?? acc.text.color
		const units = this.units(acc.scope, s.fontSize ?? acc.text.size)
		if (acc.shadows !== null) {
			const shadows = parseShadowList(acc.shadows, current, units)
			if (shadows === null) this.bump(this.unsupportedProps, `box-shadow: ${acc.shadows}`)
			else if (shadows.length > 0) s.shadows = shadows
		}
		const o = acc.outline
		const outlineStyle = o.style ?? "none"
		if (outlineStyle !== "none" && outlineStyle !== "hidden") {
			const width = o.width === undefined ? 3 : evalLength(o.width, units)
			const c = color(o.color ?? "currentcolor", current)
			const offset = o.offset === undefined ? 0 : evalLength(o.offset, units)
			if (width !== null && width > 0 && c !== null && !c.endsWith("00") && offset !== null)
				s.outline = { width, color: c, offset }
		}
		const transition = composeTransition(acc.transition)
		if (transition !== undefined) s.transition = transition
		const animation =
			acc.animation === undefined ? undefined : this.composeAnimation(acc.animation, acc, units)
		if (animation !== undefined) s.animation = animation
		// Flex and grid items and out-of-flow boxes are blockified: `inline-flex` is `flex`, a span is a block.
		if (acc.scope.flexParent || s.position === "absolute") {
			if (s.display === "inline" || (s.display === undefined && INLINE_TAGS.has(acc.tag)))
				s.display = "block"
			if (s.inline === true || INLINE_TAGS.has(acc.tag)) s.inline = false
		}
		// Insets place an element only when it is taken out of flow (`sticky` and `relative` stay in it).
		const top = s.absolute?.[1]
		if (s.position === "sticky" && top !== null && top !== undefined) s.stickyTop = top
		if (s.position !== "absolute") {
			delete s.absolute
			delete s.centerY
			delete s.centerX
		}
		delete s.position
		// A unitless line height multiplies the final font size (an inline `font-size` comes last).
		if (acc.line !== undefined && acc.line !== "normal" && "mult" in acc.line)
			s.lineHeight = acc.line.mult * (s.fontSize ?? acc.text.size)
		// A line height follows a font size the way CSS inherits it: a multiple scales, a length stays.
		if (s.fontSize !== undefined && s.lineHeight === undefined && acc.line === undefined) {
			const line = acc.text.line
			if (line !== "normal") s.lineHeight = "mult" in line ? line.mult * s.fontSize : line.px
		}
		if (s.pad?.every((n) => n === 0)) delete s.pad
		if (s.border?.every((n) => n === 0)) delete s.border
		if (s.radius?.every((n) => n === 0)) delete s.radius
		const auto = s.marginAuto?.some(Boolean) ?? false
		if (!auto) delete s.marginAuto
		if (s.margin?.every((n) => n === 0) && !auto) delete s.margin
		if (s.border === undefined) delete s.borderColor
		if (s.bg === "#00000000") delete s.bg
		if (s.opacity === 1) delete s.opacity
	}
}

/** What each animatable property moves in the host. Anything else (`display`, `filter`) is not animated. */
const CHANNEL_OF = new Map<string, TransitionChannel>([
	["color", "colors"],
	["background-color", "colors"],
	["background", "colors"],
	["border-color", "colors"],
	["outline-color", "colors"],
	["text-decoration-color", "colors"],
	["fill", "colors"],
	["stroke", "colors"],
	["box-shadow", "colors"],
	["opacity", "opacity"],
	["transform", "transform"],
	["translate", "transform"],
	["scale", "transform"],
	["rotate", "transform"],
])
const LAYOUT_PROPERTY =
	/^(width|height|min-width|min-height|max-width|max-height|margin.*|padding.*|inset.*|left|right|top|bottom|gap|row-gap|column-gap|flex.*)$/
const CHANNELS: Array<TransitionChannel> = ["colors", "opacity", "layout", "transform"]

const EASINGS = new Map<string, Timing["ease"]>([
	["linear", [0, 0, 1, 1]],
	["ease", [0.25, 0.1, 0.25, 1]],
	["ease-in", [0.42, 0, 1, 1]],
	["ease-out", [0, 0, 0.58, 1]],
	["ease-in-out", [0.42, 0, 0.58, 1]],
])

const parseEase = (v: string): Timing["ease"] => {
	const known = EASINGS.get(v)
	if (known !== undefined) return known
	const m = /^cubic-bezier\(([^)]*)\)$/.exec(v)
	const points = m?.[1]?.split(",").map((n) => Number(n.trim()))
	if (points?.length === 4 && points.every(Number.isFinite)) return points as Timing["ease"]
	// `steps()` and anything else: a straight ramp is the nearest the host draws.
	return [0, 0, 1, 1]
}

const parseSeconds = (v: string): number => {
	const n = Number.parseFloat(v)
	if (!Number.isFinite(n)) return 0
	return v.trim().endsWith("ms") ? n / 1000 : n
}

const ANIMATION_KEYWORDS = new Set([
	"linear",
	"ease",
	"ease-in",
	"ease-out",
	"ease-in-out",
	"step-start",
	"step-end",
	"infinite",
	"normal",
	"reverse",
	"alternate",
	"alternate-reverse",
	"none",
	"forwards",
	"backwards",
	"both",
	"running",
	"paused",
])
/** What an entrance may move; a blur or a rotation is not one the host draws. */
const ENTER_PROPS = new Set(["opacity", "transform", "filter"])

/** The arguments of the first `name(...)` in `text`, split on top-level commas. */
const fnArgs = (text: string, name: string): Array<string> | undefined => {
	const at = text.indexOf(`${name}(`)
	if (at < 0) return undefined
	let depth = 0
	for (let i = at + name.length; i < text.length; i++) {
		if (text[i] === "(") depth++
		else if (text[i] === ")" && --depth === 0) return splitTop(text.slice(at + name.length + 1, i), /,/)
	}
	return undefined
}

/** An entrance's starting translate and scale; null when it rotates or moves by a percentage. */
const parseEnterTransform = (v: string, units: Units): { x: number; y: number; scale: number } | null => {
	if (v === "none") return { x: 0, y: 0, scale: 1 }
	const rotate = fnArgs(v, "rotate")?.[0]?.trim()
	if (rotate !== undefined && Number.parseFloat(rotate) !== 0) return null
	const [tx = "0", ty = "0"] = fnArgs(v, "translate3d") ??
		fnArgs(v, "translate") ??
		(fnArgs(v, "translateY") ? ["0", fnArgs(v, "translateY")?.[0] ?? "0"] : undefined) ?? [
			fnArgs(v, "translateX")?.[0] ?? "0",
			"0",
		]
	const x = evalLength(tx.trim(), units)
	const y = evalLength(ty.trim(), units)
	const scale = Number.parseFloat((fnArgs(v, "scale3d") ?? fnArgs(v, "scale"))?.[0] ?? "1")
	if (x === null || y === null || !Number.isFinite(scale)) return null
	return { x, y, scale }
}

/** CSS lists pair by index, a shorter list repeating; each property lands on its channel. */
const composeTransition = (t: Accumulator["transition"]): Style["transition"] => {
	const properties = splitTop(t.property ?? "all", /,/).map((p) => p.trim())
	const durations = splitTop(t.duration ?? "0s", /,/)
	const timings = splitTop(t.timing ?? "ease", /,/)
	const delays = splitTop(t.delay ?? "0s", /,/)
	const out: Style["transition"] = {}
	properties.forEach((property, i) => {
		const duration = parseSeconds(durations[i % durations.length] ?? "0s")
		if (duration <= 0 || property === "none") return
		const timing: Timing = {
			duration,
			delay: parseSeconds(delays[i % delays.length] ?? "0s"),
			ease: parseEase((timings[i % timings.length] ?? "ease").trim()),
		}
		const channels =
			property === "all"
				? CHANNELS
				: [CHANNEL_OF.get(property) ?? (LAYOUT_PROPERTY.test(property) ? "layout" : undefined)]
		for (const channel of channels)
			if (channel !== undefined && out[channel] === undefined) out[channel] = timing
	})
	return Object.keys(out).length === 0 ? undefined : out
}

type Compiler = Awaited<ReturnType<typeof compile>>
/** A stylesheet compiled for `classes`, the classes its sources use. */
export type PrecompiledStyles = { css: string; classes: Array<string> }

/** Tailwind's compiler for `stylesheet`, loaded on demand: a precompiled boot never imports it. */
const compileSheet = async (stylesheet: string): Promise<Compiler> => {
	const { compile } = await import("@tailwindcss/node")
	const base = stylesheet.slice(0, stylesheet.lastIndexOf("/") + 1)
	const css = await readFile(stylesheet, "utf8")
	return compile(css, { base, from: stylesheet, onDependency() {} })
}

/** Every class the sheet's `@source` files use, as Tailwind's build scans them. */
const scanSources = async (compiler: Compiler): Promise<Array<string>> => {
	const sources = [...compiler.sources]
	if (compiler.root !== null && compiler.root !== "none") sources.push({ ...compiler.root, negated: false })
	if (sources.length === 0) return []
	const { Scanner } = await import("@tailwindcss/oxide")
	return new Scanner({ sources }).scan()
}

const NO_STATES: ReadonlySet<string> = new Set()
/** A pointer press focuses: `:focus` and `:focus-within` hold, `:focus-visible` does not. */
const POINTER_FOCUS: ReadonlySet<string> = new Set(["focus", "focus-within"])
const KEYBOARD_FOCUS: ReadonlySet<string> = new Set(["focus", "focus-within", "focus-visible"])
const PRESSED: ReadonlySet<string> = new Set(["active"])

/** The ring a style draws: its outline, else its outermost spread-only shadow (Tailwind `ring-*`). */
const ringOf = (s: Style): Ring | undefined => {
	if (s.outline !== undefined) return s.outline
	const rings = (s.shadows ?? []).filter(
		(r) => !r.inset && r.x === 0 && r.y === 0 && r.blur === 0 && r.spread > 0,
	)
	const outer = rings.reduce<Shadow | undefined>(
		(a, r) => (a === undefined || r.spread > a.spread ? r : a),
		undefined,
	)
	if (outer === undefined) return undefined
	// A `ring-offset-*` is the ring inside it: the outer ring starts where it ends.
	const inner = rings.filter((r) => r !== outer).reduce((m, r) => Math.max(m, r.spread), 0)
	return { width: outer.spread - inner, offset: inner, color: outer.color }
}

const sameRing = (a: Ring, b: Ring | undefined) =>
	b !== undefined && a.width === b.width && a.offset === b.offset && a.color === b.color

/** Tags the host lays out inline when their Style has no display (host main.rs `is_inline`). */
const INLINE_TAGS = new Set([
	"span",
	"a",
	"kbd",
	"label",
	"button",
	"strong",
	"em",
	"code",
	"time",
	"b",
	"i",
	"s",
	"u",
	"mark",
])

/** The user-agent defaults Tailwind's preflight leaves in place and the host does not assume. */
const UA_CSS = `
svg:not(:root) { overflow: hidden }
img, video, canvas, input, select { overflow: clip }
input, select, textarea { display: inline-block }
button, input[type="button"], input[type="submit"], input[type="reset"] { text-align: center }
small, abbr, sub, sup, q, cite, dfn, var, samp, bdi, bdo { display: inline }
`

/** Properties applied before the rest, so `em`, `currentColor` and line heights see them. */
const TEXT_FIRST = new Set(["color", "line-height", "font-weight"])

/** One element's resolution in progress. */
type Accumulator = {
	tag: string
	style: Style
	text: TextContext
	vars: Map<string, string>
	scope: Scope
	containerType: "" | "size" | "inline-size"
	containerNames: Array<string>
	/** The last `box-shadow` value: composed once every custom property is known. */
	shadows: string | null
	outline: { style?: string; width?: string; color?: string; offset?: string }
	/** The `animation` shorthand, substituted; composed in `finish` with its keyframes. */
	animation?: string
	/** `position: fixed`: percentage insets are of the window. */
	fixed?: boolean
	/** `sr-only` (`clip-path: inset(50%)`): drawn nowhere. */
	srOnly?: boolean
	/** Insets under group hover, [left, top, right, bottom], against the resting ones. */
	groupInset?: Array<number | null>
	/** `transition-*` longhands as written, composed in `finish`. */
	transition: { property?: string; duration?: string; timing?: string; delay?: string }
	/** This element's own line-height, when it sets one. */
	line?: LineSpec
}

/** The `space-x/y` margin as a gap, with the rule's own custom properties in view. */
const gapOf = (r: ChainRule, scope: Scope, units: Units): number | undefined => {
	const vars = new Map(scope.vars)
	for (const d of r.decls) if (d.prop.startsWith("--")) vars.set(d.prop, d.value)
	const gap = r.decls.find((d) => d.prop === "margin-block-end" || d.prop === "margin-inline-end")
	const n = gap === undefined ? null : evalLength(substitute(gap.value, vars), units)
	return n ?? undefined
}

/** Text context the children inherit. */
const childText = (parent: TextContext, s: Style, acc: Accumulator): TextContext => ({
	color: s.color ?? parent.color,
	size: s.fontSize ?? parent.size,
	weight: s.fontWeight ?? parent.weight,
	line: acc.line ?? (s.lineHeight !== undefined ? { px: s.lineHeight } : parent.line),
})

/** The content box children see: known only when this element's size is (or both insets pin it). */
/** A length that is only a share of the parent (`calc(1/2 * 100%)`), as a fraction; else null. */
const fractionOf = (v: string, units: Units): number | null => {
	const at100 = evalLength(v, units, 100)
	const at200 = evalLength(v, units, 200)
	if (at100 === null || at200 === null || at100 === 0) return null
	return Math.abs(at200 - 2 * at100) < 1e-6 ? at100 / 100 : null
}

const contentBox = (s: Style, parent: Box): Box => {
	const outer = (v: Px | undefined, p: number | undefined, from: number | null, to: number | null) => {
		if (typeof v === "number") return v
		if (v === "full") return p
		if (typeof v === "object") return p === undefined ? undefined : p * v.frac
		if (v === undefined && p !== undefined && from !== null && to !== null) return p - from - to
		return undefined
	}
	const [left = null, top = null, right = null, bottom = null] = s.absolute ?? []
	const w = outer(s.w, parent.w, left, right)
	const h = outer(s.h, parent.h, top, bottom)
	const pad = s.pad ?? [0, 0, 0, 0]
	const border = s.border ?? [0, 0, 0, 0]
	return {
		w: w === undefined ? undefined : w - pad[1] - pad[3] - border[1] - border[3],
		h: h === undefined ? undefined : h - pad[0] - pad[2] - border[0] - border[2],
	}
}

const nearestContainer = (containers: Array<ContainerBox>, name: string) =>
	containers.find((c) => name === "" || c.names.includes(name))

type ContextAnswer = (link: Context) => boolean

/** Whether `node` matches `c`; `context` answers c's ancestor/sibling conditions (null: none hold). */
const matchCompound = (
	c: Compound,
	node: NodeInfo,
	context: ContextAnswer | null,
	hasDescendant: (match: (node: NodeInfo) => boolean, childrenOnly: boolean) => boolean,
): boolean => {
	if (c.tag !== undefined && c.tag !== node.tag) return false
	for (const cls of c.classes) if (!node.classes.includes(cls)) return false
	for (const a of c.attrs) if (!matchAttr(a, node)) return false
	for (const p of c.pseudos) {
		switch (p.k) {
			case "not":
				if (p.list.some((x) => matchCompound(x, node, context, hasDescendant))) return false
				break
			case "is":
				if (!p.list.some((x) => matchCompound(x, node, context, hasDescendant))) return false
				break
			case "has": {
				const found = p.list.some((rel) =>
					hasDescendant(
						(d) =>
							rel.compound.ctx.length === 0 &&
							matchCompound(rel.compound, d, null, () => false),
						rel.comb === ">",
					),
				)
				if (!found) return false
				break
			}
			case "nth": {
				const { index, count } = node
				if (index === undefined || (p.fromEnd && count === undefined)) return false
				const pos = p.fromEnd ? (count ?? 0) - index : index + 1
				const ok = p.a === 0 ? pos === p.b : (pos - p.b) / p.a >= 0 && (pos - p.b) % p.a === 0
				if (!ok) return false
				break
			}
			case "empty":
				if (node.empty !== true) return false
				break
			case "never":
				if (node.states?.has(p.name) !== true) return false
				break
		}
	}
	for (const link of c.ctx) if (context === null || !context(link)) return false
	return true
}

const matchAttr = (a: { name: string; op: string; value: string; insensitive: boolean }, node: NodeInfo) => {
	const raw = a.name === "class" ? node.classes.join(" ") : node.attrs[a.name]
	if (raw === undefined) return false
	const actual = a.insensitive ? raw.toLowerCase() : raw
	const want = a.insensitive ? a.value.toLowerCase() : a.value
	switch (a.op) {
		case "":
			return true
		case "=":
			return actual === want
		case "~=":
			return actual.split(/\s+/).includes(want)
		case "*=":
			return actual.includes(want)
		case "^=":
			return actual.startsWith(want)
		case "$=":
			return actual.endsWith(want)
		case "|=":
			return actual === want || actual.startsWith(`${want}-`)
		default:
			return false
	}
}

type Anchor = { cls: string; at: number; path: Array<Context> }

/** The utility class a rule belongs to: the first class in the selector text (not `.dark`/`.light`). */
const findAnchor = (subject: Compound): Anchor | null => {
	let best: Anchor | null = null
	const stack: Array<{ c: Compound; path: Array<Context> }> = [{ c: subject, path: [] }]
	for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
		const { c, path } = next
		for (let i = 0; i < c.classes.length; i++) {
			const cls = c.classes[i] ?? ""
			const at = c.classAt[i] ?? Number.POSITIVE_INFINITY
			if (cls === "dark" || cls === "light") continue
			if (best === null || at < best.at) best = { cls, at, path }
		}
		for (const link of c.ctx) stack.push({ c: link.compound, path: [...path, link] })
	}
	return best
}

/** `node` without the context link that the chain now expresses. */
const withoutLink = (node: Compound, link: Context): Compound => ({
	...node,
	ctx: node.ctx.filter((l) => l !== link),
})

const isNotLastChild = (c: Compound) => {
	if (c.tag !== undefined || c.classes.length > 0 || c.attrs.length > 0 || c.ctx.length > 0) return false
	const [p] = c.pseudos
	if (c.pseudos.length !== 1 || p === undefined || p.k !== "not" || p.list.length !== 1) return false
	const [inner] = p.list
	const [nth] = inner?.pseudos ?? []
	return inner?.pseudos.length === 1 && nth?.k === "nth" && nth.fromEnd && nth.a === 0 && nth.b === 1
}

/** Media features of a desktop window with a fine pointer and default preferences. */
const MEDIA_TRUE = new Set([
	"hover: hover",
	"any-hover: hover",
	"pointer: fine",
	"any-pointer: fine",
	"prefers-reduced-motion: no-preference",
	"prefers-contrast: no-preference",
	"screen",
	"all",
])
const MEDIA_FALSE = new Set([
	"forced-colors: active",
	"pointer: coarse",
	"any-pointer: coarse",
	"prefers-reduced-motion: reduce",
	"prefers-contrast: more",
	"print",
	"hover: none",
])

/** Applies a media query to the gate; false when it is not one Rune can answer. */
const applyMedia = (params: string, gate: Gate): boolean => {
	for (const part of params.split(/\s+and\s+/)) {
		const q = part
			.trim()
			.replace(/^\(|\)$/g, "")
			.trim()
		const range = /^width\s*(>=|>|<=|<)\s*([\d.]+)(rem|px|em)$/.exec(q)
		const minMax = /^(min|max)-width:\s*([\d.]+)(rem|px|em)$/.exec(q)
		if (range) {
			const n = Number(range[2]) * (range[3] === "px" ? 1 : REM)
			if (range[1] === ">=") gate.minWidth = Math.max(gate.minWidth, n)
			else if (range[1] === ">") gate.minWidth = Math.max(gate.minWidth, n + 0.01)
			else if (range[1] === "<") gate.maxWidth = Math.min(gate.maxWidth, n)
			else gate.maxWidth = Math.min(gate.maxWidth, n + 0.01)
		} else if (minMax) {
			const n = Number(minMax[2]) * (minMax[3] === "px" ? 1 : REM)
			if (minMax[1] === "min") gate.minWidth = Math.max(gate.minWidth, n)
			else gate.maxWidth = Math.min(gate.maxWidth, n + 0.01)
		} else if (MEDIA_FALSE.has(q)) {
			gate.minWidth = Number.POSITIVE_INFINITY
		} else if (!MEDIA_TRUE.has(q)) {
			return false
		}
	}
	return true
}

const parseContainer = (params: string): Gate["container"] | null => {
	const m = /^([\w-]+\s+)?\(\s*width\s*(>=|<)\s*([\d.]+)(rem|px)\s*\)$/.exec(params.trim())
	if (!m) return null
	const n = Number(m[3]) * (m[4] === "px" ? 1 : REM)
	return {
		name: (m[1] ?? "").trim(),
		minWidth: m[2] === ">=" ? n : 0,
		maxWidth: m[2] === "<" ? n : Number.POSITIVE_INFINITY,
	}
}

/** `@supports`: Chromium's answer for the feature tests Tailwind emits (its @property fallback is false). */
const supported = (params: string) => !/-webkit-hyphens|-moz-orient|^\s*not\s/.test(params)

const CORNERS = new Map([
	["border-top-left-radius", 0],
	["border-start-start-radius", 0],
	["border-top-right-radius", 1],
	["border-start-end-radius", 1],
	["border-bottom-right-radius", 2],
	["border-end-end-radius", 2],
	["border-bottom-left-radius", 3],
	["border-end-start-radius", 3],
])

/** Inherited properties whose `inherit` keyword simply leaves the Style field unset. */
const INHERITED_FIELD = new Map<string, keyof Style>([
	["color", "color"],
	["font-size", "fontSize"],
	["font-weight", "fontWeight"],
	["line-height", "lineHeight"],
	["font-family", "fontFamily"],
	["font-style", "italic"],
	["letter-spacing", "letterSpacing"],
	["text-transform", "textTransform"],
	["text-align", "textAlign"],
	["visibility", "visibility"],
])

/** Paint-free or cosmetic in this renderer; not worth a warning. */
const IGNORED = new Set([
	"border-style",
	"border-right-style",
	"border-bottom-style",
	"border-top-style",
	"border-left-style",
	"border-inline-style",
	"border-block-style",
	"cursor",
	"user-select",
	"-webkit-user-select",
	"-webkit-font-smoothing",
	"-moz-osx-font-smoothing",
	"touch-action",
	"transition",
	"transition-behavior",
	"animation-duration",
	"animation-iteration-count",
	"box-sizing",
	"text-rendering",
	"scrollbar-width",
	"scrollbar-color",
	"scrollbar-gutter",
	"scroll-behavior",
	"scroll-margin-bottom",
	"scroll-padding",
	"overscroll-behavior",
	"overscroll-behavior-x",
	"overscroll-behavior-y",
	"-webkit-tap-highlight-color",
	"-webkit-text-size-adjust",
	"tab-size",
	"font-feature-settings",
	"font-variation-settings",
	"font-variant-numeric",
	"list-style",
	"list-style-type",
	"appearance",
	"-webkit-appearance",
	"vertical-align",
	"resize",
	"text-indent",
	"border-collapse",
	"text-decoration-color",
	"text-decoration-style",
	"text-decoration-thickness",
	"text-underline-offset",
	"will-change",
	"content",
	"quotes",
	"text-box",
	"text-box-trim",
	"text-box-edge",
	"word-break",
	"overflow-wrap",
	"hyphens",
	"isolation",
	"contain",
	"content-visibility",
	"-webkit-text-stroke",
	"forced-color-adjust",
	"field-sizing",
	"caret-color",
	"accent-color",
	"interpolate-size",
	"backface-visibility",
	"mask-image",
	"-webkit-mask-image",
	"mask-composite",
	"-webkit-mask-composite",
	"background-repeat",
	"background-position",
	"background-size",
	"background-clip",
	"background-origin",
	"stroke-width",
	"fill",
	"stroke",
	"shape-rendering",
	"line-clamp",
	"-webkit-line-clamp",
	"-webkit-box-orient",
])

function expandRepeat(v: string): Array<string> {
	const rep = /^repeat\((\d+),\s*(.+)\)$/.exec(v)
	if (rep)
		return Array.from({ length: Number(rep[1]) }, () =>
			(rep[2] ?? "").replace(/minmax\(0,\s*(.+)\)/, "$1"),
		)
	return splitTopLevel(v)
}

/** Whitespace-separated tracks, keeping `minmax(200px, 280px)` whole. */
const splitTopLevel = (v: string): Array<string> => {
	const out: Array<string> = []
	let depth = 0
	let current = ""
	for (const ch of v.trim()) {
		if (ch === "(") depth++
		if (ch === ")") depth--
		if (/\s/.test(ch) && depth === 0) {
			if (current !== "") out.push(current)
			current = ""
		} else current += ch
	}
	if (current !== "") out.push(current)
	return out
}

/** `flex` shorthand: keywords first, then `<grow> [<shrink>] [<basis>]`. */
export const parseFlex = (v: string): { grow: number; shrink: number } | null => {
	if (v === "none") return { grow: 0, shrink: 0 }
	if (v === "auto") return { grow: 1, shrink: 1 }
	if (v === "initial") return { grow: 0, shrink: 1 }
	const parts = v.split(/\s+/)
	const numbers = parts.filter((p) => /^[\d.]+$/.test(p)).map(Number)
	// A lone basis (`flex: 10px`) is `1 1 10px`.
	if (numbers.length === 0) return parts.length === 1 ? { grow: 1, shrink: 1 } : null
	return { grow: numbers[0] ?? 0, shrink: numbers[1] ?? 1 }
}

const bolder = (w: number) => (w < 350 ? 400 : w < 550 ? 700 : 900)
const lighter = (w: number) => (w < 550 ? 100 : w < 750 ? 400 : 700)

const ratio = (v: string) => (v.endsWith("%") ? Number(v.slice(0, -1)) / 100 : Number(v))

/** `a`, `a b`, `a b c`, `a b c d` to top right bottom left. */
const boxShorthand = (v: string): [string, string, string, string] => {
	const [t = "0", r = t, b = t, l = r] = splitTop(v, /\s/)
	return [t, r, b, l]
}

const parseOutlineShorthand = (v: string): Accumulator["outline"] => {
	const out: Accumulator["outline"] = { style: "none" }
	for (const part of splitTop(v, /\s/)) {
		if (/^(none|hidden|solid|dashed|dotted|double|groove|ridge|inset|outset|auto)$/.test(part))
			out.style = part
		else if (/^-?[\d.]/.test(part) || part.startsWith("calc(")) out.width = part
		else out.color = part
	}
	return out
}

/** A pure percentage (`50%`, `calc(1 / 2 * 100%)`) as its number; null when it mixes in lengths. */
const percentage = (v: string, units: Units): number | null => {
	const a = evalLength(v, units, 100)
	const b = evalLength(v, units, 200)
	return a !== null && b !== null && Math.abs(b - 2 * a) < 1e-9 && a !== 0 ? a : null
}

const parseTranslate = (tx: string, ty: string, units: Units): [number, number] | "none" | null => {
	if (tx === "none") return "none"
	const x = evalLength(tx, units)
	const y = evalLength(ty, units)
	if (x === null || y === null) return null
	return x === 0 && y === 0 ? "none" : [x, y]
}

/** A `box-shadow` list in paint order (bottom-most first), invisible shadows dropped; null when unparsable. */
const parseShadowList = (v: string, current: string, units: Units): Array<Shadow> | null => {
	if (v === "none" || v === "") return []
	const out: Array<Shadow> = []
	for (const part of splitTop(v, /,/)) {
		let inset = false
		const lengths: Array<number> = []
		let c: string | null = null
		for (const t of splitTop(part, /\s/)) {
			if (t === "inset") {
				inset = true
				continue
			}
			const n = /^-?[\d.]|^calc\(/.test(t) ? evalLength(t, units) : null
			if (n !== null) lengths.push(n)
			else {
				c = color(t, current)
				if (c === null) return null
			}
		}
		const resolved = c ?? color("currentcolor", current) ?? "#00000000"
		const [x = 0, y = 0, blur = 0, spread = 0] = lengths
		if (resolved.endsWith("00")) continue
		out.push({ x, y, blur, spread, color: resolved, inset })
	}
	return out.reverse()
}

const SIDE_ANGLES = new Map([
	["top", 0],
	["right", 90],
	["bottom", 180],
	["left", 270],
	["top right", 45],
	["right top", 45],
	["bottom right", 135],
	["right bottom", 135],
	["bottom left", 225],
	["left bottom", 225],
	["top left", 315],
	["left top", 315],
])

/** `background-image`: one `url()` or one `linear-gradient()`; "none" when there is none. */
const parseBackgroundImage = (v: string, current: string): Style["bgImage"] | "none" | null => {
	if (v === "none" || v === "initial") return "none"
	const url = /^url\(\s*["']?([^"')]*)["']?\s*\)$/.exec(v)
	if (url) return { url: url[1] ?? "" }
	const lin = /^linear-gradient\((.*)\)$/.exec(v)
	if (!lin) return null
	const parts = splitTop(lin[1] ?? "", /,/)
	let angle = 180
	const head = (parts[0] ?? "")
		.replace(/\s*in\s+[a-z-]+(\s+(shorter|longer|increasing|decreasing)\s+hue)?$/, "")
		.trim()
	const deg = /^(-?[\d.]+)(deg|turn|rad)$/.exec(head)
	if (deg) {
		const n = Number(deg[1])
		angle = deg[2] === "turn" ? n * 360 : deg[2] === "rad" ? (n * 180) / Math.PI : n
		parts.shift()
	} else if (head.startsWith("to ")) {
		angle = SIDE_ANGLES.get(head.slice(3)) ?? 180
		parts.shift()
	} else if (head === "") parts.shift()
	const stops: Array<{ color: string; at: number }> = []
	for (const p of parts) {
		const m = /^(.*?)\s+(-?[\d.]+)%$/.exec(p)
		const c = color(m ? (m[1] ?? "") : p, current)
		if (c === null) return null
		stops.push({ color: c, at: m ? Number(m[2]) / 100 : Number.NaN })
	}
	stops.forEach((s, i) => {
		if (Number.isNaN(s.at)) s.at = stops.length === 1 ? 0 : i / (stops.length - 1)
	})
	return { gradient: { angle: ((angle % 360) + 360) % 360, stops } }
}

/** Replaces `var(--x, fallback)`, fallbacks may nest parentheses and further `var()`s. */
export function substitute(value: string, vars: Map<string, string>): string {
	return substituteStrict(value, vars) ?? ""
}

/**
 * `substitute`, but null when the value is invalid at computed-value time: a `var()` with no
 * fallback names a property that is unset, or itself invalid (as `--x: var(--undefined)` is).
 */
function substituteStrict(value: string, vars: Map<string, string>, depth = 0): string | null {
	if (depth > 12) return null
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
		const found = vars.get(name)
		const resolved = found === undefined || found === "" ? null : substituteStrict(found, vars, depth + 1)
		const fallback =
			comma < 0 ? null : substituteStrict(value.slice(comma + 1, end).trim(), vars, depth + 1)
		const chosen = resolved ?? fallback
		if (chosen === null) return null
		out += chosen
		i = end + 1
	}
	return out + value.slice(i)
}

/** Splits on `sep` outside parentheses. */
function splitTop(text: string, sep: RegExp): Array<string> {
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

/** What relative units mean here: px per em, per 1vw/1vh and per 1cqw/1cqh (undefined: no container). */
type Units = { em: number; vw: number; vh: number; cqw?: number; cqh?: number }

const unitScale = (unit: string, units: Units, percentOf: number | undefined): number | null => {
	switch (unit) {
		case "":
		case "px":
			return 1
		case "rem":
			return REM
		case "em":
			return units.em
		case "%":
			return percentOf === undefined ? null : percentOf / 100
		case "cqw":
		case "cqi":
			return units.cqw ?? null
		case "cqh":
		case "cqb":
			return units.cqh ?? null
		case "cqmin":
		case "cqmax": {
			const { cqw, cqh } = units
			if (cqw === undefined || cqh === undefined) return null
			return unit === "cqmin" ? Math.min(cqw, cqh) : Math.max(cqw, cqh)
		}
		default:
			if (/^[dsl]?v[wi]$/.test(unit)) return units.vw
			if (/^[dsl]?v[hb]$/.test(unit)) return units.vh
			if (/^[dsl]?vmin$/.test(unit)) return Math.min(units.vw, units.vh)
			if (/^[dsl]?vmax$/.test(unit)) return Math.max(units.vw, units.vh)
			return null
	}
}

/**
 * A CSS length or number (with `calc`, `min`, `max`, `clamp`) to px; a unitless number stays a
 * number. Null for percentages (unless `percentOf` gives their base) and anything unknown.
 */
function evalLength(expr: string, units: Units, percentOf?: number): number | null {
	const src = expr.trim()
	const tokens = src.match(/(?:\d*\.\d+|\d+)(?:e[+-]?\d+)?[a-z%]*|infinity|[a-z-]+\(|[+\-*/(),]|\S/gi)
	if (tokens === null) return null
	let i = 0
	let failed = false
	const atom = (): number => {
		const t = (tokens[i++] ?? "").toLowerCase()
		if (t === "(" || t === "calc(") {
			const v = sum()
			if (tokens[i++] !== ")") failed = true
			return v
		}
		if (t === "min(" || t === "max(" || t === "clamp(") {
			const args = [sum()]
			while (tokens[i] === ",") {
				i++
				args.push(sum())
			}
			if (tokens[i++] !== ")") failed = true
			if (t === "min(") return Math.min(...args)
			if (t === "max(") return Math.max(...args)
			const [lo = 0, mid = 0, hi = 0] = args
			return Math.max(lo, Math.min(mid, hi))
		}
		if (t === "-") return -atom()
		if (t === "+") return atom()
		if (t === "infinity") return 1e9
		const m = /^((?:\d*\.\d+|\d+)(?:e[+-]?\d+)?)([a-z%]*)$/.exec(t)
		const scale = m ? unitScale(m[2] ?? "", units, percentOf) : null
		if (!m || scale === null) {
			failed = true
			return 0
		}
		return Number(m[1]) * scale
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
	return failed || i < tokens.length || !Number.isFinite(v) ? null : v
}

/** Attributes that can select styles; `value` changes on every keystroke and selects nothing. */
