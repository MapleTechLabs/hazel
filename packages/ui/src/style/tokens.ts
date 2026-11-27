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
	"amber-200": "oklch(92.4% 0.12 95.746)",
	"amber-300": "oklch(87.9% 0.169 91.605)",
	"amber-400": "oklch(82.8% 0.189 84.429)",
	"amber-600": "oklch(66.6% 0.179 58.318)",
	"amber-700": "oklch(55.5% 0.163 48.998)",
	"amber-900": "oklch(41.4% 0.112 45.904)",
	"amber-950": "oklch(27.9% 0.077 45.635)",
	"emerald-400": "oklch(76.5% 0.177 163.223)",
	"emerald-500": "oklch(69.6% 0.17 162.48)",
	"emerald-600": "oklch(59.6% 0.145 163.225)",
	"emerald-700": "oklch(50.8% 0.118 165.612)",
	"sky-300": "oklch(82.8% 0.111 230.318)",
	"sky-500": "oklch(68.5% 0.169 237.323)",
	"sky-700": "oklch(50% 0.134 242.749)",
	"brand-100": "rgb(244 235 255)",
	"brand-200": "rgb(233 215 254)",
	"brand-300": "rgb(214 187 251)",
	"brand-400": "rgb(182 146 246)",
	"brand-500": "rgb(158 119 237)",
	"brand-600": "rgb(127 86 217)",
	"brand-700": "rgb(105 65 198)",
	"brand-900": "rgb(66 48 125)",
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
	/** An outlined control's edge (`--input`). */
	input: themed(p("zinc-300"), lit("oklch(1 0 0 / 0.1)")),
	/** A filled field's surface (fields have a fill, not a border). */
	field: themed(lit("oklch(0 0 0 / 0.04)"), lit("oklch(1 0 0 / 0.05)")),
	"field-hover": themed(lit("oklch(0 0 0 / 0.065)"), lit("oklch(1 0 0 / 0.08)")),
	ring: same(ref("primary")),
	/** Keyboard focus (`ring-ring/70`), the field's focused edge, and its halo (`ring-ring/20`). */
	"focus-ring": same(alpha(ref("ring"), 0.7)),
	"focus-ring-hover": same(alpha(ref("ring"), 0.8)),
	"focus-halo": same(alpha(ref("ring"), 0.2)),
	/** An invalid field (`data-invalid:border-danger-subtle-fg/70`, its focus halo at 20%). */
	"invalid-border": same(alpha(ref("danger-subtle-fg"), 0.7)),
	"invalid-border-hover": same(alpha(ref("danger-subtle-fg"), 0.8)),
	"invalid-halo": same(alpha(ref("danger-subtle-fg"), 0.2)),

	// Raised surfaces: menus, popovers, dialogs, sheets, toasts (styles.css `--overlay*`).
	overlay: themed(p("white"), lit("oklch(0.234 0.006 286.033)")),
	"overlay-fg": themed(p("zinc-950"), p("zinc-50")),
	/** A popover's, toast's or tooltip's edge (`border-fg/10`). */
	"overlay-border": same(alpha(ref("fg"), 0.1)),
	/** A dialog's ring (`ring-fg/8 dark:ring-fg/10`). */
	"dialog-ring": themed(alpha(ref("fg"), 0.08), alpha(ref("fg"), 0.1)),
	/** A sheet's edge (`border-muted-fg/20 dark:border-border`). */
	"sheet-border": themed(alpha(ref("muted-fg"), 0.2), ref("border")),
	/** A modal's scrim (`overlay-tokens`): fg at 32% over the page. */
	scrim: same(alpha(ref("fg"), 0.32)),
	"overlay-backdrop": themed(lit("oklch(0.2 0.01 286 / 0.2)"), lit("oklch(0 0 0 / 0.5)")),
	/** A tooltip: ink on the page colour (`bg-fg text-bg`, muted text `text-bg/60`). */
	inverse: same(ref("fg")),
	"inverse-fg": same(ref("bg")),
	"inverse-muted": same(alpha(ref("bg"), 0.6)),
	navbar: themed(lit("oklch(0.988 0 0)"), lit("oklch(0.17 0.006 285.885)")),
	"navbar-fg": themed(p("zinc-950"), p("zinc-50")),
	"selection-bg": themed(p("brand-100"), p("brand-900")),
	"selection-fg": themed(p("brand-700"), p("brand-200")),
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
	"primary-subtle-fg": themed(p("brand-700"), p("brand-300")),
	/** The `accent` tone's ink: the brand's subtle ink (styles.css's own `--accent` is a grey, unused here). */
	"accent-fg": same(ref("primary-subtle-fg")),

	// Light tints over the page, from the chat seeds (`bg-primary/10`, `bg-warning/10`...).
	/** A mention, my reaction, a selected chip (`bg-primary/10`, hover `/20`, ring `/30`). */
	"primary-tint": same(alpha(ref("primary"), 0.1)),
	"primary-tint-hover": same(alpha(ref("primary"), 0.2)),
	"primary-tint-ring": same(alpha(ref("primary"), 0.3)),
	/** A selected filter chip (toggle-chip.ts `bg-primary-subtle/50`, `border-primary/50`). */
	"chip-selected": same(alpha(ref("primary-subtle"), 0.5)),
	"chip-selected-border": same(alpha(ref("primary"), 0.5)),
	/** A focused message row's ring (`ring-primary/40`). */
	"primary-focus": same(alpha(ref("primary"), 0.4)),
	/** A band under a block (`bg-secondary/40`) and a quiet chip under the pointer (`bg-secondary/80`). */
	"secondary-band": same(alpha(ref("secondary"), 0.4)),
	"secondary-soft": same(alpha(ref("secondary"), 0.8)),
	/** The channel sidebar's tip (`bg-secondary/50`, `frame-hint`). */
	"secondary-half": same(alpha(ref("secondary"), 0.5)),
	/** A pinned message (`bg-warning/10`, hover `/15`, its edge `border-warning`). */
	"warning-tint": same(alpha(ref("warning"), 0.1)),
	"warning-tint-hover": same(alpha(ref("warning"), 0.15)),
	/** A quiet destructive control under the pointer (`hover:bg-danger/10`). */
	"danger-tint": same(alpha(ref("danger"), 0.1)),
	/** An icon tile's faint fills (`icon-tile.ts` `bg-primary/5`, `bg-danger/5`, gap `icon-tile-tints`). */
	"primary-wash": same(alpha(ref("primary"), 0.05)),
	"danger-wash": same(alpha(ref("danger"), 0.05)),
	/** Tinted edges of icon tiles and callouts (`border-success/20`, `border-danger/15`, `callout.ts`). */
	"success-edge": same(alpha(ref("success"), 0.2)),
	"warning-edge": same(alpha(ref("warning"), 0.2)),
	"danger-edge": same(alpha(ref("danger"), 0.15)),
	"info-edge": same(alpha(ref("info-subtle-fg"), 0.15)),
	/** A chip of ink over code (`markdown-view.ts` copy button `bg-fg/10`, hover `/20`). */
	"fg-tint": same(alpha(ref("fg"), 0.1)),
	"fg-tint-hover": same(alpha(ref("fg"), 0.2)),
	// Code highlighting (`core/styles/code-syntax.css`): one ink per group of Prism token types.
	"syntax-comment": themed(lit("oklch(0.6 0.02 240)"), lit("oklch(0.55 0.02 240)")),
	"syntax-punctuation": themed(lit("oklch(0.5 0.02 240)"), lit("oklch(0.65 0.02 240)")),
	"syntax-constant": themed(lit("oklch(0.65 0.2 20)"), lit("oklch(0.75 0.2 20)")),
	"syntax-string": themed(lit("oklch(0.6 0.18 150)"), lit("oklch(0.7 0.18 150)")),
	"syntax-operator": themed(lit("oklch(0.65 0.15 200)"), lit("oklch(0.7 0.15 200)")),
	"syntax-keyword": themed(lit("oklch(0.6 0.2 260)"), lit("oklch(0.7 0.2 280)")),
	"syntax-function": themed(lit("oklch(0.65 0.18 40)"), lit("oklch(0.75 0.18 50)")),
	"syntax-variable": themed(lit("oklch(0.65 0.2 30)"), lit("oklch(0.75 0.2 40)")),
	/** Search hits, starred items, the verified mark (styles.css `--highlight`, `--favorite`, `--verified`). */
	highlight: themed(p("amber-200"), alpha(p("amber-400"), 0.2)),
	"highlight-fg": themed(p("amber-900"), p("amber-200")),
	favorite: same(p("amber-400")),
	"favorite-fg": themed(p("amber-600"), p("amber-300")),
	verified: themed(p("brand-500"), p("brand-400")),

	// Presence dots (`utils/status.ts`): busy is the app's warning; offline is a hollow ring.
	"presence-online": same(ref("success")),
	"presence-away": same(ref("warning")),
	"presence-busy": same(ref("warning")),
	"presence-offline": same(ref("muted-fg")),
	/** The ring that cuts a dot out of its avatar (`ring-bg`). */
	"presence-cutout": same(ref("bg")),
	// Toggle (switch.styles.ts): the track at rest and under the pointer, its edge, the thumb.
	"toggle-track": same(alpha(ref("fg"), 0.15)),
	"toggle-track-hover": same(alpha(ref("fg"), 0.2)),
	"toggle-edge": same(alpha(ref("fg"), 0.05)),
	"toggle-thumb": same(p("white")),
	/** Vendor marks, the same in both themes (`--color-slack`, `--color-discord`). */
	slack: same(lit("#4a154b")),
	discord: same(lit("#5865f2")),

	// The sidebar (styles.css `--sidebar-*`).
	sidebar: themed(lit("oklch(0.985 0 0)"), lit("oklch(0.18 0.006 285.885)")),
	"sidebar-fg": themed(lit("oklch(0.141 0.005 285.823)"), lit("oklch(0.985 0 0)")),
	"sidebar-primary": themed(alpha(p("brand-500"), 0.15), alpha(p("brand-500"), 0.2)),
	"sidebar-primary-fg": themed(p("brand-700"), p("brand-300")),
	"sidebar-accent": themed(lit("oklch(0.92 0.004 286.32)"), lit("oklch(0.274 0.006 286.033)")),
	"sidebar-accent-fg": themed(lit("oklch(0.141 0.005 285.823)"), lit("oklch(0.985 0 0)")),
	"sidebar-border": themed(lit("oklch(0.901 0.006 286.286)"), lit("oklch(1 0 0 / 0.07)")),
	"sidebar-ring": same(p("brand-500")),
	/** A section's title: `text-sidebar-fg/70`. */
	"sidebar-title": same(alpha(ref("sidebar-fg"), 0.7)),
	/** The sidebar's account card (`bg-accent/20`, hover `/50`; styles.css's grey `--accent`, `p4-sidebar-account-card`). */
	"account-card": themed(lit("oklch(0.92 0.004 286.32 / 0.2)"), lit("oklch(0.32 0.013 285.805 / 0.2)")),
	"account-card-hover": themed(lit("oklch(0.92 0.004 286.32 / 0.5)"), lit("oklch(0.32 0.013 285.805 / 0.5)")),
	/** The org switcher's resting ink (`text-fg/80`, hover `fg`). */
	"switcher-fg": same(alpha(ref("fg"), 0.8)),
	/** A selected table row (`bg-primary-subtle/40`, `table-selected-wash`). */
	"row-selected": same(alpha(ref("primary-subtle"), 0.4)),

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
		mono: 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"',
		sansFeatures: '"cv02", "cv03", "cv04", "cv11"',
		weight: { regular: 400, strong: 500, semibold: 600, bold: 700 },
	},
	/**
	 * Tailwind's steps as the kit uses them per size class (`text-base/6 sm:text-sm/5` is `body`).
	 * `title` and `display` are heading.styles.ts's `section` and `display` (tracking in px from its em);
	 * `code` is the app's `font-mono text-sm` (code blocks, inline code), set in the mono family.
	 */
	text: {
		body: { compact: { size: 16, lineHeight: 24 }, regular: { size: 14, lineHeight: 20 } },
		label: { compact: { size: 14, lineHeight: 20 }, regular: { size: 14, lineHeight: 20 } },
		caption: { compact: { size: 12, lineHeight: 16 }, regular: { size: 12, lineHeight: 16 } },
		title: {
			compact: { size: 16, lineHeight: 24, tracking: -0.176 },
			regular: { size: 16, lineHeight: 24, tracking: -0.176 },
		},
		display: {
			compact: { size: 24, lineHeight: 32, tracking: -0.48 },
			regular: { size: 24, lineHeight: 32, tracking: -0.48 },
		},
		code: { compact: { size: 14, lineHeight: 20 }, regular: { size: 14, lineHeight: 20 } },
		// heading.styles.ts `label` (`text-xs uppercase tracking-wider`) and kbd.styles.ts `md` (`text-2xs`).
		overline: {
			compact: { size: 12, lineHeight: 16, tracking: 0.6 },
			regular: { size: 12, lineHeight: 16, tracking: 0.6 },
		},
		kbd: { compact: { size: 11, lineHeight: 16 }, regular: { size: 11, lineHeight: 16 } },
		// Recipe-only steps (styles.css `--text-2xs`, `--text-3xs`): counts and small badges.
		tiny: { compact: { size: 11, lineHeight: 16 }, regular: { size: 11, lineHeight: 16 } },
		micro: { compact: { size: 10, lineHeight: 16 }, regular: { size: 10, lineHeight: 16 } },
		// A conversation row's two-line preview (`mobile-dms.ts`: `text-sm leading-snug`).
		snug: { compact: { size: 14, lineHeight: 19.25 }, regular: { size: 14, lineHeight: 19.25 } },
		// Chat text: today's message row is `text-base/6` at every width.
		reading: { compact: { size: 16, lineHeight: 24 }, regular: { size: 16, lineHeight: 24 } },
		// heading.styles.ts `title` (`text-lg/7 tracking-[-0.014em]`): channel settings' name.
		headline: {
			compact: { size: 18, lineHeight: 28, tracking: -0.252 },
			regular: { size: 18, lineHeight: 28, tracking: -0.252 },
		},
	},
	/** Tailwind's 4px grid by step name (`3` is `--spacing(3)`, 12px): every step the kit uses. */
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
		"5.5": 22,
		"6": 24,
		"7": 28,
		"8": 32,
		"9": 36,
		"10": 40,
		"11": 44,
		"12": 48,
		"14": 56,
		"16": 64,
		"20": 80,
		"24": 96,
	},
	/** styles.css `--radius-*` (lg is 0.5rem, the rest multiples of it); `none` is `rounded-none`. */
	radius: { none: 0, xs: 2, sm: 4, md: 6, lg: 8, xl: 12, "2xl": 16, "3xl": 24, "4xl": 32, full: 9999 },
	/**
	 * styles.css `--duration-*`, then the animations' own lengths (`--animate-*`): a message or a
	 * count arriving, a reaction pill appearing and popping, the indeterminate progress sweep.
	 */
	duration: {
		micro: 100,
		fast: 150,
		normal: 200,
		slow: 300,
		enter: 180,
		reactionEnter: 220,
		reactionPop: 260,
		progressSweep: 1600,
		/** Tailwind's `animate-bounce` (typing and thinking dots) and `animate-pulse` (skeletons). */
		bounce: 1000,
		pulse: 2000,
	},
	/** styles.css `--ease-*` (theme and `:root`) and the curves its animations name. */
	easing: {
		out: [0.23, 1, 0.32, 1],
		inOut: [0.77, 0, 0.175, 1],
		outQuad: [0.25, 0.46, 0.45, 0.94],
		outCubic: [0.215, 0.61, 0.355, 1],
		outQuart: [0.165, 0.84, 0.44, 1],
		inOutCubic: [0.645, 0.045, 0.355, 1],
		/** Message enter and count rolls. */
		enter: [0.2, 0, 0, 1],
		/** Reaction enter and pop: a slight overshoot. */
		overshoot: [0.34, 1.56, 0.64, 1],
		/** CSS's own `ease-out`, `ease-in` and `ease-in-out` (field errors, toasts leaving, the toggle). */
		cssOut: [0, 0, 0.58, 1],
		cssIn: [0.42, 0, 1, 1],
		cssInOut: [0.42, 0, 0.58, 1],
		/** CSS's `ease`, the default of an animation with no curve. */
		css: [0.25, 0.1, 0.25, 1],
		/** Tailwind's `ease-in` (a toast leaving) and its default curve (a transition with no `ease-*`). */
		in: [0.4, 0, 1, 1],
		standard: [0.4, 0, 0.2, 1],
		/** Tailwind's `animate-pulse`, and `animate-bounce`'s fall and rise. */
		pulse: [0.4, 0, 0.6, 1],
		fall: [0.8, 0, 1, 1],
		rise: [0, 0, 0.2, 1],
		/** A progress bar's value (`ease-linear`). */
		linear: [0, 0, 1, 1],
	},
	/** `--control-shadow` and `--elevation-*`: dark deepens them and lights raised surfaces' top edge. */
	shadow: {
		control: {
			light: "inset 0 1px 0 oklch(1 0 0 / 0.16), inset 0 -1px 0 oklch(0 0 0 / 0.12), 0 1px 2px oklch(0 0 0 / 0.08)",
			dark: "inset 0 1px 0 oklch(1 0 0 / 0.14), inset 0 -1px 0 oklch(0 0 0 / 0.2), 0 1px 2px oklch(0 0 0 / 0.3)",
		},
		xs: { light: "0 1px 2px 0 oklch(0 0 0 / 0.04)", dark: "0 1px 2px 0 oklch(0 0 0 / 0.3)" },
		/** Menus, popovers and dialogs (`overlay-tokens`): today they float with `shadow-xs`. */
		overlay: { light: "0 1px 2px 0 oklch(0 0 0 / 0.04)", dark: "0 1px 2px 0 oklch(0 0 0 / 0.3)" },
		sm: {
			light: "0 1px 2px -1px oklch(0 0 0 / 0.06), 0 1px 3px 0 oklch(0 0 0 / 0.06)",
			dark: "0 1px 2px -1px oklch(0 0 0 / 0.3), 0 1px 3px 0 oklch(0 0 0 / 0.35)",
		},
		md: {
			light: "0 2px 4px -2px oklch(0 0 0 / 0.05), 0 6px 16px -4px oklch(0 0 0 / 0.1)",
			dark: "inset 0 1px 0 oklch(1 0 0 / 0.04), 0 2px 4px -2px oklch(0 0 0 / 0.3), 0 6px 16px -4px oklch(0 0 0 / 0.45)",
		},
		lg: {
			light: "0 4px 8px -4px oklch(0 0 0 / 0.06), 0 16px 36px -8px oklch(0 0 0 / 0.14)",
			dark: "inset 0 1px 0 oklch(1 0 0 / 0.05), 0 4px 8px -4px oklch(0 0 0 / 0.4), 0 16px 36px -8px oklch(0 0 0 / 0.6)",
		},
		xl: {
			light: "0 8px 16px -8px oklch(0 0 0 / 0.08), 0 28px 64px -12px oklch(0 0 0 / 0.22)",
			dark: "inset 0 1px 0 oklch(1 0 0 / 0.06), 0 8px 16px -8px oklch(0 0 0 / 0.45), 0 28px 64px -12px oklch(0 0 0 / 0.7)",
		},
	},
	/** Poses over time (`MOTION.md`, from styles.css `@keyframes`); a pose left out is at rest. */
	keyframes: {
		fade: [{ at: 0, pose: { opacity: 0 } }],
		/** A tooltip above its trigger: in from 4px below (`starting:translate-y-1`). */
		tooltip: [{ at: 0, pose: { opacity: 0, y: 4 } }],
		/** A dialog on a phone, a sheet's menu (`starting:translate-y-4`). */
		rise: [{ at: 0, pose: { opacity: 0, y: 16 } }],
		/** A dialog from `sm` up (`sm:starting:scale-[0.97]`). */
		scale: [{ at: 0, pose: { opacity: 0, scale: 0.97 } }],
		/** A bottom sheet (`starting:translate-y-full`). */
		slideUp: [{ at: 0, pose: { opacity: 0, y: "100%" } }],
		/** A toast (`data-closed:translate-y-2`), in and out. */
		toast: [{ at: 0, pose: { opacity: 0, y: 8 } }],
		toastOut: [{ at: 1, pose: { opacity: 0, y: 8 } }],
		message: [{ at: 0, pose: { opacity: 0, y: 6 } }],
		reaction: [{ at: 0, pose: { opacity: 0, scale: 0.6 } }],
		pop: [{ at: 0.45, pose: { scale: 1.3 } }],
		countUp: [{ at: 0, pose: { opacity: 0, y: "70%" } }],
		countDown: [{ at: 0, pose: { opacity: 0, y: "-70%" } }],
		fieldError: [{ at: 0, pose: { opacity: 0, y: -4 } }],
		pulse: [{ at: 0.5, pose: { opacity: 0.5 } }],
		sweep: [
			{ at: 0, pose: { x: "-100%" } },
			{ at: 1, pose: { x: "250%" } },
		],
		bounce: [
			{ at: 0, pose: { y: "-25%" }, easing: "fall" },
			{ at: 0.5, pose: {}, easing: "rise" },
			{ at: 1, pose: { y: "-25%" } },
		],
	},
	/** The closed set of motions (`MOTION.md`): nothing else moves. */
	motion: {
		/** Menus, popovers, the emoji picker (`popover.styles.ts`). */
		fadeIn: { keyframes: "fade", duration: "fast", easing: "out" },
		/** A modal's backdrop (`modal.styles.ts`, `sheet.styles.ts`). */
		scrimIn: { keyframes: "fade", duration: "normal", easing: "out" },
		tooltipIn: { keyframes: "tooltip", duration: "fast", easing: "out" },
		riseIn: { keyframes: "rise", duration: "normal", easing: "out" },
		scaleIn: { keyframes: "scale", duration: "normal", easing: "out" },
		slideUpIn: { keyframes: "slideUp", duration: "normal", easing: "out" },
		toastIn: { keyframes: "toast", duration: "normal", easing: "out" },
		toastOut: { keyframes: "toastOut", duration: "fast", easing: "in" },
		messageIn: { keyframes: "message", duration: "enter", easing: "enter" },
		reactionIn: { keyframes: "reaction", duration: "reactionEnter", easing: "overshoot" },
		reactionPop: { keyframes: "pop", duration: "reactionPop", easing: "overshoot" },
		countUp: { keyframes: "countUp", duration: "enter", easing: "enter" },
		countDown: { keyframes: "countDown", duration: "enter", easing: "enter" },
		skeletonIn: { keyframes: "fade", duration: "fast", easing: "cssOut", delay: "slow" },
		skeletonPulse: { keyframes: "pulse", duration: "pulse", easing: "pulse", repeat: "forever" },
		fieldErrorIn: { keyframes: "fieldError", duration: "normal", easing: "cssOut" },
		progressSweep: {
			keyframes: "sweep",
			duration: "progressSweep",
			easing: "cssInOut",
			repeat: "forever",
		},
		bounce: { keyframes: "bounce", duration: "bounce", easing: "css", repeat: "forever" },
	},
	reducedMotion: "instant",
	/** The app's theme presets set `--color-brand-*` on the page (`core/lib/theme/apply.ts`). */
	hostPalette: { prefix: "brand-", cssPrefix: "--color-brand-" },
} as const satisfies Tokens

export interface HazelTokenNames {
	readonly color: keyof typeof tokens.color & string
	readonly radius: keyof typeof tokens.radius & string
	readonly space: keyof typeof tokens.space & string
	readonly shadow: keyof typeof tokens.shadow & string
	readonly duration: keyof typeof tokens.duration & string
	readonly easing: keyof typeof tokens.easing & string
	readonly motion: keyof typeof tokens.motion & string
}
