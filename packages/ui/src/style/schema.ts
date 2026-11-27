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
 *
 * Motion (`MOTION.md`): named motions are tokens (`keyframes`, `motion`); a recipe's `motion` says which
 * one plays on which part for a trigger. The renderer only marks when (`data-motion`).
 */

/** What a recipe expresses (C3, frozen): each maps to CSS and to Swift. Anything else is renderer code. */
export const recipeFeatures = [
	"token declarations (Declarations)",
	"colour literals, aliases, color-mix in oklab, alpha",
	"named parts and slots of the primitive's own structure, and its direct children",
	"closed options, boolean flags and compounds of them",
	"view states (selected, emphasized, disabled, loading, destructive)",
	"interaction states (hover, pressed, focusVisible), suppressed by inert states",
	"the size class (compact, regular)",
	"motion uses: a named motion per trigger (enter, exit, counts, pop, loop) on a part or the backdrop",
	"transitions: a duration and a curve for hover and press",
] as const

/** What the web renderer of a primitive owns instead (C3, frozen). */
export const rendererFeatures = [
	"pseudo-element hit areas (44pt targets on a coarse pointer)",
	"forced-colors rules",
	"selectors into children it does not own, subgrid, group and ancestor variants",
	"breakpoints other than the size class, pointer-fine, container queries",
	"focus rings, scale on press, transition property lists",
	"when a motion plays (data-motion), staggers between siblings, keeping a panel until its exit ends",
] as const

// Closed sets (docs/hazel-ui.md, "Design language")

/** `overline` is the kit's uppercase group label (Today, Older); `kbd` a key cap inside a line of text. */
export const textRoles = ["body", "label", "caption", "title", "display", "code", "overline", "kbd"] as const
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

/** `chip` is a fully round filter chip: filled while `pressed`, quiet otherwise (`filter-chip`). */
export const buttonVariants = [
	"primary",
	"secondary",
	"outline",
	"ghost",
	"warning",
	"danger",
	"chip",
] as const
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

// C1: the sets the doc names for layout, content and chat tags (values fixed in phase 1).

export const stackAxes = ["vertical", "horizontal"] as const
export type StackAxis = (typeof stackAxes)[number]

/** `tight` is a sidebar's section group (`gap-y-0.5`, `stack-tight`). */
/**
 * `none` sets a title on its subtitle; `snug` is the kit's `gap-3` (an icon tile beside its name);
 * `loose` its `gap-5` (a page header over its tabs).
 */
export const stackDensities = ["tight", "compact", "regular", "relaxed", "none", "snug", "loose"] as const
export type StackDensity = (typeof stackDensities)[number]

export const stackAligns = ["stretch", "start", "center", "end"] as const
export type StackAlign = (typeof stackAligns)[number]

/**
 * `danger` is the danger zone's card with a tinted header (`frame-danger`); `flush` the card with no
 * padding, its dividers running edge to edge (`frame-flush`); `hint` a sidebar's quiet
 * tip, inset by the rows' margin (`frame-hint`).
 */
export const frameSurfaces = ["none", "card", "inset", "muted", "overlay", "danger", "flush", "hint"] as const
export type FrameSurface = (typeof frameSurfaces)[number]

/**
 * A section's header (`section-style`): `sidebar` is the sidebar's group; `tree` the channel
 * sidebar's (`tree.ts`: the name `pl-2.5`, muted 12/20, rows right under it); `list` a phone list's
 * (DMs: an inset uppercase label over full-width rows); `sticky` the inbox's, whose label sticks
 * over its group while it scrolls (activity).
 */
/**
 * A screen's surface (`screen-surface`): `sidebar` is the sidebar's column under its own title;
 * `page` a phone tab's page (`mobileTopBar`: a 56pt sticky bar, the section heading, the page ground).
 */
export const screenSurfaces = ["sidebar", "page", "centered"] as const
export type ScreenSurface = (typeof screenSurfaces)[number]

