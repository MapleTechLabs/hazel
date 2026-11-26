/**
 * The style layer's schema (docs/hazel-ui.md, "Style layer", contract C3): tokens and per-primitive
 * recipes as typed data. `scripts/generate.ts` turns them into `tokens.css` and `Theme.swift`.
 *
 * What a recipe can express (each maps to CSS and to Swift):
 * - Declarations from a fixed list (`Declarations`), every value a token name or a token step:
 *   colours, spacing, radii, text roles, durations, opacity, a fixed set of shadows.
 * - Colour tokens as literals (`oklch`, `rgb`, hex), aliases, `color-mix` in oklab (`mix`) and alpha
 *   (`alpha`). CSS keeps the expression; Swift gets the sRGB value computed at codegen.
 * - Named parts and slots of the primitive's own structure (`parts`): `[data-hz-part=x]` or
 *   `[data-hz-slot=x]` children of the root or of another named part (`in`), and `children`, the
 *   renderer's children (`> [data-hz]`). Never arbitrary descendants or other primitives.
 * - Closed options (`data-<option>=<value>`), boolean states (`data-<state>`), interaction states
 *   (hover, pressed, focusVisible as `:hover`, `:active`, `:focus-visible`, suppressed while disabled
 *   or loading), compounds of options, and the size class (`regular` overrides `compact`; on the web
 *   `@media (width >= 40rem)`, Tailwind's `sm:`; on iOS the horizontal size class).
 *
 * What the web renderer of a primitive owns instead (not expressible here, by design):
 * - Pseudo-element hit areas (`after:` 44pt targets on a coarse pointer): the renderer adds them.
 * - `forced-colors` rules (system colours such as `ButtonText`, `GrayText`).
 * - Selectors into children it does not own (`**:data-[slot=menu-trigger]`, `has-[...]`, `[&_.x]`),
 *   and layout tricks tied to the DOM (`subgrid`, `group-*`, `in-data-*` ancestor variants).
 * - Breakpoints other than the size class, `pointer-fine:`, container queries.
 * - Focus rings (offset rings over a page colour), `scale` on press, and transitions'
 *   property lists. Swift has its own press and focus feedback.
 */

// Closed sets (docs/hazel-ui.md, "Design language")

export const textRoles = ["body", "label", "caption", "title", "display", "code"] as const
export type TextRole = (typeof textRoles)[number]

export const textTones = [
	"default",
	"muted",
	"subtle",
	"accent",
	"success",
	"warning",
	"danger",
	"info",
] as const
export type TextTone = (typeof textTones)[number]

/** `text.strong`: on or off, the one weight choice a view has. */
export type TextStrong = boolean

export const buttonVariants = ["primary", "secondary", "outline", "ghost", "warning", "danger"] as const
export type ButtonVariant = (typeof buttonVariants)[number]

export const buttonSizes = ["large", "regular", "small", "xsmall"] as const
export type ButtonSize = (typeof buttonSizes)[number]

export const badgeTones = ["neutral", "accent", "success", "warning", "danger", "info"] as const
export type BadgeTone = (typeof badgeTones)[number]

/** `solid` is the tinted fill, `outline` a hairline ring, `quiet` a grey fill with muted ink. */
export const badgeStyles = ["solid", "outline", "quiet"] as const
export type BadgeStyle = (typeof badgeStyles)[number]

export const badgeSizes = ["regular", "small"] as const
export type BadgeSize = (typeof badgeSizes)[number]

/** Boolean states a view sets (`data-<state>` on the web). */
export const dataStates = ["selected", "emphasized", "disabled", "loading", "destructive"] as const
export type DataState = (typeof dataStates)[number]

/** States the host derives from input; views never set them. */
export const interactionStates = ["hover", "pressed", "focusVisible"] as const
export type InteractionState = (typeof interactionStates)[number]

export type State = DataState | InteractionState

export const sizeClasses = ["compact", "regular"] as const
export type SizeClass = (typeof sizeClasses)[number]

// Tokens

/** A colour: a CSS literal, another token, a mix in oklab, or a token at an alpha. */
export type ColorExpr =
	| { readonly literal: string }
	| { readonly ref: string }
	| { readonly mix: readonly [ColorExpr, number, ColorExpr] }
	| { readonly alpha: readonly [ColorExpr, number] }

export interface ThemedColor {
	readonly light: ColorExpr
	readonly dark: ColorExpr
}

/** One size class's metrics for a text role, in px (pt on iOS). */
export interface TypeMetrics {
	readonly size: number
	readonly lineHeight: number
	readonly tracking?: number
}

export interface TypeRole {
	readonly compact: TypeMetrics
	readonly regular: TypeMetrics
	/** `numeric`: tabular figures. */
	readonly numeric?: boolean
}

export interface Shadow {
	readonly light: string
	readonly dark: string
}

/** Type steps only recipes use (a count badge's 11px), never a view's `text.role`. */
export const recipeTextSteps = ["tiny", "micro"] as const
export type RecipeTextStep = (typeof recipeTextSteps)[number]
export type TextStep = TextRole | RecipeTextStep

