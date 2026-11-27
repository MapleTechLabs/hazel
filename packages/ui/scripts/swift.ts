import type {
	ColorExpr,
	Declarations,
	Layer,
	Keyframe,
	Length,
	MotionTrigger,
	MotionUse,
	TokenNames,
	Offset,
	Recipe,
	Tokens,
	TypeMetrics,
} from "../src/style/schema.ts"
import {
	badgeSizes,
	badgeStyles,
	badgeTones,
	buttonSizes,
	buttonVariants,
	dataStates,
	interactionStates,
	motionTriggers,
	recipeTextSteps,
	textRoles,
	textTones,
} from "../src/style/schema.ts"
import { mixOklab, parseColor, type Rgba, toHex, transparent } from "./color.ts"
import { MONO_ROLE } from "./css.ts"

/** Writes `Theme.swift`: the same tokens with colours resolved to sRGB, and the recipes as layers. */

type Theme = "light" | "dark"

const resolver = (tokens: Tokens) => {
	const resolve = (expr: ColorExpr, theme: Theme): Rgba => {
		if ("literal" in expr) return parseColor(expr.literal)
		if ("ref" in expr) {
			if (expr.ref.startsWith("palette.")) {
				const value = tokens.palette[expr.ref.slice(8)]
				if (value === undefined) throw new Error(`Unknown palette step ${expr.ref}`)
				return parseColor(value)
			}
			const role = tokens.color[expr.ref]
			if (role === undefined) throw new Error(`Unknown colour role ${expr.ref}`)
			return resolve(role[theme], theme)
		}
		if ("mix" in expr)
			return mixOklab(resolve(expr.mix[0], theme), expr.mix[1], resolve(expr.mix[2], theme))
		return mixOklab(resolve(expr.alpha[0], theme), expr.alpha[1] * 100, transparent)
	}
	return resolve
}

const num = (value: number) => {
	const rounded = Math.round(value * 1e6) / 1e6
	return Number.isInteger(rounded) ? `${rounded}` : `${rounded}`
}
const rgba = (c: Rgba) => `RGBA(${num(c.r)}, ${num(c.g)}, ${num(c.b)}, ${num(c.a)})`
const str = (value: string) => JSON.stringify(value)
const swiftKeywords = new Set(["default", "case", "class", "func", "init", "let", "var", "in", "is"])
const ident = (name: string) => {
	const camel = name.replace(/[-.](\w)/g, (_, c: string) => c.toUpperCase()).replace(/^(\d)/, "s$1")
	return swiftKeywords.has(camel) ? `\`${camel}\`` : camel
}

/** CSS shadow lists (`inset 0 1px 0 oklch(...)`, comma separated) as layers. */
const shadowLayers = (css: string) =>
	css.split(/,(?![^(]*\))/).map((layer) => {
		const parts = layer.trim().split(/\s+(?![^(]*\))/)
		const inset = parts[0] === "inset"
		const rest = inset ? parts.slice(1) : parts
		const lengths = rest.filter((part) => /^-?\d/.test(part)).map((part) => Number.parseFloat(part))
		const color = rest.filter((part) => !/^-?\d/.test(part)).join(" ")
		const [x = 0, y = 0, blur = 0, spread = 0] = lengths
		return `Shadow(inset: ${inset}, x: ${num(x)}, y: ${num(y)}, blur: ${num(blur)}, spread: ${num(spread)}, color: ${rgba(parseColor(color))})`
	})

const enumOf = (name: string, values: ReadonlyArray<string>) =>
	`    public enum ${name}: String, CaseIterable, Sendable {\n${values.map((v) => `        case ${ident(v)} = ${str(v)}`).join("\n")}\n    }`