/** `eyebrow`: settings' "Account" and "Workspace" (a `heading` `label` inset `px-3 pt-3 pb-1` over its rows). */
export const sectionStyles = ["sidebar", "tree", "list", "sticky", "eyebrow"] as const
export type SectionStyle = (typeof sectionStyles)[number]

/** A link's ink: `accent` the kit's link; `muted` a quiet way back ("Back to channel", hover `fg`). */
export const linkTones = ["accent", "muted"] as const
export type LinkTone = (typeof linkTones)[number]

/**
 * A table's own edge (`table-frame`): `none` inside a card that frames it; `card` today's
 * `dataTable` (`rounded-xl border`); `band` the customers list's hairlines above and below only.
 */
export const tableFrames = ["none", "card", "band"] as const
export type TableFrame = (typeof tableFrames)[number]

/**
 * Where a row's hover actions go (`pk0-queue-actions-swap`): `lastCell` over the last cell (today's
 * `dataTable`), `trailing` in place of every cell after the `fill` column (the attention queue).
 */
export const tableRowActions = ["lastCell", "trailing"] as const
export type TableRowActions = (typeof tableRowActions)[number]

/** A heading's size over its level's: `large` is the kit's `title` (18/28), a page's subject. */
export const headingSizes = ["auto", "large"] as const
export type HeadingSize = (typeof headingSizes)[number]

/** `1` is a screen's title, `2` a section's, `3` a group's. */
export const headingLevels = ["1", "2", "3"] as const
export type HeadingLevel = (typeof headingLevels)[number]

export const avatarPresences = ["none", "online", "away", "busy", "offline"] as const
export type AvatarPresence = (typeof avatarPresences)[number]

/**
 * `regular` sits beside an icon (sidebar rows); `medium` is the kit's `md`, a 40pt rounded square
 * (DM and activity rows, `avatar-row-size`); `large` the settings logo that is its own upload button.
 */
export const avatarSizes = ["regular", "medium", "large"] as const
export type AvatarSize = (typeof avatarSizes)[number]

/** A synced author's or mention's provider mark: `none`, Slack or Discord. */
export const providerMarks = ["none", "slack", "discord"] as const
export type ProviderMark = (typeof providerMarks)[number]

/** A stack of avatars: `row` overlaps them in a line, `pair` sets two diagonally in one avatar's box. */
export const avatarStackLayouts = ["row", "pair"] as const
export type AvatarStackLayout = (typeof avatarStackLayouts)[number]

/** A tinted square behind a glyph (the kit's `iconTile`); tones are the kit's intents. */
export const iconTileTones = ["neutral", "accent", "success", "warning", "danger"] as const
export type IconTileTone = (typeof iconTileTones)[number]

/** An unread row's mark at its start: the sidebar's edge `pip`, or activity's brand `dot`. */
export const itemUnreadMarks = ["none", "pip", "dot"] as const
export type ItemUnreadMark = (typeof itemUnreadMarks)[number]

/** How many lines an item's title or subtitle wraps to before it truncates. */
export const lineCounts = ["1", "2"] as const
export type LineCount = (typeof lineCounts)[number]

/** An item's leading slot: icon-sized, or `large` (a 40pt avatar or icon tile, top aligned). */
export const itemLeadingSizes = ["regular", "large", "conversation"] as const
export type ItemLeadingSize = (typeof itemLeadingSizes)[number]

/**
 * A sidebar row's look: `row` a list row; `nav` a section sidebar's page link (settings, activity:
 * the current page on `sidebar-accent` with a brand icon); `switcher` the org switcher at the sidebar's top (a 32pt
 * square logo, no wash); `account` the account card at its foot (bordered, tinted, a 32pt square face).
 */
export const itemStyles = ["row", "nav", "switcher", "account"] as const
export type ItemStyle = (typeof itemStyles)[number]

/** A row hanging off the row above (a thread under its channel): the elbow's shape. */
export const itemNestings = ["none", "middle", "last"] as const
export type ItemNesting = (typeof itemNestings)[number]

/** An empty state's illustration: an asset each platform ships under this name. */
export const emptyIllustrations = ["none", "squirrel"] as const
export type EmptyIllustration = (typeof emptyIllustrations)[number]

