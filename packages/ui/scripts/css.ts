import type {
	ColorExpr,
	InteractionState,
	Declarations,
	Layer,
	Length,
	PartStyles,
	Recipe,
	State,
	Tokens,
} from "../src/style/schema.ts"
import { interactionStates } from "../src/style/schema.ts"

/** Writes `tokens.css`: custom properties for the tokens, then one rule set per recipe. */

/** The size class on the web: `regular` from Tailwind's `sm` breakpoint up. */
export const REGULAR_MEDIA = "(width >= 40rem)"

const safe = (name: string) => name.replaceAll(".", "_")
export const colorVar = (name: string) =>
	name.startsWith("palette.") ? `var(--hz-palette-${safe(name.slice(8))})` : `var(--hz-color-${safe(name)})`
const spaceVar = (step: string) => `var(--hz-space-${safe(step)})`

export const colorCss = (expr: ColorExpr): string => {
	if ("literal" in expr) return expr.literal
	if ("ref" in expr) return colorVar(expr.ref)
	if ("mix" in expr)
		return `color-mix(in oklab, ${colorCss(expr.mix[0])} ${expr.mix[1]}%, ${colorCss(expr.mix[2])})`
	return `color-mix(in oklab, ${colorCss(expr.alpha[0])} ${expr.alpha[1] * 100}%, transparent)`
}

const sameExpr = (a: ColorExpr, b: ColorExpr) => JSON.stringify(a) === JSON.stringify(b)

const tokenBlock = (tokens: Tokens): string => {
	const light: string[] = []
	const dark: string[] = []
	for (const [name, value] of Object.entries(tokens.palette))
		light.push(`--hz-palette-${safe(name)}: ${value};`)
	for (const [name, value] of Object.entries(tokens.color)) {
		light.push(`--hz-color-${safe(name)}: ${colorCss(value.light)};`)
		if (!sameExpr(value.light, value.dark))
			dark.push(`--hz-color-${safe(name)}: ${colorCss(value.dark)};`)
	}
	light.push(`--hz-font-sans: ${tokens.font.sans};`, `--hz-font-mono: ${tokens.font.mono};`)
	light.push(`--hz-font-sans-features: ${tokens.font.sansFeatures};`)
	light.push(
		`--hz-weight-regular: ${tokens.font.weight.regular};`,
		`--hz-weight-strong: ${tokens.font.weight.strong};`,
		`--hz-weight-semibold: ${tokens.font.weight.semibold};`,
		`--hz-weight-bold: ${tokens.font.weight.bold};`,
	)
	const regular: string[] = []
	for (const [role, metrics] of Object.entries(tokens.text)) {
		light.push(
			`--hz-text-${role}-size: ${metrics.compact.size}px;`,
			`--hz-text-${role}-leading: ${metrics.compact.lineHeight}px;`,
		)
		regular.push(
			`--hz-text-${role}-size: ${metrics.regular.size}px;`,
			`--hz-text-${role}-leading: ${metrics.regular.lineHeight}px;`,
		)
		if (trackedRoles(tokens).has(role)) {
			light.push(`--hz-text-${role}-tracking: ${metrics.compact.tracking ?? 0}px;`)
			regular.push(`--hz-text-${role}-tracking: ${metrics.regular.tracking ?? 0}px;`)
		}
	}
	for (const [step, px] of Object.entries(tokens.space)) light.push(`--hz-space-${safe(step)}: ${px}px;`)
	for (const [name, px] of Object.entries(tokens.radius)) light.push(`--hz-radius-${name}: ${px}px;`)
	for (const [name, ms] of Object.entries(tokens.duration)) light.push(`--hz-duration-${name}: ${ms}ms;`)
	for (const [name, curve] of Object.entries(tokens.easing))
		light.push(`--hz-ease-${name}: cubic-bezier(${curve.join(", ")});`)
	for (const [name, shadow] of Object.entries(tokens.shadow)) {
		light.push(`--hz-shadow-${name}: ${shadow.light};`)
		dark.push(`--hz-shadow-${name}: ${shadow.dark};`)
	}
	const block = (selector: string, lines: ReadonlyArray<string>, indent = "") =>
		`${indent}${selector} {\n${lines.map((line) => `${indent}\t${line}`).join("\n")}\n${indent}}`
	return [
		block(":root", light),
		block(".dark", dark),
		`@media ${REGULAR_MEDIA} {\n${block(":root", regular, "\t")}\n}`,
		// Every primitive's own element and parts start from nothing, as Tailwind's preflight would.
		block(":where([data-hz], [data-hz-part], [data-hz-slot])", [
			"box-sizing: border-box;",
			"margin: 0;",
			"padding: 0;",
			"border: 0 solid transparent;",
			"background: none;",
			"color: inherit;",
			"font: inherit;",
			"letter-spacing: inherit;",
			"text-align: inherit;",
			"text-decoration: none;",
			"appearance: none;",
		]),
		// `hidden` wins over a recipe's `display`: hosts hide parts with it (a badge at 0, a fallback).
		block(":where([data-hz], [data-hz-part], [data-hz-slot])[hidden]", ["display: none !important;"]),
		block(":where([data-hz]:not([data-hz] *))", [
			"font-family: var(--hz-font-sans);",
			"font-feature-settings: var(--hz-font-sans-features);",
			"font-variation-settings: normal;",
			"-webkit-font-smoothing: antialiased;",
			"-moz-osx-font-smoothing: grayscale;",
			"text-rendering: optimizeLegibility;",
		]),
		block(':where([data-hz="icon"], [data-hz="icon"] > svg)', [
			"display: block;",
			"width: 100%;",
			"height: 100%;",
		]),
	].join("\n\n")
}

