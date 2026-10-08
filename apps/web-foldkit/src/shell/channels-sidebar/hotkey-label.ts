/**
 * `useAppHotkeyLabel` for default bindings: `@tanstack/hotkeys`' `formatForDisplay`
 * (macOS symbols, `Ctrl+K` style elsewhere). User overrides from settings are not read yet.
 */

type Platform = "mac" | "windows" | "linux"

const detectPlatform = (): Platform => {
	if (typeof navigator === "undefined") return "linux"
	const platform = navigator.platform?.toLowerCase() ?? ""
	const userAgent = navigator.userAgent?.toLowerCase() ?? ""
	if (platform.includes("mac") || userAgent.includes("mac")) return "mac"
	if (platform.includes("win") || userAgent.includes("win")) return "windows"
	return "linux"
}

const MODIFIER_ORDER = ["Control", "Alt", "Shift", "Meta"] as const
type Modifier = (typeof MODIFIER_ORDER)[number]

const MAC_SYMBOLS: Record<Modifier, string> = { Control: "⌃", Alt: "⌥", Shift: "⇧", Meta: "⌘" }
const STANDARD_LABELS: Record<Modifier, string> = { Control: "Ctrl", Alt: "Alt", Shift: "Shift", Meta: "Win" }

const toModifier = (part: string, platform: Platform): Modifier | undefined => {
	const lower = part.toLowerCase()
	if (lower === "mod") return platform === "mac" ? "Meta" : "Control"
	if (lower === "control" || lower === "ctrl") return "Control"
	if (lower === "alt" || lower === "option") return "Alt"
	if (lower === "shift") return "Shift"
	if (lower === "meta" || lower === "cmd" || lower === "command") return "Meta"
	return undefined
}

export const hotkeyLabel = (hotkey: string, platform: Platform = detectPlatform()): string => {
	const parts = hotkey.split("+")
	const modifiers = new Set(parts.flatMap((part) => toModifier(part, platform) ?? []))
	const key = parts.filter((part) => toModifier(part, platform) === undefined).join("+")
	const ordered = MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier))
	return platform === "mac"
		? [...ordered.map((modifier) => MAC_SYMBOLS[modifier]), key].join("")
		: [...ordered.map((modifier) => STANDARD_LABELS[modifier]), key].join("+")
}