export const listDividerKinds = ["date", "unread"] as const
export type ListDividerKind = (typeof listDividerKinds)[number]

/** Where a list rests and what it keeps still when rows arrive: `end` is a chat. */
export const listAnchors = ["start", "end"] as const
export type ListAnchor = (typeof listAnchors)[number]

// Phase 4 (`docs/hazel-ui-phase4.md`, "Contract wave"): the sets the web pages need.

/** A grid's columns: `auto` fills the row with as many as fit; the compact size class drops to one. */
export const gridColumns = ["auto", "2", "3", "4"] as const
export type GridColumns = (typeof gridColumns)[number]

/** `cards` is the kit's choice box; `segmented` the segmented control; `swatches` a colour picker. */
export const choiceStyles = ["list", "cards", "segmented", "chips", "swatches"] as const
export type ChoiceStyle = (typeof choiceStyles)[number]

/** A toggle's look: today's switch, or a checkbox (with `indeterminate`). */
export const toggleStyles = ["switch", "checkbox"] as const
export type ToggleStyle = (typeof toggleStyles)[number]

/** `spinner` is the kit's loader ring, for an inline wait; `bar` the progress bar. */
export const progressStyles = ["bar", "spinner"] as const
export type ProgressStyle = (typeof progressStyles)[number]

/** `callout` is the kit's bordered note; `bar` a full-width band (the "N new messages" bar). */
export const bannerStyles = ["callout", "bar"] as const
export type BannerStyle = (typeof bannerStyles)[number]

/** `app` is the phone's bottom tabs; `page` in-page tabs under a header (customer detail, queues). */
export const tabBarStyles = ["app", "page"] as const
export type TabBarStyle = (typeof tabBarStyles)[number]

/** A chart's form; the sparklines draw with no axes, sized for a table cell or a stat tile. */
export const chartKinds = [
	"line",
	"area",
	"bar",
	"stackedBar",
	"sparkline",
	"barSparkline",
	"distribution",
] as const
export type ChartKind = (typeof chartKinds)[number]

export const chartSizes = ["regular", "small", "large"] as const
export type ChartSize = (typeof chartSizes)[number]

/** A stat tile's delta: its direction, and whether that direction is good (`goodWhen`, decided by the view). */
export const statTrends = ["none", "up", "down"] as const
export type StatTrend = (typeof statTrends)[number]

export const statDeltaTones = ["neutral", "success", "danger"] as const
export type StatDeltaTone = (typeof statDeltaTones)[number]

/** An attachment grid's arrangement: a message's mosaic, the files page's grid, masonry or a list. */
export const attachmentLayouts = ["mosaic", "grid", "masonry", "list"] as const
export type AttachmentLayout = (typeof attachmentLayouts)[number]

/**
 * Boolean states a view sets (`data-<state>` on the web). Chat states are the message's own. `linked`
 * is the host's, not a view's: the row's control is a link (`href`, `item-link-weight`).
 */
export const dataStates = ["selected", "emphasized", "disabled", "loading", "destructive", "linked"] as const
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

/**
 * Type steps only recipes use (a count badge's 11px), never a view's `text.role`. `reading` is chat
 * text, 16/24 at every width (a message row does not step down like `body`); `snug` a DM preview, 14/19.25.
 */
export const recipeTextSteps = ["tiny", "micro", "reading", "snug", "headline"] as const
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
		/** `semibold` (600): kit headings, dialog titles, chat authors; `bold` (700): `**bold**` runs. */
		readonly weight: {
			readonly regular: number
			readonly strong: number
			readonly semibold: number
			readonly bold: number
		}
	}
	readonly text: Readonly<Record<TextStep, TypeRole>>
	/** Spacing steps in px (Tailwind's 4px grid: step `3` is 12). */
	readonly space: Readonly<Record<string, number>>
	readonly radius: Readonly<Record<string, number>>
	readonly duration: Readonly<Record<string, number>>
	readonly easing: Readonly<Record<string, readonly [number, number, number, number]>>
	readonly shadow: Readonly<Record<string, Shadow>>
	/** Poses over time, by name (`MOTION.md`). */
	readonly keyframes: Readonly<Record<string, ReadonlyArray<Keyframe>>>
	/** The closed set of motions: what may move, how long and on which curve. */
	readonly motion: Readonly<Record<string, Motion>>
	/** What Reduce Motion does: today every motion and transition completes at once, loops play once. */
	readonly reducedMotion: "instant"
	/** Palette steps the web host may set at runtime (the app's brand preset): `brand-` reads `--color-brand-*`. */
	readonly hostPalette?: { readonly prefix: string; readonly cssPrefix: string }
}