/** Roles whose tracking is set in either size class: only they write `letter-spacing`. */
const trackedRoles = (tokens: Tokens): ReadonlySet<string> =>
	new Set(
		Object.entries(tokens.text)
			.filter(([, m]) => m.compact.tracking !== undefined || m.regular.tracking !== undefined)
			.map(([role]) => role),
	)

/** The text role set in the mono family, with the kit's slashed zero (`--font-mono--font-feature-settings`). */
export const MONO_ROLE = "code"

const length = (value: Length<string>) =>
	typeof value === "string" ? spaceVar(value) : `calc(${spaceVar(value.step)} - 1px)`

const declarations = (d: Declarations, tracked: ReadonlySet<string>): ReadonlyArray<string> => {
	const out: string[] = []
	const add = (property: string, value: string) => out.push(`${property}: ${value};`)
	if (d.layout === "contents") add("display", "contents")
	else if (d.layout !== undefined) {
		add("display", d.layout === "inline-row" ? "inline-flex" : "flex")
		add("flex-direction", d.layout === "column" ? "column" : "row")
	}
	if (d.wrap !== undefined) add("flex-wrap", d.wrap ? "wrap" : "nowrap")
	if (d.fill) add("width", "100%")
	if (d.align !== undefined)
		add("align-items", d.align === "center" ? "center" : d.align === "start" ? "flex-start" : "flex-end")
	if (d.justify !== undefined) add("justify-content", d.justify === "start" ? "flex-start" : "center")
	if (d.background !== undefined)
		add("background-color", d.background === "transparent" ? "transparent" : colorVar(d.background))
	if (d.color !== undefined) add("color", colorVar(d.color))
	if (d.borderWidth !== undefined) {
		add("border-style", "solid")
		add("border-width", d.borderWidth === "hairline" ? "1px" : "0")
	}
	if (d.borderColor !== undefined)
		add("border-color", d.borderColor === "transparent" ? "transparent" : colorVar(d.borderColor))
	if (d.radius !== undefined) add("border-radius", `var(--hz-radius-${d.radius})`)
	if (d.ring !== undefined) add("box-shadow", `inset 0 0 0 1px ${colorVar(d.ring)}`)
	if (d.divider !== undefined) add("border-bottom", `1px solid ${colorVar(d.divider)}`)
	if (d.paddingX !== undefined) add("padding-inline", length(d.paddingX))
	if (d.paddingStart !== undefined) add("padding-inline-start", length(d.paddingStart))
	if (d.paddingY !== undefined) add("padding-block", length(d.paddingY))
	if (d.gap !== undefined) add("column-gap", spaceVar(d.gap))
	if (d.rowGap !== undefined) add("row-gap", spaceVar(d.rowGap))
	if (d.marginBottom !== undefined) add("margin-bottom", spaceVar(d.marginBottom))
	if (d.marginX !== undefined) add("margin-inline", spaceVar(d.marginX))
	if (d.bleedX !== undefined) add("margin-inline", `calc(${spaceVar(d.bleedX)} * -1)`)
	if (d.minHeight !== undefined) add("min-height", spaceVar(d.minHeight))
	if (d.size !== undefined) {
		add("width", spaceVar(d.size))
		add("height", spaceVar(d.size))
	}
	if (d.text !== undefined) {
		add("font-size", `var(--hz-text-${d.text}-size)`)
		add("line-height", `var(--hz-text-${d.text}-leading)`)
		if (tracked.has(d.text)) add("letter-spacing", `var(--hz-text-${d.text}-tracking)`)
		if (d.text === MONO_ROLE) {
			add("font-family", "var(--hz-font-mono)")
			add("font-feature-settings", '"zero"')
		}
	}
	if (d.leading !== undefined) add("line-height", spaceVar(d.leading))
	if (d.strong !== undefined)
		add("font-weight", d.strong ? "var(--hz-weight-strong)" : "var(--hz-weight-regular)")
	if (d.weight !== undefined) add("font-weight", `var(--hz-weight-${d.weight})`)
	if (d.uppercase) add("text-transform", "uppercase")
	if (d.textAlign !== undefined) add("text-align", d.textAlign)
	if (d.lineClamp !== undefined) {
		add("display", "-webkit-box")
		add("-webkit-box-orient", "vertical")
		add("-webkit-line-clamp", String(d.lineClamp))
		add("overflow", "hidden")
	}
	if (d.overflow !== undefined) {
		add(d.overflow === "scrollX" ? "overflow-x" : "overflow-y", "auto")
		add(d.overflow === "scrollX" ? "overflow-y" : "overflow-x", "hidden")
	}
	// Set only when on: any stroke value, even 0, changes how Chromium rasters text.
	if (d.stroke) add("-webkit-text-stroke", "0.011em currentColor")
	if (d.numeric !== undefined) add("font-variant-numeric", d.numeric ? "tabular-nums" : "normal")
	if (d.opacity !== undefined) add("opacity", String(d.opacity))
	if (d.shadow !== undefined) add("box-shadow", `var(--hz-shadow-${d.shadow})`)
	if (d.truncate) {
		add("min-width", "0")
		add("overflow", "hidden")
		add("text-overflow", "ellipsis")
		add("white-space", "nowrap")
	}
	if (d.nowrap) add("white-space", "nowrap")
	if (d.grow !== undefined) add("flex-grow", d.grow ? "1" : "0")
	if (d.shrink !== undefined) add("flex-shrink", d.shrink ? "1" : "0")
	if (d.transition !== undefined) {
		add("transition-property", "color, background-color, border-color, box-shadow, opacity")
		add("transition-duration", `var(--hz-duration-${d.transition})`)
		add("transition-timing-function", "var(--hz-ease-out)")
	}
	return out
}

