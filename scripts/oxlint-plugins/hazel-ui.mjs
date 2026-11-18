/**
 * Kit-first and token rules for the web app (`apps/web-foldkit/src`), after Maple's `ui-kit-rules`
 * and `design-rules`. Pages compose the kit (`src/ui`) instead of rebuilding controls from raw
 * elements or the kit's style exports, and every value comes from a token. See
 * `apps/web-foldkit/DESIGN-RULES.md`.
 *
 * Every rule is ratcheted by `ui-kit-baseline.json`: a file listed there may keep the count it had
 * when the rule landed, never more. Dropping below the count is also reported, so the baseline only
 * shrinks (`bun run lint:ui-baseline` rewrites it). `HAZEL_UI_BASELINE=off` reports everything,
 * which is how that script counts.
 */
import { readFileSync } from "node:fs"
import { dirname, relative, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, "../..")
const BASELINE_OFF = process.env.HAZEL_UI_BASELINE === "off"
const BASELINE = BASELINE_OFF ? {} : JSON.parse(readFileSync(resolve(HERE, "ui-kit-baseline.json"), "utf8"))

const BURNDOWN_HINT =
	"This file is on the UI-kit burndown (scripts/oxlint-plugins/ui-kit-baseline.json) with {{allowed}} of these and now has {{count}}."

// ---------------------------------------------------------------------------------------------
// Class strings
// ---------------------------------------------------------------------------------------------

/** `dark:hover:bg-x` → `{ variants: ["dark", "hover"], utility: "bg-x" }`, ignoring colons in brackets. */
const splitToken = (token) => {
	const parts = []
	let depth = 0
	let start = 0
	for (let i = 0; i < token.length; i++) {
		const c = token[i]
		if (c === "[" || c === "(") depth++
		else if (c === "]" || c === ")") depth--
		else if (c === ":" && depth === 0) {
			parts.push(token.slice(start, i))
			start = i + 1
		}
	}
	parts.push(token.slice(start))
	// `!` important marks, either end.
	return { variants: parts.slice(0, -1), utility: parts.at(-1).replace(/^!|!$/g, "") }
}

/** Calls `check(node, tokens)` for every string literal and template chunk. */
const classStrings = (check) => ({
	Literal(node) {
		if (typeof node.value === "string") check(node, node.value.split(/\s+/).filter(Boolean))
	},
	TemplateElement(node) {
		check(node, node.value.raw.split(/\s+/).filter(Boolean))
	},
})

const eachUtility = (isBad) => (_context, push) =>
	classStrings((node, tokens) => {
		for (const token of tokens) {
			const parts = splitToken(token)
			if (isBad(parts)) push(node, { token })
		}
	})

// ---------------------------------------------------------------------------------------------
// The ratchet
// ---------------------------------------------------------------------------------------------

/**
 * `collect(context, push)` returns visitors that `push(node, data)` each violation. A file over its
 * baseline gets every violation reported; a file under it gets one report asking to lower it.
 */
const ratcheted = (name, { description, message, collect }) => ({
	meta: {
		type: "problem",
		docs: { description },
		messages: {
			bad: message,
			overBaseline: `${message} ${BURNDOWN_HINT} Fix the ones you added, or more.`,
			staleBaseline: `${BURNDOWN_HINT} Lower it: run \`bun run lint:ui-baseline\`.`,
		},
	},
	create(context) {
		const allowed = BASELINE[name]?.[relative(ROOT, context.filename)] ?? 0
		const found = []
		const visitors = collect(context, (node, data = {}) => found.push({ node, data }))
		return {
			...visitors,
			"Program:exit"(program) {
				if (found.length > allowed) {
					const messageId = allowed === 0 ? "bad" : "overBaseline"
					for (const { node, data } of found)
						context.report({ node, messageId, data: { ...data, allowed, count: found.length } })
				} else if (found.length < allowed) {
					context.report({
						node: program,
						messageId: "staleBaseline",
						data: { allowed, count: found.length },
					})
				}
			},
		}
	},
})

// ---------------------------------------------------------------------------------------------
// Build from the kit
// ---------------------------------------------------------------------------------------------

/** Raw element → the kit call that replaces it. */
const CONTROLS = {
	button: "`button` (ui/button) for an action, `link` (ui/link) for navigation, or `ariaButton` (ui/button) for a target that draws its own look",
	input: "`textField` / `input` (ui/text-field, ui/input), `searchField`, `checkbox`, `switchControl` or `radioGroup`",
	textarea: "`textarea` (ui/textarea)",
	select: "the `Select` component (ui/select)",
	label: "`label` (ui/field), or `textField`, which labels its own input",
	dialog: "the `Modal` component with `dialog` (ui/modal, ui/dialog)",
}

const HEADINGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"])

/** `h.button(...)`: the Foldkit builder is always `h`. */
const builderElement = (node) =>
	node.callee.type === "MemberExpression" &&
	!node.callee.computed &&
	node.callee.object.type === "Identifier" &&
	node.callee.object.name === "h" &&
	node.callee.property.type === "Identifier"
		? node.callee.property.name
		: undefined

const noRawControl = ratcheted("no-raw-control", {
	description: "Pages build controls from the kit, not raw elements.",
	message:
		"`h.{{element}}` rebuilds a kit control. Use {{replacement}}. If the kit lacks the variant you need, add it to the kit component and use it here.",
	collect: (_context, push) => ({
		CallExpression(node) {
			const element = builderElement(node)
			if (element !== undefined && Object.hasOwn(CONTROLS, element))
				push(node, { element, replacement: CONTROLS[element] })
		},
	}),
})

const noRawHeading = ratcheted("no-raw-heading", {
	description: "Headings come from the kit's heading components.",
	message:
		"`h.{{element}}` is a hand-styled heading. Use `heading` (ui/heading: display, title, section, subsection), `cardTitle`, `dialogTitle` or `sectionHeaderHeading`; a new heading style is a new `heading` variant.",
	collect: (_context, push) => ({
		CallExpression(node) {
			const element = builderElement(node)
			if (element !== undefined && HEADINGS.has(element)) push(node, { element })
		},
	}),
})

const noKitStylesInPages = ratcheted("no-kit-styles-in-pages", {
	description: "Pages call kit components instead of rebuilding them from their styles.",
	message:
		"`{{source}}` is a kit component's styling. Call its wrapper in src/ui instead; if the wrapper lacks an option you need, add it there.",
	collect: (_context, push) => ({
		ImportDeclaration(node) {
			const source = node.source.value
			if (typeof source === "string" && /(^~|\/core)\/components\/ui\/.+\.styles$/.test(source))
				push(node, { source })
		},
	}),
})

// ---------------------------------------------------------------------------------------------
// Values come from tokens
// ---------------------------------------------------------------------------------------------