// Motion (MOTION.md)

/** A length a pose moves by: px, or a fraction of the element's own size (`"70%"`). */
export type Offset = number | `${number}%`

/** What a keyframe sets; a field it leaves out is at rest (opacity 1, no offset, scale 1). */
export interface Pose {
	readonly opacity?: number
	readonly x?: Offset
	readonly y?: Offset
	readonly scale?: number
}

/** A pose at a point of the motion (0 to 1), with the curve to the next keyframe if it has its own. */
export interface Keyframe {
	readonly at: number
	readonly pose: Pose
	readonly easing?: string
}

export interface Motion {
	readonly keyframes: string
	readonly duration: string
	readonly easing: string
	/** Waits this long before it starts (a skeleton that a fast load never shows). */
	readonly delay?: string
	readonly repeat?: "forever"
}

/** When a motion plays: a primitive appearing, leaving, its count rising or falling, a pop, a loop. */
export const motionTriggers = ["enter", "exit", "countUp", "countDown", "pop", "loop"] as const
export type MotionTrigger = (typeof motionTriggers)[number]

/** One motion a primitive plays: on its root or a part, or on a modal panel's `::backdrop`. */
export interface MotionUse<Part extends string, T extends TokenNames> {
	readonly motion: T["motion"]
	readonly part?: Part
	readonly backdrop?: true
	/** The motion at the `regular` size class, when it differs. */
	readonly regular?: T["motion"]
	/**
	 * Seconds between siblings (`motion-stagger`): the n-th starts n steps later; with `staggerAhead`
	 * the last starts at once and earlier ones are already that far into the loop (the typing dots).
	 */
	readonly stagger?: number
	readonly staggerAhead?: true
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
	/** One edge over `paddingY` (a list header's `pt-3`, `section-style`). */
	readonly paddingTop?: Length<T["space"]>
	readonly paddingBottom?: Length<T["space"]>
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
	/** A weight above `strong` (`semibold-weight`, `chat-weights`); wins over `strong`. */
	readonly weight?: "semibold" | "bold"
	/** Uppercase text (the `overline` role). */
	readonly uppercase?: boolean
	/** Centred text (`recipe-text-align`). */
	readonly textAlign?: "center"
	/** Lines before the text truncates with an ellipsis (`item-title-lines`); 1 is `truncate`. */
	readonly lineClamp?: 2
	/** Scrolls its overflow along one axis (`recipe-overflow`). */
	readonly overflow?: "scrollX" | "scrollY"
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
	readonly align?: "center" | "start" | "end"
	readonly justify?: "center" | "start"
	readonly truncate?: boolean
	readonly nowrap?: boolean
	readonly grow?: boolean
	readonly shrink?: boolean
	readonly transition?: T["duration"]
	/** The transition's curve (`out` when unset). */
	readonly transitionEase?: T["easing"]
	/** A minimum width (a count pill that stays round at one digit). */
	readonly minWidth?: T["space"]
	/** A negative inline margin by this step (Tailwind `-mx-0.5`). */
	readonly bleedX?: T["space"]
}

export interface TokenNames {
	readonly color: string
	readonly radius: string
	readonly space: string
	readonly shadow: string
	readonly duration: string
	readonly easing: string
	readonly motion: string
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
	/** The motions it plays, by trigger (`MOTION.md`). */
	readonly motion?: Partial<Record<MotionTrigger, ReadonlyArray<MotionUse<Part, T>>>>
}