const kebab = (name: string) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)

const interactionSelector = {
	hover: ":hover",
	pressed: ":active",
	focusVisible: ":focus-visible",
} as const satisfies Record<InteractionState, string>

const isInteraction = (state: State): state is InteractionState =>
	interactionStates.some((interaction) => interaction === state)

/** The condition a layer adds to the root selector. */
const stateSelector = (recipe: Recipe, state: State) =>
	isInteraction(state)
		? `${interactionSelector[state]}${(recipe.inert ?? []).length === 0 ? "" : `:not(${(recipe.inert ?? []).map((s) => `[data-${kebab(s)}]`).join(", ")})`}`
		: `[data-${kebab(state)}]`

const optionSelector = (recipe: Recipe, option: string, value: string) => {
	const attribute = `data-${kebab(option)}`
	const isDefault = recipe.options[option]?.default === value
	return isDefault ? `:is([${attribute}="${value}"], :not([${attribute}]))` : `[${attribute}="${value}"]`
}

/** A part's path from the root: ` > [data-hz-part="control"] > [data-hz-part="title"]`. */
const partPath = (recipe: Recipe, part: string, seen: ReadonlySet<string> = new Set()): string => {
	const spec = recipe.parts[part]
	if (spec === undefined) throw new Error(`${recipe.primitive} has no part ${part}`)
	if (seen.has(part)) throw new Error(`${recipe.primitive}'s part ${part} is inside itself`)
	const kind = typeof spec === "string" ? spec : spec.kind
	const self =
		kind === "children" ? "[data-hz]" : `[${kind === "slot" ? "data-hz-slot" : "data-hz-part"}="${part}"]`
	const parent = typeof spec === "string" ? "" : partPath(recipe, spec.in, new Set([...seen, part]))
	return `${parent} > ${self}`
}

interface Rule {
	readonly media: ReadonlyArray<string>
	readonly selector: string
	readonly lines: ReadonlyArray<string>
}

