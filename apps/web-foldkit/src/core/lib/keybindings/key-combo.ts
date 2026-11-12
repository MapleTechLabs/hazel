import { Option, Schema } from "effect"

/**
 * One key press with its modifiers, in the notation Foldkit's `Dom.streamFromKeyBindings` matches
 * (`Mod+Shift+K`, `Alt+ArrowUp`, `Escape`). `Mod` is ⌘ on Apple platforms and Ctrl elsewhere, so a
 * combo recorded on a Mac means the same thing on Windows.
 *
 * Combos are kept canonical (modifiers in `MODIFIER_ORDER`, letters upper case), so two spellings of
 * one press are equal strings, and `identityOf` folds `Mod` into the platform's key for conflicts.
 */

export const Platform = Schema.Literals(["mac", "windows", "linux"])
export type Platform = typeof Platform.Type

export const detectPlatform = (): Platform => {
	if (typeof navigator === "undefined") return "linux"
	const platform = navigator.platform?.toLowerCase() ?? ""
	const userAgent = navigator.userAgent?.toLowerCase() ?? ""
	if (/mac|iphone|ipad|ipod/.test(platform) || /mac|iphone|ipad|ipod/.test(userAgent)) return "mac"
	if (platform.includes("win") || userAgent.includes("win")) return "windows"
	return "linux"
}

export const MODIFIER_ORDER = ["Mod", "Control", "Meta", "Alt", "Shift"] as const
export type Modifier = (typeof MODIFIER_ORDER)[number]

export interface ParsedCombo {
	readonly modifiers: ReadonlySet<Modifier>
	/** The key, canonical: `K`, `/`, `ArrowUp`, `Space`, `Plus`. */
	readonly key: string
}

/** `KeyboardEvent.key` values that are only modifiers, or that no binding can match. */
const UNBINDABLE_KEYS = new Set([
	"alt",
	"altgraph",
	"capslock",
	"control",
	"fn",
	"fnlock",
	"hyper",
	"meta",
	"numlock",
	"os",
	"scrolllock",
	"shift",
	"super",
	"symbol",
	"symbollock",
	"dead",
	"unidentified",
	"process",
	"compose",
])

const MODIFIER_ALIASES: Readonly<Record<string, Modifier>> = {
	mod: "Mod",
	control: "Control",
	meta: "Meta",
	alt: "Alt",
	shift: "Shift",
}

/** Named keys, keyed by their lower case: the canonical spelling `KeyboardEvent.key` uses. */
const NAMED_KEYS: Readonly<Record<string, string>> = Object.fromEntries(
	[
		"ArrowUp",
		"ArrowDown",
		"ArrowLeft",
		"ArrowRight",
		"Escape",
		"Enter",
		"Tab",
		"Backspace",
		"Delete",
		"Insert",
		"Home",
		"End",
		"PageUp",
		"PageDown",
		"Space",
		"Plus",
		...Array.from({ length: 24 }, (_, index) => `F${index + 1}`),
	].map((key) => [key.toLowerCase(), key]),
)

const canonicalKey = (raw: string): string | undefined => {
	if (raw === " ") return "Space"
	if (raw === "+") return "Plus"
	const lower = raw.toLowerCase()
	if (lower === "" || UNBINDABLE_KEYS.has(lower)) return undefined
	if (NAMED_KEYS[lower] !== undefined) return NAMED_KEYS[lower]
	// One printable character (a letter, digit or symbol); longer names are keys we do not know.
	return [...raw].length === 1 ? raw.toUpperCase() : undefined
}

/** Reads `Mod+Shift+K`; `undefined` for anything Foldkit would reject. */
export const parseCombo = (text: string): ParsedCombo | undefined => {
	const parts = text.split("+")
	const rawKey = parts.at(-1)
	if (rawKey === undefined) return undefined
	const key = canonicalKey(rawKey.trim())
	if (key === undefined) return undefined
	const modifiers = new Set<Modifier>()
	for (const part of parts.slice(0, -1)) {
		const modifier = MODIFIER_ALIASES[part.trim().toLowerCase()]
		if (modifier === undefined || modifiers.has(modifier)) return undefined
		modifiers.add(modifier)
	}
	if (modifiers.has("Mod") && (modifiers.has("Control") || modifiers.has("Meta"))) return undefined
	return { modifiers, key }
}

const formatParsed = ({ modifiers, key }: ParsedCombo): string =>
	[...MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier)), key].join("+")

/** A key press, as stored and as bound: valid for Foldkit, and canonical. */
export const KeyCombo = Schema.String.check(
	Schema.makeFilter((text: string) => {
		const parsed = parseCombo(text)
		if (parsed === undefined) return "not a key combo, like Mod+Shift+K"
		return formatParsed(parsed) === text || `not canonical: write it as ${formatParsed(parsed)}`
	}),
).pipe(Schema.brand("KeyCombo"))
export type KeyCombo = typeof KeyCombo.Type