export const generateSwift = (tokens: Tokens, recipes: ReadonlyArray<Recipe>): string => {
	const resolve = resolver(tokens)
	const space = (step: string) => {
		const px = tokens.space[step]
		if (px === undefined) throw new Error(`Unknown space step ${step}`)
		return px
	}
	const length = (value: Length<string>) =>
		typeof value === "string" ? space(value) : space(value.step) - 1
	const colorField = (name: string) => (name === "transparent" ? "Colors.clear" : `Colors.${ident(name)}`)

	const style = (d: Declarations): string => {
		const fields: string[] = []
		const add = (field: string, value: string) => fields.push(`${field}: ${value}`)
		if (d.layout !== undefined) add("layout", `.${ident(d.layout)}`)
		if (d.align !== undefined) add("align", `.${d.align}`)
		if (d.justify !== undefined) add("justify", `.${d.justify}`)
		if (d.background !== undefined) add("background", colorField(d.background))
		if (d.color !== undefined) add("color", colorField(d.color))
		if (d.borderColor !== undefined) add("borderColor", colorField(d.borderColor))
		if (d.borderWidth !== undefined) add("borderWidth", d.borderWidth === "hairline" ? "1" : d.borderWidth === "thick" ? "2" : "0")
		if (d.radius !== undefined) add("radius", num(tokens.radius[d.radius] ?? 0))
		if (d.ring !== undefined) add("ring", colorField(d.ring))
		if (d.divider !== undefined) add("divider", colorField(d.divider))
		if (d.paddingX !== undefined) add("paddingX", num(length(d.paddingX)))
		if (d.paddingY !== undefined) add("paddingY", num(length(d.paddingY)))
		if (d.paddingStart !== undefined) add("paddingStart", num(length(d.paddingStart)))
		if (d.paddingTop !== undefined) add("paddingTop", num(length(d.paddingTop)))
		if (d.paddingBottom !== undefined) add("paddingBottom", num(length(d.paddingBottom)))
		if (d.gap !== undefined) add("gap", num(space(d.gap)))
		if (d.rowGap !== undefined) add("rowGap", num(space(d.rowGap)))
		if (d.marginBottom !== undefined) add("marginBottom", num(space(d.marginBottom)))
		if (d.marginX !== undefined) add("marginX", num(space(d.marginX)))
		if (d.bleedX !== undefined) add("bleedX", num(space(d.bleedX)))
		if (d.minHeight !== undefined) add("minHeight", num(space(d.minHeight)))
		if (d.size !== undefined) add("size", num(space(d.size)))
		if (d.text !== undefined) add("text", `.${d.text}`)
		if (d.leading !== undefined) add("leading", num(space(d.leading)))
		// `stroke` is web-only: SwiftUI text has no stroke, the weight carries it.
		if (d.strong !== undefined) add("strong", String(d.strong))
		if (d.numeric !== undefined) add("numeric", String(d.numeric))
		if (d.opacity !== undefined) add("opacity", num(d.opacity))
		if (d.shadow !== undefined) add("shadow", str(d.shadow))
		if (d.truncate !== undefined) add("truncate", String(d.truncate))
		if (d.nowrap !== undefined) add("nowrap", String(d.nowrap))
		if (d.wrap !== undefined) add("wrap", String(d.wrap))
		if (d.fill !== undefined) add("fill", String(d.fill))
		if (d.grow !== undefined) add("grow", String(d.grow))
		if (d.shrink !== undefined) add("shrink", String(d.shrink))
		if (d.transition !== undefined) add("transition", num((tokens.duration[d.transition] ?? 0) / 1000))
		if (d.weight !== undefined) add("weight", String(tokens.font.weight[d.weight]))
		if (d.uppercase !== undefined) add("uppercase", String(d.uppercase))
		if (d.textAlign !== undefined) add("textAlign", `.${d.textAlign}`)
		if (d.lineClamp !== undefined) add("lineClamp", String(d.lineClamp))
		if (d.overflow !== undefined) add("overflow", `.${d.overflow}`)
		if (d.minWidth !== undefined) add("minWidth", num(space(d.minWidth)))
		if (d.transitionEase !== undefined) add("transitionEase", str(d.transitionEase))
		if (d.width !== undefined) add("width", num(space(d.width)))
		if (d.hidden !== undefined) add("hidden", String(d.hidden))
		if (d.borderStyle !== undefined) add("borderStyle", `.${d.borderStyle}`)
		if (d.tracking !== undefined) add("tracking", `.${d.tracking}`)
		return `Style(${fields.join(", ")})`
	}

	const layers = (recipe: Recipe): string[] => {
		const out: string[] = []
		const emit = (
			when: {
				options?: Record<string, string>
				flags?: ReadonlyArray<string>
				states?: ReadonlyArray<string>
			},
			layer: Layer<string, never>,
		) => {
			const condition = (sizeClass: string | null, states: ReadonlyArray<string>) =>
				`When(options: [${
					Object.entries(when.options ?? {})
						.map(([k, v]) => `${str(k)}: ${str(v)}`)
						.join(", ") || ":"
				}], flags: [${(when.flags ?? []).map(str).join(", ")}], states: [${states
					.map((s) => `.${ident(s)}`)
					.join(", ")}], sizeClass: ${sizeClass === null ? "nil" : `.${sizeClass}`})`
			const parts = (
				styles: Layer<string, never>,
				sizeClass: string | null,
				states: ReadonlyArray<string>,
			) => {
				if (styles.root !== undefined)
					out.push(
						`Layer(when: ${condition(sizeClass, states)}, part: nil, style: ${style(styles.root)})`,
					)
				for (const [part, decls] of Object.entries(styles.parts ?? {}))
					if (decls !== undefined)
						out.push(
							`Layer(when: ${condition(sizeClass, states)}, part: ${str(part)}, style: ${style(decls)})`,
						)
			}
			const base = when.states ?? []
			parts(layer, null, base)
			if (layer.regular !== undefined) parts(layer.regular, "regular", base)
			// A part's own states: the part, then the parts inside it, keyed by the part's state.
			for (const [owner, ownStates] of Object.entries(layer.partStates ?? {}))
				for (const [state, styles] of Object.entries(ownStates ?? {})) {
					if (styles === undefined) continue
					const tag = `partState: PartState(part: ${str(owner)}, state: .${ident(state)})`
					if (styles.root !== undefined)
						out.push(
							`Layer(when: ${condition(null, base)}, part: ${str(owner)}, style: ${style(styles.root)}, ${tag})`,
						)
					for (const [inner, decls] of Object.entries(styles.parts ?? {}))
						if (decls !== undefined)
							out.push(
								`Layer(when: ${condition(null, base)}, part: ${str(inner)}, style: ${style(decls)}, ${tag})`,
							)
				}
			for (const [state, styles] of Object.entries(layer.states ?? {})) {
				if (styles === undefined) continue
				parts(styles, null, [...base, state])
				if (styles.regular !== undefined) parts(styles.regular, "regular", [...base, state])
			}
		}
		emit({}, recipe.base as Layer<string, never>)
		for (const [option, spec] of Object.entries(recipe.options))
			for (const [value, layer] of Object.entries(spec.values))
				emit({ options: { [option]: value } }, layer as Layer<string, never>)
		for (const [flag, layer] of Object.entries(recipe.flags ?? {}))
			emit({ flags: [flag] }, layer as Layer<string, never>)
		for (const compound of recipe.compounds ?? []) {
			const options: Record<string, string> = {}
			const flags: string[] = []
			for (const [key, value] of Object.entries(compound.when))
				if (value === true) flags.push(key)
				else if (typeof value === "string") options[key] = value
			emit({ options, flags }, compound.style as Layer<string, never>)
		}
		// Data states before interaction states, as the CSS orders them.
		const states = Object.entries(recipe.states ?? {})
		const isInteraction = (state: string) => (interactionStates as ReadonlyArray<string>).includes(state)
		for (const [state, layer] of [
			...states.filter(([s]) => !isInteraction(s)),
			...states.filter(([s]) => isInteraction(s)),
		])
			if (layer !== undefined) emit({ states: [state] }, layer as Layer<string, never>)
		return out
	}

	const colorLines = Object.entries(tokens.color).map(([name, value]) => {
		const light = resolve(value.light, "light")
		const dark = resolve(value.dark, "dark")
		return `        /// \`${name}\`: ${toHex(light)} / ${toHex(dark)}\n        public static let ${ident(name)} = ThemedColor(light: ${rgba(light)}, dark: ${rgba(dark)})`
	})

	const recipeLines = recipes.map((recipe) => {
		const defaults = Object.entries(recipe.options)
			.map(([k, spec]) => `${str(k)}: ${str(spec.default)}`)
			.join(", ")
		return `        public static let ${ident(recipe.primitive)} = Recipe(\n            primitive: ${str(recipe.primitive)},\n            defaults: [${defaults || ":"}],\n            inert: [${(recipe.inert ?? []).map((s) => `.${ident(s)}`).join(", ")}],\n            layers: [\n${layers(
			recipe,
		)
			.map((line) => `                ${line},`)
			.join("\n")}\n            ]\n        )`
	})

	const metrics = (m: TypeMetrics) =>
		`TypeMetrics(size: ${m.size}, lineHeight: ${m.lineHeight}, tracking: ${num(m.tracking ?? 0)})`
	const textLines = Object.entries(tokens.text).map(
		([role, m]) =>
			`        case .${role}: sizeClass == .compact ? ${metrics(m.compact)} : ${metrics(m.regular)}`,
	)

	return `// Generated by packages/ui/scripts/generate.ts from packages/ui/src/style. Do not edit.
// Colours are extended sRGB: a wide-gamut token (oklch outside sRGB) keeps components outside 0...1.

import SwiftUI
import UIKit

public enum HazelTheme {
${enumOf("TextRole", textRoles)}

${enumOf("TextTone", textTones)}

${enumOf("ButtonVariant", buttonVariants)}

${enumOf("TextStep", [...textRoles, ...recipeTextSteps])}

${enumOf("ButtonSize", buttonSizes)}

${enumOf("BadgeTone", badgeTones)}

${enumOf("BadgeStyle", badgeStyles)}

${enumOf("BadgeSize", badgeSizes)}

${enumOf("State", [...dataStates, ...interactionStates])}

    public enum SizeClass: Sendable { case compact, regular }

    public struct RGBA: Sendable, Equatable {
        public let r: Double, g: Double, b: Double, a: Double
        public init(_ r: Double, _ g: Double, _ b: Double, _ a: Double) {
            self.r = r; self.g = g; self.b = b; self.a = a
        }
        public var uiColor: UIColor { UIColor(red: r, green: g, blue: b, alpha: a) }
    }

    public struct ThemedColor: Sendable, Equatable {
        public let light: RGBA, dark: RGBA
        public var color: Color {
            let light = light.uiColor, dark = dark.uiColor
            return Color(uiColor: UIColor { $0.userInterfaceStyle == .dark ? dark : light })
        }
    }

    /// Points; \`tracking\` is the kern between glyphs (SwiftUI \`.tracking\`).
    public struct TypeMetrics: Sendable, Equatable {
        public let size: CGFloat, lineHeight: CGFloat, tracking: CGFloat
    }

    public struct Shadow: Sendable, Equatable {
        public let inset: Bool, x: CGFloat, y: CGFloat, blur: CGFloat, spread: CGFloat, color: RGBA
    }

    public enum Colors {
        public static let clear = ThemedColor(light: RGBA(0, 0, 0, 0), dark: RGBA(0, 0, 0, 0))
${colorLines.join("\n")}
    }

    public enum Font {
        public static let sans = ${str(tokens.font.sans)}
        public static let mono = ${str(tokens.font.mono)}
        /// The text step drawn in the monospaced system font.
        public static let monoStep: TextStep = .${MONO_ROLE}
        public static let weightRegular = ${tokens.font.weight.regular}
        public static let weightStrong = ${tokens.font.weight.strong}
        public static let weightSemibold = ${tokens.font.weight.semibold}
        public static let weightBold = ${tokens.font.weight.bold}
    }

    public static func text(_ role: TextRole, _ sizeClass: SizeClass) -> TypeMetrics {
        text(TextStep(rawValue: role.rawValue)!, sizeClass)
    }

    public static func text(_ step: TextStep, _ sizeClass: SizeClass) -> TypeMetrics {
        switch step {
${textLines.join("\n")}
        }
    }

    public static let space: [String: CGFloat] = [${Object.entries(tokens.space)
		.map(([k, v]) => `${str(k)}: ${v}`)
		.join(", ")}]
    public static let radius: [String: CGFloat] = [${Object.entries(tokens.radius)
		.map(([k, v]) => `${str(k)}: ${v}`)
		.join(", ")}]
    /// Seconds.
    public static let duration: [String: Double] = [${Object.entries(tokens.duration)
		.map(([k, v]) => `${str(k)}: ${num(v / 1000)}`)
		.join(", ")}]
    public static let easing: [String: (Double, Double, Double, Double)] = [${Object.entries(tokens.easing)
		.map(([k, v]) => `${str(k)}: (${v.join(", ")})`)
		.join(", ")}]
    public static let shadows: [String: (light: [Shadow], dark: [Shadow])] = [
${Object.entries(tokens.shadow)
	.map(
		([name, s]) =>
			`        ${str(name)}: (light: [${shadowLayers(s.light).join(", ")}], dark: [${shadowLayers(s.dark).join(", ")}]),`,
	)
	.join("\n")}
    ]

    public enum Layout: Sendable { case row, column, inlineRow, contents }
    public enum Align: Sendable { case center, start, end }
    public enum TextAlign: Sendable { case center }
    public enum Overflow: Sendable { case scrollX, scrollY }
    public enum BorderStyle: Sendable { case solid, dashed }
    public enum Tracking: Sendable { case wider }

    /// A recipe's declarations, resolved to values; \`nil\` leaves the field to earlier layers.
    public struct Style: Sendable {
        public var layout: Layout? = nil, align: Align? = nil, justify: Align? = nil
        public var background: ThemedColor? = nil, color: ThemedColor? = nil, borderColor: ThemedColor? = nil
        public var borderWidth: CGFloat? = nil, radius: CGFloat? = nil
        public var ring: ThemedColor? = nil, divider: ThemedColor? = nil
        public var paddingX: CGFloat? = nil, paddingY: CGFloat? = nil, paddingStart: CGFloat? = nil
        /// One edge over \`paddingY\` (a list header's \`pt-3\`).
        public var paddingTop: CGFloat? = nil, paddingBottom: CGFloat? = nil
        // In the order codegen writes the fields: the memberwise initializer takes them so.
        public var gap: CGFloat? = nil, rowGap: CGFloat? = nil, marginBottom: CGFloat? = nil
        public var marginX: CGFloat? = nil, bleedX: CGFloat? = nil
        public var minHeight: CGFloat? = nil, size: CGFloat? = nil
        public var text: TextStep? = nil, leading: CGFloat? = nil, strong: Bool? = nil
        public var numeric: Bool? = nil, opacity: Double? = nil, shadow: String? = nil
        public var truncate: Bool? = nil, nowrap: Bool? = nil, wrap: Bool? = nil, fill: Bool? = nil
        public var grow: Bool? = nil, shrink: Bool? = nil
        public var transition: Double? = nil
        /// A font weight above \`strong\` (600 or 700); wins over \`strong\`.
        public var weight: Int? = nil, uppercase: Bool? = nil, textAlign: TextAlign? = nil
        public var lineClamp: Int? = nil, overflow: Overflow? = nil
        /// \`minWidth\` in points; \`transitionEase\` names a curve in \`easing\` (\`out\` when nil).
        public var minWidth: CGFloat? = nil, transitionEase: String? = nil
        /// A fixed width in points; \`hidden\` not drawn; a dashed border; \`wider\` tracking (0.05em).
        public var width: CGFloat? = nil, hidden: Bool? = nil
        public var borderStyle: BorderStyle? = nil, tracking: Tracking? = nil

        /// \`other\`'s fields over these.
        public func merged(_ other: Style) -> Style {
            var out = self
            out.layout = other.layout ?? layout; out.align = other.align ?? align; out.justify = other.justify ?? justify
            out.background = other.background ?? background; out.color = other.color ?? color
            out.borderColor = other.borderColor ?? borderColor; out.borderWidth = other.borderWidth ?? borderWidth
            out.radius = other.radius ?? radius; out.paddingX = other.paddingX ?? paddingX
            out.ring = other.ring ?? ring; out.divider = other.divider ?? divider; out.marginX = other.marginX ?? marginX
            out.wrap = other.wrap ?? wrap; out.fill = other.fill ?? fill; out.numeric = other.numeric ?? numeric
            out.paddingY = other.paddingY ?? paddingY; out.paddingStart = other.paddingStart ?? paddingStart
            out.paddingTop = other.paddingTop ?? paddingTop; out.paddingBottom = other.paddingBottom ?? paddingBottom
            out.gap = other.gap ?? gap; out.rowGap = other.rowGap ?? rowGap
            out.marginBottom = other.marginBottom ?? marginBottom; out.bleedX = other.bleedX ?? bleedX
            out.minHeight = other.minHeight ?? minHeight; out.size = other.size ?? size
            out.text = other.text ?? text; out.leading = other.leading ?? leading; out.strong = other.strong ?? strong
            out.opacity = other.opacity ?? opacity; out.shadow = other.shadow ?? shadow
            out.truncate = other.truncate ?? truncate; out.nowrap = other.nowrap ?? nowrap
            out.grow = other.grow ?? grow; out.shrink = other.shrink ?? shrink; out.transition = other.transition ?? transition
            out.weight = other.weight ?? weight; out.uppercase = other.uppercase ?? uppercase
            out.textAlign = other.textAlign ?? textAlign; out.lineClamp = other.lineClamp ?? lineClamp
            out.overflow = other.overflow ?? overflow
            out.minWidth = other.minWidth ?? minWidth; out.transitionEase = other.transitionEase ?? transitionEase
            out.width = other.width ?? width; out.hidden = other.hidden ?? hidden
            out.borderStyle = other.borderStyle ?? borderStyle; out.tracking = other.tracking ?? tracking
            return out
        }
    }

    public struct When: Sendable {
        public let options: [String: String], flags: Set<String>, states: Set<State>, sizeClass: SizeClass?
    }

    /// A layer that holds only while one part is in a state of its own (an option selected).
    public struct PartState: Sendable {
        public let part: String, state: State
    }

    public struct Layer: Sendable {
        public let when: When, part: String?, style: Style
        public var partState: PartState? = nil
    }

    /// Layers in CSS order: base, options, flags, compounds, states; later matches win field by field.
    public struct Recipe: Sendable {
        public let primitive: String, defaults: [String: String], inert: Set<State>, layers: [Layer]

        /// The style of the root (\`part: nil\`) or of one part, for these options, flags and states.
        /// \`partStates\` are each part's own states (the option that is selected); a part's hover and
        /// press hold only while it is neither selected nor disabled.
        public func style(
            part: String? = nil, options: [String: String] = [:], flags: Set<String> = [],
            states: Set<State> = [], partStates: [String: Set<State>] = [:], sizeClass: SizeClass
        ) -> Style {
            let chosen = defaults.merging(options) { _, new in new }
            let interactions: Set<State> = [.hover, .pressed, .focusVisible]
            let active = inert.isDisjoint(with: states) ? states : states.subtracting(interactions)
            let holds = { (owner: PartState) -> Bool in
                let own = partStates[owner.part] ?? []
                let still = own.isDisjoint(with: [.selected, .disabled]) ? own : own.subtracting(interactions)
                return still.contains(owner.state)
            }
            return layers.reduce(Style()) { style, layer in
                let when = layer.when
                guard layer.part == part,
                      layer.partState.map(holds) ?? true,
                      when.options.allSatisfy({ chosen[$0.key] == $0.value }),
                      when.flags.isSubset(of: flags),
                      when.states.isSubset(of: active),
                      when.sizeClass == nil || when.sizeClass == sizeClass
                else { return style }
                return style.merged(layer.style)
            }
        }
    }

    public enum Recipes {
${recipeLines.join("\n\n")}
    }

${motionBlock(tokens, recipes)}
}
`
}