const partRules = (
	tracked: ReadonlySet<string>,
	recipe: Recipe,
	root: string,
	styles: PartStyles<string, never>,
	media: ReadonlyArray<string>,
) => {
	const rules: Rule[] = []
	if (styles.root !== undefined)
		rules.push({ media, selector: root, lines: declarations(styles.root, tracked) })
	for (const [part, decls] of Object.entries(styles.parts ?? {}))
		if (decls !== undefined)
			rules.push({
				media,
				selector: `${root}${partPath(recipe, part)}`,
				lines: declarations(decls, tracked),
			})
	return rules
}

/** A layer's rules: compact, then its `regular` overrides, then its states (interactions last). */
const layerRules = (
	tracked: ReadonlySet<string>,
	recipe: Recipe,
	root: string,
	layer: Layer<string, never>,
): ReadonlyArray<Rule> => {
	const states = Object.entries(layer.states ?? {}) as ReadonlyArray<
		[State, NonNullable<Layer<string, never>["states"]>[State]]
	>
	const ordered = [
		...states.filter(([s]) => !isInteraction(s)),
		...states.filter(([s]) => isInteraction(s)),
	]
	return [
		...partRules(tracked, recipe, root, layer, []),
		...(layer.regular === undefined
			? []
			: partRules(tracked, recipe, root, layer.regular, [REGULAR_MEDIA])),
		...ordered.flatMap(([state, styles]) => {
			if (styles === undefined) return []
			const selector = `${root}${stateSelector(recipe, state)}`
			const media = state === "hover" ? ["(hover: hover)"] : []
			return [
				...partRules(tracked, recipe, selector, styles, media),
				...(styles.regular === undefined
					? []
					: partRules(tracked, recipe, selector, styles.regular, [...media, REGULAR_MEDIA])),
			]
		}),
	]
}

export const recipeRules = (recipe: Recipe, tracked: ReadonlySet<string>): ReadonlyArray<Rule> => {
	const root = `[data-hz="${recipe.primitive}"]`
	const asLayer = (layer: Layer<string, never>) => layer
	const states = (recipe.states ?? {}) as Record<string, Layer<string, never> | undefined>
	const ordered = [
		...Object.keys(states).filter((s) => !isInteraction(s as State)),
		...Object.keys(states).filter((s) => isInteraction(s as State)),
	]
	return [
		...layerRules(tracked, recipe, root, recipe.base as Layer<string, never>),
		...Object.entries(recipe.options).flatMap(([option, spec]) =>
			Object.entries(spec.values).flatMap(([value, layer]) =>
				layerRules(
					tracked,
					recipe,
					`${root}${optionSelector(recipe, option, value)}`,
					asLayer(layer as Layer<string, never>),
				),
			),
		),
		...Object.entries(recipe.flags ?? {}).flatMap(([flag, layer]) =>
			layerRules(tracked, recipe, `${root}[data-${kebab(flag)}]`, layer as Layer<string, never>),
		),
		...(recipe.compounds ?? []).flatMap((compound) => {
			const conditions = Object.entries(compound.when)
				.map(([key, value]) =>
					value === true ? `[data-${kebab(key)}]` : optionSelector(recipe, key, String(value)),
				)
				.join("")
			return layerRules(tracked, recipe, `${root}${conditions}`, compound.style as Layer<string, never>)
		}),
		...ordered.flatMap((state) => {
			const layer = states[state]
			return layer === undefined
				? []
				: layerRules(tracked, recipe, `${root}${stateSelector(recipe, state as State)}`, layer)
		}),
	]
}

const printRule = (rule: Rule) => {
	const body = (indent: string) =>
		`${indent}${rule.selector} {\n${rule.lines.map((line) => `${indent}\t${line}`).join("\n")}\n${indent}}`
	if (rule.media.length === 0) return body("")
	return `@media ${rule.media.join(" and ")} {\n${body("\t")}\n}`
}

export const generateCss = (tokens: Tokens, recipes: ReadonlyArray<Recipe>): string =>
	[
		"/* Generated by packages/ui/scripts/generate.ts from src/style. Do not edit. */",
		tokenBlock(tokens),
		...recipes.map(
			(recipe) =>
				`/* ${recipe.primitive} */\n${recipeRules(recipe, trackedRoles(tokens))
					.filter((rule) => rule.lines.length > 0)
					.map(printRule)
					.join("\n\n")}`,
		),
	].join("\n\n") + "\n"
