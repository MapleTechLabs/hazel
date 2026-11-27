// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * Who and where (today's `web-foldkit/src/customers/ui/identity.ts`): data source marks and chips,
 * company logos with an initials fallback, and owner avatars, on the hazel `avatar` and `image`.
 */
import type { CustomerSource } from "@hazel/domain/customers"
import type { Hazel } from "@hazel/ui/vocabulary/index"
import type { AvatarSize, AvatarTint } from "@hazel/ui/vocabulary/options"
import { providerOf, sourceLabel } from "../data/providers"

// SOURCES

/** The brand mark's image: Brandfetch's light icon for a provider, Hazel's own icon for Hazel. */
export const sourceLogoSrc = (source: CustomerSource): string =>
	source === "hazel"
		? "/icon.svg"
		: `https://cdn.brandfetch.io/${providerOf(source).domain}/w/64/h/64/theme/light/icon?token=1id0IQ-4i8Z46-n-DfQ`

/** The bare mark, 16px by default; decorative, the source's name is always beside it. */
export const sourceLogo = <Msg>(h: Hazel.H<Msg>, source: CustomerSource, size: 16 | 20 | 24 = 16) =>
	h.image.src(sourceLogoSrc(source)).alt("").width(size).height(size)

/** A mark on a tile (timelines, cards): `xs` 24px, `sm` 32px, `md` 40px. */
export const sourceMark = <Msg>(
	h: Hazel.H<Msg>,
	source: CustomerSource,
	options: Readonly<{ size?: "xs" | "sm" | "md" }> = {},
) =>
	h.iconTile
		.tone("mark")
		.image(sourceLogoSrc(source))
		.size(options.size === "md" ? "regular" : options.size === "xs" ? "xsmall" : "small")

/** `[mark] Name` in an outlined chip. */
export const sourceChip = <Msg>(
	h: Hazel.H<Msg>,
	source: CustomerSource,
	options: Readonly<{ label?: string }> = {},
) =>
	h.badge
		.style("outline")
		.size("large")
		.image(sourceLogoSrc(source))
		.label(options.label ?? sourceLabel(source))

// INITIALS

const wordInitials = (words: ReadonlyArray<string>): string =>
	words
		.slice(0, 2)
		.map((word) => word.charAt(0).toUpperCase())
		.join("")

/**
 * `Northwind Labs` to `NL`, `kestrel` to `KE`, empty to `?`. One word gives two letters, `-_.`
 * split words too, as today.
 */
export const initialsOf = (name: string): string => {
	const words = name
		.trim()
		.split(/[\s\-_.]+/)
		.filter((word) => word.length > 0)
	const [first, second] = words
	if (first === undefined) return "?"
	return second === undefined ? first.slice(0, 2).toUpperCase() : wordInitials(words)
}

// COMPANY LOGOS

export type LogoSize = "2xs" | "xs" | "sm" | "md" | "lg"

/** A provider's logo URL, if it is https (anything else, `http:` or `data:` included, shows initials). */
export const safeLogoUrl = (url: string | null | undefined): string | null => {
	if (!url) return null
	try {
		return new URL(url).protocol === "https:" ? url : null
	} catch {
		return null
	}
}

/** 16 · 20 · 28 · 40 · 48px rounded squares. */
const LOGO_SIZE = {
	"2xs": "xxsmall",
	xs: "inline",
	sm: "row",
	md: "medium",
	lg: "large",
} as const satisfies Record<LogoSize, AvatarSize>

/** Initials tints, picked by a hash of the name so a company keeps its colour everywhere. */
const TINTS = [
	"accent",
	"info",
	"success",
	"warning",
	"danger",
	"neutral",
] as const satisfies ReadonlyArray<AvatarTint>

/** FNV-1a, so the tint is stable across sessions and machines. */
export const tintOf = (name: string): AvatarTint => {
	let hash = 0x811c9dc5
	for (const char of name.trim().toLowerCase()) {
		hash ^= char.codePointAt(0) ?? 0
		hash = Math.imul(hash, 0x01000193)
	}
	return TINTS[(hash >>> 0) % TINTS.length] ?? "neutral"
}

/** The company's logo, else its initials. Decorative: the name is always next to it. */
export const companyLogo = <Msg>(
	h: Hazel.H<Msg>,
	options: Readonly<{ name: string; logoUrl?: string | null; size?: LogoSize }>,
) => {
	const size = options.size ?? "sm"
	const initials = initialsOf(options.name)
	return h.avatar
		.initials(size === "2xs" ? initials.slice(0, 1) : initials)
		.src(safeLogoUrl(options.logoUrl) ?? undefined)
		.size(LOGO_SIZE[size])
		.shape("square")
		.tint(tintOf(options.name))
}

// PEOPLE

export type Person = Readonly<{ name: string; avatarUrl?: string | null }>

/** 24 · 32px. */
export type PersonSize = "sm" | "md"

/** An owner or assignee: their picture, else initials on a tint; `null` is the dashed "Unassigned". */
export const personAvatar = <Msg>(h: Hazel.H<Msg>, person: Person | null, size: PersonSize = "sm") => {
	const avatar = h.avatar.size(size === "md" ? "small" : "xsmall")
	return person === null
		? avatar.placeholder()
		: avatar
				.initials(initialsOf(person.name))
				.src(safeLogoUrl(person.avatarUrl) ?? undefined)
				.tint(tintOf(person.name))
}

/** Avatar plus name; `null` reads "Unassigned", muted. */
export const personLabel = <Msg>(h: Hazel.H<Msg>, person: Person | null) =>
	h.stack
		.axis("horizontal")
		.density("compact")
		.align("center")
		.children(
			personAvatar(h, person),
			h.text
				.truncate()
				.tone(person === null ? "muted" : "default")
				.children(person?.name ?? "Unassigned"),
		)
