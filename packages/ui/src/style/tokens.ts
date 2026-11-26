import type { ColorExpr, ThemedColor, Tokens } from "./schema.ts"

/**
 * Hazel's tokens, seeded from `apps/web-foldkit/src/core/styles/styles.css` and `theme.css` (roles),
 * Tailwind 4.3's palette (the `zinc`, `red`, ... steps those roles name) and the kit's `*.styles.ts`
 * (the derived control colours). Each expression keeps the web's own form, so the CSS matches it.
 */

const lit = (literal: string): ColorExpr => ({ literal })
const ref = (name: string): ColorExpr => ({ ref: name })
const mix = (a: ColorExpr, percent: number, b: ColorExpr): ColorExpr => ({ mix: [a, percent, b] })
const alpha = (of: ColorExpr, value: number): ColorExpr => ({ alpha: [of, value] })
const same = (value: ColorExpr): ThemedColor => ({ light: value, dark: value })
const themed = (light: ColorExpr, dark: ColorExpr): ThemedColor => ({ light, dark })

/** Tailwind 4.3 (`tailwindcss/theme.css`) and `theme.css`'s brand scale: only the steps roles use. */
const palette = {
	white: "#fff",
	black: "#000",
	"zinc-50": "oklch(98.5% 0 none)",
	"zinc-100": "oklch(96.7% 0.001 286.375)",
	"zinc-200": "oklch(92% 0.004 286.32)",
	"zinc-300": "oklch(87.1% 0.006 286.286)",
	"zinc-400": "oklch(70.5% 0.015 286.067)",
	"zinc-600": "oklch(44.2% 0.017 285.786)",
	"zinc-800": "oklch(27.4% 0.006 286.033)",
	"zinc-900": "oklch(21% 0.006 285.885)",
	"zinc-950": "oklch(14.1% 0.005 285.823)",
	"red-50": "oklch(97.1% 0.013 17.38)",
	"red-400": "oklch(70.4% 0.191 22.216)",
	"red-500": "oklch(63.7% 0.237 25.331)",
	"red-600": "oklch(57.7% 0.245 27.325)",
	"red-700": "oklch(50.5% 0.213 27.518)",
	"amber-400": "oklch(82.8% 0.189 84.429)",
	"amber-700": "oklch(55.5% 0.163 48.998)",
	"amber-950": "oklch(27.9% 0.077 45.635)",
	"emerald-400": "oklch(76.5% 0.177 163.223)",
	"emerald-500": "oklch(69.6% 0.17 162.48)",
	"emerald-600": "oklch(59.6% 0.145 163.225)",
	"emerald-700": "oklch(50.8% 0.118 165.612)",
	"sky-300": "oklch(82.8% 0.111 230.318)",
	"sky-500": "oklch(68.5% 0.169 237.323)",
	"sky-700": "oklch(50% 0.134 242.749)",
	"brand-300": "rgb(214 187 251)",
	"brand-500": "rgb(158 119 237)",
	"brand-600": "rgb(127 86 217)",
	"brand-700": "rgb(105 65 198)",
} as const

const p = (name: keyof typeof palette): ColorExpr => ({ ref: `palette.${name}` })

const color = {
	// Surfaces and ink (styles.css `:root` / `.dark`).
	bg: themed(p("white"), lit("oklch(0.19 0.006 285.885)")),
	fg: themed(p("zinc-950"), p("zinc-50")),
	/** The text ladder, mixed from fg into bg (styles.css `--fg-1`..`--fg-4`). */
	"fg-4": same(ref("fg")),
	"fg-3": same(mix(ref("fg"), 72, ref("bg"))),
	"fg-2": same(mix(ref("fg"), 56, ref("bg"))),
	"fg-1": same(mix(ref("fg"), 28, ref("bg"))),
	wash: themed(lit("oklch(0 0 0 / 0.035)"), lit("oklch(1 0 0 / 0.045)")),
	"wash-strong": themed(lit("oklch(0 0 0 / 0.06)"), lit("oklch(1 0 0 / 0.08)")),
	/** `wash` under `wash-strong`: the active channel row under the pointer (two layers, one colour). */
	"wash-stacked": themed(lit("oklch(0 0 0 / 0.0929)"), lit("oklch(1 0 0 / 0.1214)")),
	/** A bar's bottom edge (the hybrid's measured band, `Theme.bandBorder`). */
	separator: themed(alpha(p("zinc-950"), 0.07), alpha(p("white"), 0.07)),
	border: themed(p("zinc-200"), lit("oklch(1 0 0 / 0.085)")),
	"border-hover": themed(p("zinc-300"), lit("oklch(1 0 0 / 0.14)")),
	ring: same(ref("primary")),
	muted: themed(p("zinc-100"), p("zinc-900")),
	"muted-fg": themed(p("zinc-600"), p("zinc-400")),

	primary: same(p("brand-600")),
	"primary-fg": same(lit("oklch(1 0 0)")),
	secondary: themed(p("zinc-100"), p("zinc-800")),
	"secondary-fg": themed(p("zinc-950"), p("zinc-50")),
	success: same(p("emerald-600")),
	"success-fg": same(p("white")),
	"success-subtle-fg": themed(p("emerald-700"), p("emerald-400")),
	// Tinted fills (styles.css `--*-subtle`): badges.
	"primary-subtle": same(alpha(p("brand-500"), 0.15)),
	"success-subtle": themed(alpha(p("emerald-500"), 0.15), alpha(p("emerald-500"), 0.1)),
	"info-subtle": themed(alpha(p("sky-500"), 0.15), alpha(p("sky-500"), 0.1)),
	"warning-subtle": themed(alpha(p("amber-400"), 0.2), alpha(p("amber-400"), 0.1)),
	"danger-subtle": themed(alpha(p("red-500"), 0.15), alpha(p("red-500"), 0.1)),
	"info-subtle-fg": themed(p("sky-700"), p("sky-300")),
	warning: same(p("amber-400")),
	"warning-fg": same(p("amber-950")),
	"warning-subtle-fg": themed(p("amber-700"), p("amber-400")),
	danger: same(p("red-600")),
	"danger-fg": same(p("red-50")),
	"danger-subtle-fg": themed(p("red-700"), p("red-400")),
	"accent-fg": themed(p("brand-700"), p("brand-300")),

	// The sidebar (styles.css `--sidebar-*`).
	sidebar: themed(lit("oklch(0.985 0 0)"), lit("oklch(0.18 0.006 285.885)")),
	"sidebar-fg": themed(lit("oklch(0.141 0.005 285.823)"), lit("oklch(0.985 0 0)")),
	"sidebar-primary": themed(alpha(p("brand-500"), 0.15), alpha(p("brand-500"), 0.2)),
	"sidebar-primary-fg": themed(p("brand-700"), p("brand-300")),
	/** A section's title: `text-sidebar-fg/70`. */
	"sidebar-title": same(alpha(ref("sidebar-fg"), 0.7)),

	// Control colours derived in button.styles.ts (`--btn-icon`, `--btn-overlay`).
	"primary-icon": same(alpha(ref("primary-fg"), 0.6)),
	"primary-hover": same(mix(ref("primary-fg"), 10, ref("primary"))),
	"secondary-hover": same(mix(ref("secondary-fg"), 10, ref("secondary"))),
	"warning-icon": same(alpha(ref("warning-fg"), 0.6)),
	"warning-hover": same(mix(p("white"), 10, ref("warning"))),
	"danger-icon": same(mix(ref("danger-fg"), 60, ref("danger"))),
	"danger-hover": same(mix(p("white"), 10, ref("danger"))),
	// The icon under the pointer: `text-(--btn-icon-active)/90`, active being the variant's ink.
	"primary-icon-hover": same(alpha(alpha(ref("primary-fg"), 0.8), 0.9)),
	"secondary-icon-hover": same(alpha(ref("secondary-fg"), 0.9)),
	"warning-icon-hover": same(alpha(ref("warning-fg"), 0.9)),
	"danger-icon-hover": same(alpha(ref("danger-fg"), 0.9)),
} satisfies Record<string, ThemedColor>

