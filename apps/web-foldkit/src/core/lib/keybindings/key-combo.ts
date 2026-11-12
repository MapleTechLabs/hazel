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

const MODIFIER_ALIASES = new Map(
	Object.entries({ mod: "Mod", control: "Control", meta: "Meta", alt: "Alt", shift: "Shift" } as const),
)

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
	if ([...raw].length !== 1) return undefined
	// Upper case, unless that makes it two letters (`ß` is `SS`).
	const upper = raw.toUpperCase()
	return [...upper].length === 1 ? upper : raw
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
		const modifier = MODIFIER_ALIASES.get(part.trim().toLowerCase())
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
	// Both held: name them both, since `Mod` cannot sit beside the key it stands for.
	if (primary && secondary) {
		held.add("Control")
		held.add("Meta")
	} else if (primary) held.add("Mod")
	else if (secondary) held.add(platform === "mac" ? "Control" : "Meta")
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

/** Keys that type nothing, so they cannot steal a character from a text field. */
const NON_TYPING_KEYS = new Set(
	Object.values(NAMED_KEYS).filter((key) => key !== "Space" && key !== "Plus" && key !== "Tab"),
)
/** Keys that may stand alone, with no modifier at all. */
const STANDALONE_KEYS = new Set([
	"Escape",
	"PageUp",
	"PageDown",
	...Array.from({ length: 24 }, (_, index) => `F${index + 1}`),
])

/**
 * Whether a combo is safe to bind app-wide, where it also fires in the composer and takes the
 * keystroke from it. It needs ⌘, Ctrl or Win; Alt only with a key that types nothing (⌥ types `@` or
 * `ø` on a Mac, AltGr does elsewhere); and only Escape, PageUp/PageDown and F-keys may stand alone.
 * `K`, `Shift+K`, `Alt+K`, `Tab` and `ArrowUp` are not safe.
 */
export const isTypingSafe = (keyCombo: KeyCombo): boolean => {
	const parsed = parseCombo(keyCombo)
	if (parsed === undefined) return false
	const { modifiers, key } = parsed
	if (modifiers.has("Mod") || modifiers.has("Control") || modifiers.has("Meta")) return true
	if (modifiers.has("Alt")) return NON_TYPING_KEYS.has(key)
	return STANDALONE_KEYS.has(key)
}

// LABELS

const MAC_SYMBOLS = { Mod: "⌘", Control: "⌃", Meta: "⌘", Alt: "⌥", Shift: "⇧" } satisfies Record<
	Modifier,
	string
>
const STANDARD_LABELS = {
	Mod: "Ctrl",
	Control: "Ctrl",
	Meta: "Win",
	Alt: "Alt",
	Shift: "Shift",
} satisfies Record<Modifier, string>
/** Display order: the platform's own (⌃⌥⇧⌘ on a Mac, Ctrl+Alt+Shift elsewhere). */
const MAC_DISPLAY_ORDER: ReadonlyArray<Modifier> = ["Control", "Alt", "Shift", "Mod", "Meta"]
const STANDARD_DISPLAY_ORDER: ReadonlyArray<Modifier> = ["Mod", "Control", "Alt", "Shift", "Meta"]

const KEY_LABELS = new Map(
	Object.entries({
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
	}),
)

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
	return [...modifierCaps(parsed.modifiers, platform), KEY_LABELS.get(parsed.key) ?? parsed.key]
}

/** The whole combo as one label: `⌘⇧K` on a Mac, `Ctrl+Shift+K` elsewhere. */
export const comboLabel = (text: string, platform: Platform = detectPlatform()): string =>
	keyCaps(text, platform).join(platform === "mac" ? "" : "+")

// SEARCH

const MODIFIER_WORDS = {
	mac: {
		Mod: ["cmd", "command", "mod"],
		Control: ["ctrl", "control"],
		Meta: ["cmd", "command"],
		Alt: ["option", "opt", "alt"],
		Shift: ["shift"],
	},
	windows: {
		Mod: ["ctrl", "control", "mod"],
		Control: ["ctrl", "control"],
		Meta: ["win", "windows", "meta"],
		Alt: ["alt"],
		Shift: ["shift"],
	},
	linux: {
		Mod: ["ctrl", "control", "mod"],
		Control: ["ctrl", "control"],
		Meta: ["super", "meta"],
		Alt: ["alt"],
		Shift: ["shift"],
	},
} satisfies Record<Platform, Record<Modifier, ReadonlyArray<string>>>

const KEY_WORDS = new Map(
	Object.entries({
		ArrowUp: ["up", "arrow"],
		ArrowDown: ["down", "arrow"],
		ArrowLeft: ["left", "arrow"],
		ArrowRight: ["right", "arrow"],
		Escape: ["esc", "escape"],
		PageUp: ["pgup", "page", "up"],
		PageDown: ["pgdn", "page", "down"],
		Enter: ["enter", "return"],
		Backspace: ["backspace"],
		Delete: ["del", "delete"],
		"/": ["slash", "/"],
		Plus: ["plus", "+"],
	}),
)

/**
 * The words a combo answers to in a search, lower case: the key caps, and the names people type for
 * them (`cmd`, `option` on a Mac; `ctrl`, `alt` elsewhere; `esc`, `up`).
 */
export const comboSearchWords = (text: string, platform: Platform): ReadonlyArray<string> => {
	const parsed = parseCombo(text)
	if (parsed === undefined) return [text.toLowerCase()]
	const words = [
		...keyCaps(text, platform),
		...[...parsed.modifiers].flatMap((modifier) => MODIFIER_WORDS[platform][modifier]),
		parsed.key,
		...(KEY_WORDS.get(parsed.key) ?? []),
	]
	return [...new Set(words.map((word) => word.toLowerCase()))]
}