/** Any spelling of a combo, made canonical (`ctrl+shift+k` is not one: use `Control`). */
export const normalizeCombo = (text: string): Option.Option<KeyCombo> =>
	Option.map(Option.fromUndefinedOr(parseCombo(text)), (parsed) => formatParsed(parsed) as KeyCombo)

/** A combo written in code: canonicalizes it, and throws on a typo (caught by the keymap's tests). */
export const combo = (text: string): KeyCombo =>
	Option.getOrThrowWith(normalizeCombo(text), () => new Error(`Invalid key combo "${text}"`))

/** The physical press a combo means on `platform`: `Mod+K` and `Meta+K` are one press on a Mac. */
export const identityOf = (keyCombo: KeyCombo, platform: Platform): string => {
	const parsed = parseCombo(keyCombo)
	if (parsed === undefined) return keyCombo
	const modifiers = new Set(parsed.modifiers)
	if (modifiers.delete("Mod")) modifiers.add(platform === "mac" ? "Meta" : "Control")
	return formatParsed({ modifiers, key: parsed.key }).toLowerCase()
}

/** The fields of a `KeyboardEvent` a recording reads. */
export interface KeyPress {
	readonly key: string
	readonly metaKey: boolean
	readonly ctrlKey: boolean
	readonly altKey: boolean
	readonly shiftKey: boolean
}

/**
 * The modifiers held in `press`, with the platform's primary key (⌘ on a Mac, Ctrl elsewhere) as
 * `Mod`, so what a Mac user records works on Windows.
 */
export const heldModifiers = (press: KeyPress, platform: Platform): ReadonlySet<Modifier> => {
	const held = new Set<Modifier>()
	const primary = platform === "mac" ? press.metaKey : press.ctrlKey
	const secondary = platform === "mac" ? press.ctrlKey : press.metaKey
	if (primary) held.add("Mod")
	if (secondary) held.add(platform === "mac" ? "Control" : "Meta")
	if (press.altKey) held.add("Alt")
	if (press.shiftKey) held.add("Shift")
	return held
}

/** The combo a key press makes; `None` for a press of a modifier alone, or of a key no binding can match. */
export const comboOfPress = (press: KeyPress, platform: Platform): Option.Option<KeyCombo> => {
	const key = canonicalKey(press.key)
	if (key === undefined) return Option.none()
	return Option.some(formatParsed({ modifiers: heldModifiers(press, platform), key }) as KeyCombo)
}

// LABELS

const MAC_SYMBOLS: Record<Modifier, string> = { Mod: "⌘", Control: "⌃", Meta: "⌘", Alt: "⌥", Shift: "⇧" }
const STANDARD_LABELS: Record<Modifier, string> = {
	Mod: "Ctrl",
	Control: "Ctrl",
	Meta: "Win",
	Alt: "Alt",
	Shift: "Shift",
}
/** Display order: the platform's own (⌃⌥⇧⌘ on a Mac, Ctrl+Alt+Shift elsewhere). */
const MAC_DISPLAY_ORDER: ReadonlyArray<Modifier> = ["Control", "Alt", "Shift", "Mod", "Meta"]
const STANDARD_DISPLAY_ORDER: ReadonlyArray<Modifier> = ["Mod", "Control", "Alt", "Shift", "Meta"]

const KEY_LABELS: Readonly<Record<string, string>> = {
	ArrowUp: "↑",
	ArrowDown: "↓",
	ArrowLeft: "←",
	ArrowRight: "→",
	Escape: "Esc",
	PageUp: "PgUp",
	PageDown: "PgDn",
	Backspace: "⌫",
	Delete: "Del",
	Plus: "+",
}

const modifierLabel = (modifier: Modifier, platform: Platform) =>
	platform === "mac" ? MAC_SYMBOLS[modifier] : STANDARD_LABELS[modifier]

/** The modifiers' key caps, in the platform's order. */
export const modifierCaps = (modifiers: ReadonlySet<Modifier>, platform: Platform): ReadonlyArray<string> =>
	(platform === "mac" ? MAC_DISPLAY_ORDER : STANDARD_DISPLAY_ORDER)
		.filter((modifier) => modifiers.has(modifier))
		.map((modifier) => modifierLabel(modifier, platform))

/** One label per key cap: `["⌘", "⇧", "K"]`, or `["Ctrl", "Shift", "K"]`. */
export const keyCaps = (text: string, platform: Platform = detectPlatform()): ReadonlyArray<string> => {
	const parsed = parseCombo(text)
	if (parsed === undefined) return [text]
	return [...modifierCaps(parsed.modifiers, platform), KEY_LABELS[parsed.key] ?? parsed.key]
}

/** The whole combo as one label: `⌘⇧K` on a Mac, `Ctrl+Shift+K` elsewhere. */
export const comboLabel = (text: string, platform: Platform = detectPlatform()): string =>
	keyCaps(text, platform).join(platform === "mac" ? "" : "+")