// Motion (MOTION.md): the named motions and each primitive's uses, for the iOS lanes.

const swiftOffset = (value: Offset | undefined) =>
	value === undefined
		? ".points(0)"
		: typeof value === "number"
			? `.points(${num(value)})`
			: `.fraction(${num(Number.parseFloat(value) / 100)})`

const curveOf = (tokens: Tokens, name: string) => {
	const curve = tokens.easing[name]
	if (curve === undefined) throw new Error(`Unknown easing ${name}`)
	return `Curve(${curve.join(", ")})`
}

/** Keyframes with explicit rest poses at 0 and 1, as SwiftUI's keyframe tracks need them. */
const fullFrames = (frames: ReadonlyArray<Keyframe>): ReadonlyArray<Keyframe> => [
	...(frames.some((f) => f.at === 0) ? [] : [{ at: 0, pose: {} }]),
	...frames,
	...(frames.some((f) => f.at === 1) ? [] : [{ at: 1, pose: {} }]),
]

const motionBlock = (tokens: Tokens, recipes: ReadonlyArray<Recipe>) => {
	const spec = (name: string) => {
		const m = tokens.motion[name]
		if (m === undefined) throw new Error(`Unknown motion ${name}`)
		const frames = tokens.keyframes[m.keyframes]
		if (frames === undefined) throw new Error(`Unknown keyframes ${m.keyframes}`)
		const keyframes = fullFrames(frames).map(
			(f) =>
				`Keyframe(at: ${num(f.at)}, pose: Pose(opacity: ${num(f.pose.opacity ?? 1)}, x: ${swiftOffset(f.pose.x)}, y: ${swiftOffset(f.pose.y)}, scale: ${num(f.pose.scale ?? 1)}), curve: ${f.easing === undefined ? "nil" : curveOf(tokens, f.easing)})`,
		)
		return `Spec(name: ${str(name)}, keyframes: [${keyframes.join(", ")}], duration: ${num((tokens.duration[m.duration] ?? 0) / 1000)}, curve: ${curveOf(tokens, m.easing)}, delay: ${num(m.delay === undefined ? 0 : (tokens.duration[m.delay] ?? 0) / 1000)}, repeats: ${m.repeat === "forever"})`
	}
	const specLines = Object.keys(tokens.motion).map(
		(name) => `        public static let ${ident(name)} = ${spec(name)}`,
	)
	const useLines = recipes.flatMap((recipe) => {
		const entries = Object.entries(recipe.motion ?? {}) as ReadonlyArray<
			[MotionTrigger, ReadonlyArray<MotionUse<string, TokenNames>> | undefined]
		>
		const uses = entries.flatMap(([trigger, list]) =>
			(list ?? []).map(
				(use) =>
					`Use(trigger: .${trigger}, motion: ${ident(use.motion)}, part: ${use.part === undefined ? "nil" : str(use.part)}, backdrop: ${use.backdrop === true}, regular: ${use.regular === undefined ? "nil" : ident(use.regular)})`,
			),
		)
		return uses.length === 0 ? [] : [`            ${str(recipe.primitive)}: [${uses.join(", ")}],`]
	})
	return `    /// Motion (\`packages/ui/MOTION.md\`): the closed set of named motions, from today's styles.css, and
    /// which primitive plays which. Reduce Motion (\`reduceMotion\`): jump to the end pose, loops do not run.
    public enum Motion {
        public static let reduceMotion = ${str(tokens.reducedMotion)}

        /// A translation in points, or a fraction of the view's own size.
        public enum Offset: Sendable, Equatable { case points(CGFloat), fraction(CGFloat) }

        public struct Curve: Sendable, Equatable {
            public let x1: Double, y1: Double, x2: Double, y2: Double
            public init(_ x1: Double, _ y1: Double, _ x2: Double, _ y2: Double) {
                self.x1 = x1; self.y1 = y1; self.x2 = x2; self.y2 = y2
            }
        }

        public struct Pose: Sendable, Equatable {
            public let opacity: Double, x: Offset, y: Offset, scale: Double
        }

        /// \`curve\`: to the next keyframe, when it is not the motion's own.
        public struct Keyframe: Sendable, Equatable {
            public let at: Double, pose: Pose, curve: Curve?
        }

        /// Seconds; \`repeats\` loops until the view leaves.
        public struct Spec: Sendable, Equatable {
            public let name: String, keyframes: [Keyframe], duration: Double, curve: Curve, delay: Double
            public let repeats: Bool
        }

${enumOf("Trigger", motionTriggers).replace(/^    /gm, "        ")}

        /// \`part\` nil is the root; \`backdrop\` is a modal's scrim; \`regular\` replaces \`motion\` there.
        public struct Use: Sendable, Equatable {
            public let trigger: Trigger, motion: Spec, part: String?, backdrop: Bool, regular: Spec?
        }

${specLines.join("\n")}

        /// Each primitive's uses, by tag.
        public static let uses: [String: [Use]] = ${useLines.length === 0 ? "[:]" : `[\n${useLines.join("\n")}\n        ]`}
    }`
}