export const tokens = {
	palette,
	color,
	font: {
		sans: '"Inter", ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"',
		mono: 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
		sansFeatures: '"cv02", "cv03", "cv04", "cv11"',
		weight: { regular: 400, strong: 500 },
	},
	/** Tailwind's steps as the kit uses them per size class (`text-base/6 sm:text-sm/5` is `body`). */
	text: {
		body: { compact: { size: 16, lineHeight: 24 }, regular: { size: 14, lineHeight: 20 } },
		label: { compact: { size: 14, lineHeight: 20 }, regular: { size: 14, lineHeight: 20 } },
		caption: { compact: { size: 12, lineHeight: 16 }, regular: { size: 12, lineHeight: 16 } },
		title: { compact: { size: 18, lineHeight: 28 }, regular: { size: 16, lineHeight: 24 } },
		display: { compact: { size: 24, lineHeight: 32 }, regular: { size: 20, lineHeight: 28 } },
		code: { compact: { size: 14, lineHeight: 20 }, regular: { size: 13, lineHeight: 20 } },
		// Recipe-only steps (styles.css `--text-2xs`, `--text-3xs`): counts and small badges.
		tiny: { compact: { size: 11, lineHeight: 16 }, regular: { size: 11, lineHeight: 16 } },
		micro: { compact: { size: 10, lineHeight: 16 }, regular: { size: 10, lineHeight: 16 } },
	},
	/** Tailwind's 4px grid by step name (`3` is `--spacing(3)`, 12px). */
	space: {
		"0": 0,
		px: 1,
		"0.5": 2,
		"1": 4,
		"1.5": 6,
		"2": 8,
		"2.5": 10,
		"3": 12,
		"3.5": 14,
		"4": 16,
		"4.5": 18,
		"5": 20,
		"6": 24,
		"7": 28,
		"8": 32,
		"9": 36,
		"10": 40,
		"11": 44,
		"12": 48,
		"14": 56,
	},
	/** styles.css `--radius-*` (lg is 0.5rem). */
	radius: { xs: 2, sm: 4, md: 6, lg: 8, xl: 12, full: 9999 },
	/** styles.css `--duration-*`. */
	duration: { micro: 100, fast: 150, normal: 200, slow: 300 },
	easing: {
		out: [0.23, 1, 0.32, 1],
		inOut: [0.77, 0, 0.175, 1],
	},
	shadow: {
		control: {
			light: "inset 0 1px 0 oklch(1 0 0 / 0.16), inset 0 -1px 0 oklch(0 0 0 / 0.12), 0 1px 2px oklch(0 0 0 / 0.08)",
			dark: "inset 0 1px 0 oklch(1 0 0 / 0.14), inset 0 -1px 0 oklch(0 0 0 / 0.2), 0 1px 2px oklch(0 0 0 / 0.3)",
		},
		xs: { light: "0 1px 2px 0 oklch(0 0 0 / 0.04)", dark: "0 1px 2px 0 oklch(0 0 0 / 0.3)" },
	},
} as const satisfies Tokens

export interface HazelTokenNames {
	readonly color: keyof typeof tokens.color & string
	readonly radius: keyof typeof tokens.radius & string
	readonly space: keyof typeof tokens.space & string
	readonly shadow: keyof typeof tokens.shadow & string
	readonly duration: keyof typeof tokens.duration & string
}