const RAW_COLOR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb)\(/

const noRawColor = ratcheted("no-raw-color", {
	description: "Colours come from the colour tokens.",
	message:
		"`{{token}}` is a hand-picked colour. Use a colour token; a new colour (a vendor's brand colour too) gets a token in core/styles/styles.css.",
	collect: eachUtility(({ utility }) => {
		const bracket = utility.indexOf("-[")
		return bracket !== -1 && RAW_COLOR.test(utility.slice(bracket))
	}),
})

const PALETTE =
	"red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone"
const COLOR_PREFIX =
	"bg|text|border(?:-[xytblrse])?|ring-offset|inset-ring|ring|outline|divide|fill|stroke|from|via|to|decoration|caret|accent|placeholder|shadow"
const PALETTE_UTILITY = new RegExp(`^-?(?:${COLOR_PREFIX})-(?:${PALETTE})-\\d{2,3}(?:/\\d+)?$`)

const noPaletteColor = ratcheted("no-palette-color", {
	description: "Colours are semantic tokens, not palette steps.",
	message:
		"`{{token}}` is a raw palette step, which ignores the theme (dark mode, gray palette, brand). Use a semantic token: `fg`/`fg-2`/`muted-fg` for text, `primary`, `success`, `warning`, `danger`, `info` and their `-subtle`/`-subtle-fg` pairs; a new role gets a token in core/styles/styles.css.",
	collect: eachUtility(({ utility }) => PALETTE_UTILITY.test(utility)),
})

/** Colour names Tailwind generates utilities for: every `--color-*` in an `@theme` block, plus its palette. */
const themeColors = (() => {
	const names = new Set(["inherit", "current", "transparent", "black", "white"])
	for (const file of ["core/styles/styles.css", "core/styles/theme.css"]) {
		const css = readFileSync(resolve(ROOT, "apps/web-foldkit/src", file), "utf8")
		for (const block of css.matchAll(/@theme[^{]*\{([\s\S]*?)\n\}/g))
			for (const [, name] of block[1].matchAll(/--color-([a-z0-9-]+)\s*:/g)) names.add(name)
	}
	return names
})()

/** Per prefix, the non-colour utilities that share it (`text-sm`, `border-2`, `ring-inset`). */
const NOT_COLOR = {
	text: /^(xs|sm|base|lg|[2-9]?xl|2xs|3xs|left|center|right|justify|start|end|wrap|nowrap|balance|pretty|ellipsis|clip|shadow(-.+)?|anchor|rendering|transform|indent)$/,
	border: /^([xytblrse](-\d+)?|(left|right|top|bottom)-.+|radius|color|width|style|\d+|solid|dashed|dotted|double|hidden|none|collapse|separate|spacing.*)$/,
	ring: /^(\d+|inset|offset-\d+)$/,
	"ring-offset": /^\d+$/,
	"inset-ring": /^\d+$/,
	outline: /^(\d+|none|hidden|solid|dashed|dotted|double|offset-.+)$/,
	divide: /^(x|y|x-.+|y-.+|solid|dashed|dotted|double|none)$/,
	fill: /^(none|rule|opacity|mode-.+)$/,
	stroke: /^(\d+|none|width|linecap|linejoin|opacity|dasharray|dashoffset|miterlimit)$/,
	from: /^\d+%$/,
	via: /^\d+%$/,
	to: /^\d+%$/,
	decoration: /^(\d+|solid|double|dotted|dashed|wavy|auto|from-font|clone|slice)$/,
	accent: /^auto$/,
	shadow: /^(2xs|xs|sm|md|lg|xl|2xl|none|inner|control)$/,
	bg: /^(fixed|local|scroll|clip-.+|origin-.+|repeat.*|no-repeat|cover|contain|auto|none|center|top|bottom|left|right|left-.+|right-.+|linear-.+|gradient-.+|radial.*|conic.*|blend-.+)$/,
	caret: /^$/,
	placeholder: /^$/,
}
const COLOR_UTILITY = new RegExp(`^-?(${COLOR_PREFIX})-([a-z][a-z0-9-]*)(?:/\\d+)?$`)

const noUnknownColor = ratcheted("no-unknown-color", {
	description: "Colour classes name a colour the theme defines.",
	message:
		"`{{token}}` names a colour the theme does not define, so Tailwind generates nothing for it. Use an existing token (see the `@theme` block in core/styles/styles.css) or add the token there.",
	collect: eachUtility(({ utility }) => {
		const match = COLOR_UTILITY.exec(utility)
		if (match === null) return false
		const prefix = match[1].replace(/^border-[xytblrse]$/, "border")
		const name = match[2]
		if (NOT_COLOR[prefix]?.test(name)) return false
		if (themeColors.has(name)) return false
		const palette = new RegExp(`^(${PALETTE})-\\d{2,3}$`)
		return !palette.test(name)
	}),
})

const noArbitraryTextSize = ratcheted("no-arbitrary-text-size", {
	description: "Type sizes come from the type scale.",
	message:
		"`{{token}}` is a hand-picked type size. Use the type scale (`text-3xs` … `text-xl`); a new size gets a token in core/styles/styles.css.",
	collect: eachUtility(({ utility }) =>
		/^text-\[(?:length:)?\d*\.?\d+(?:px|rem|em)\](?:\/.+)?$/.test(utility),
	),
})

const noArbitraryRadius = ratcheted("no-arbitrary-radius", {
	description: "Corners come from the radius tokens.",
	message:
		"`{{token}}` is a hand-picked corner. Use a radius token (`rounded-xs` … `rounded-4xl`, which follow the user's radius preset); a new need gets a token.",
	collect: eachUtility(
		({ utility }) => /^rounded(-[a-z]{1,2})?-\[/.test(utility) && !/-\[inherit\]$/.test(utility),
	),
})

const noRawShadow = ratcheted("no-raw-shadow", {
	description: "Depth comes from the elevation tokens.",
	message:
		"`{{token}}` is a hand-built shadow. Use the elevation scale (`shadow-xs` … `shadow-xl`, `shadow-control`), which is tuned per theme; a new depth gets an `--elevation-*` token.",
	collect: eachUtility(({ utility }) => /^(inset-)?shadow-\[/.test(utility)),
})

const noTransitionAll = ratcheted("no-transition-all", {
	description: "Name the properties that move.",
	message:
		"`{{token}}` animates every property, layout included. Name what moves: `transition-colors`, `transition-[opacity,translate]`.",
	collect: eachUtility(({ utility }) => utility === "transition-all"),
})

export const RULES = {
	"no-arbitrary-radius": noArbitraryRadius,
	"no-arbitrary-text-size": noArbitraryTextSize,
	"no-kit-styles-in-pages": noKitStylesInPages,
	"no-palette-color": noPaletteColor,
	"no-raw-color": noRawColor,
	"no-raw-control": noRawControl,
	"no-raw-heading": noRawHeading,
	"no-raw-shadow": noRawShadow,
	"no-transition-all": noTransitionAll,
	"no-unknown-color": noUnknownColor,
}

export default {
	meta: { name: "hazel-ui" },
	rules: RULES,
}