export interface Tokens {
	/** Raw palette steps (`zinc-950`); roles reference them, recipes never do. */
	readonly palette: Readonly<Record<string, string>>
	/** Colour roles with light and dark values. */
	readonly color: Readonly<Record<string, ThemedColor>>
	readonly font: {
		readonly sans: string
		readonly mono: string
		readonly sansFeatures: string
		readonly weight: { readonly regular: number; readonly strong: number }
	}
	readonly text: Readonly<Record<TextStep, TypeRole>>
	/** Spacing steps in px (Tailwind's 4px grid: step `3` is 12). */
	readonly space: Readonly<Record<string, number>>
	readonly radius: Readonly<Record<string, number>>
	readonly duration: Readonly<Record<string, number>>
	readonly easing: Readonly<Record<string, readonly [number, number, number, number]>>
	readonly shadow: Readonly<Record<string, Shadow>>
}

// Recipes

/** `children` is every renderer child of the primitive (`> [data-hz]`). */
export type PartKind = "part" | "slot" | "children"

/** A part directly under the root, or under another named part (`in`). */
export type PartSpec<Part extends string = string> = PartKind | { readonly kind: PartKind; readonly in: Part }

/** A spacing step, optionally less the primitive's border (Tailwind's `calc(--spacing(3) - 1px)`). */
export type Length<Space extends string> = Space | { readonly step: Space; readonly lessBorder: true }

/** The declarations a recipe may set; every value is a token name. */
export interface Declarations<T extends TokenNames = TokenNames> {
	readonly background?: T["color"] | "transparent"
	readonly color?: T["color"]
	readonly borderColor?: T["color"] | "transparent"
	readonly borderWidth?: "none" | "hairline"
	readonly radius?: T["radius"]
	/** A hairline drawn inside the box (`inset 0 0 0 1px`), taking no space; not with `shadow`. */
	readonly ring?: T["color"]
	/** A hairline under the box (a bar's bottom edge). */
	readonly divider?: T["color"]
	readonly paddingX?: Length<T["space"]>
	readonly paddingY?: Length<T["space"]>
	readonly paddingStart?: Length<T["space"]>
	readonly gap?: T["space"]
	/** Gap between rows of a container's own children. */
	readonly rowGap?: T["space"]
	readonly marginBottom?: T["space"]
	readonly marginX?: T["space"]
	readonly minHeight?: T["space"]
	/** Width and height, for square things (icons, icon-only buttons). */
	readonly size?: T["space"]
	readonly text?: TextStep
	/** Line height as a spacing step, over the text role's (a control's box metric). */
	readonly leading?: T["space"]
	readonly strong?: boolean
	/** A hairline text stroke over the weight (`faux-medium`); the web only, iOS draws the weight. */
	readonly stroke?: boolean
	/** Tabular figures (counts). */
	readonly numeric?: boolean
	readonly opacity?: number
	readonly shadow?: T["shadow"]
	/** `contents`: no box of its own, its children lay out in its parent (a structural wrapper). */
	readonly layout?: "row" | "column" | "inline-row" | "contents"
	/** A row's children wrap onto new lines (`flex-wrap`). */
	readonly wrap?: boolean
	/** Fills its container's width. */
	readonly fill?: boolean
	readonly align?: "center" | "start"
	readonly justify?: "center" | "start"
	readonly truncate?: boolean
	readonly nowrap?: boolean
	readonly grow?: boolean
	readonly shrink?: boolean
	readonly transition?: T["duration"]
	/** A negative inline margin by this step (Tailwind `-mx-0.5`). */
	readonly bleedX?: T["space"]
}

export interface TokenNames {
	readonly color: string
	readonly radius: string
	readonly space: string
	readonly shadow: string
	readonly duration: string
}

/** The declarations for the root and for each named part. */
export interface PartStyles<Part extends string, T extends TokenNames> {
	readonly root?: Declarations<T>
	readonly parts?: Partial<Record<Part, Declarations<T>>>
}

/** Styles at `compact` (the default), with `regular` overrides and per-state layers. */
export interface Layer<Part extends string, T extends TokenNames> extends PartStyles<Part, T> {
	readonly regular?: PartStyles<Part, T>
	readonly states?: Partial<Record<State, PartStyles<Part, T> & { readonly regular?: PartStyles<Part, T> }>>
}

export interface Option<Value extends string, Part extends string, T extends TokenNames> {
	readonly default: Value
	readonly values: Readonly<Record<Value, Layer<Part, T>>>
}

export interface Recipe<
	Options extends Readonly<Record<string, string>> = Readonly<Record<string, string>>,
	Flags extends string = string,
	Part extends string = string,
	T extends TokenNames = TokenNames,
> {
	/** The `data-hz` tag. */
	readonly primitive: string
	/** Named parts and slots, each `part` (`data-hz-part`, host-built) or `slot` (`data-hz-slot`). */
	readonly parts: Readonly<Record<Part, PartSpec<Part>>>
	readonly base: Layer<Part, T>
	readonly options: { readonly [K in keyof Options]: Option<Options[K], Part, T> }
	/** Boolean options a view sets (`iconOnly`), as `data-<flag>`. */
	readonly flags?: Readonly<Record<Flags, Layer<Part, T>>>
	readonly states?: Partial<Record<State, Layer<Part, T>>>
	readonly compounds?: ReadonlyArray<{
		readonly when: Partial<Options> & Partial<Record<Flags, true>>
		readonly style: Layer<Part, T>
	}>
	/** States whose presence suppresses the interaction states. */
	readonly inert?: ReadonlyArray<DataState>
}
