// Effect UI is a public preview: every API is experimental by design here.
// @effect-diagnostics experimentalApiUsage:off
/**
 * Who and where (today's `web-foldkit/src/customers/ui/identity.ts`): data source marks and chips,
 * company logos with an initials fallback, and owner avatars, on the hazel `avatar` and `image`.
 */
import type { CustomerSource } from "@hazel/domain/customers"
import type { Hazel } from "@hazel/ui/vocabulary/index"
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
	// HAZEL-GAP(pk0-source-tile): today's mark sits on a `bg-secondary` rounded tile (24, 32 or 40px); `iconTile` takes only an `IconName`, so the mark is drawn bare at the tile's inner size.
	sourceLogo(h, source, options.size === "md" ? 24 : options.size === "xs" ? 16 : 20)

/** `[mark] Name` in an outlined chip. */
export const sourceChip = <Msg>(
	h: Hazel.H<Msg>,
	source: CustomerSource,
	options: Readonly<{ label?: string }> = {},
) =>
	// HAZEL-GAP(pk0-source-chip): today's chip is a 28px outlined box with the mark; `badge` has no image, so the mark and label sit in a horizontal stack.
	h.stack
		.axis("horizontal")
		.density("compact")
		.align("center")
		.children(
			sourceLogo(h, source),
			h.text
				.role("label")
				.strong()
				.children(options.label ?? sourceLabel(source)),
		)

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

const logoSize = (size: LogoSize) =>
	// HAZEL-GAP(pk0-logo-sizes): today's logos are 16, 20, 28, 40 and 48px rounded squares; `avatarSizes` has 20 (round), 40 and 48.
	size === "lg" ? "large" : size === "md" ? "medium" : "regular"

/** The company's logo, else its initials. Decorative: the name is always next to it. */
export const companyLogo = <Msg>(
	h: Hazel.H<Msg>,
	options: Readonly<{ name: string; logoUrl?: string | null; size?: LogoSize }>,
) => {
	const size = options.size ?? "sm"
	const initials = initialsOf(options.name)
	// HAZEL-GAP(pk0-initials-tint): today's initials sit on one of six subtle tints picked by a hash of the name; `avatar` draws initials on its muted fill (a `name` would draw the dither instead).
	return h.avatar
		.initials(size === "2xs" ? initials.slice(0, 1) : initials)
		.src(safeLogoUrl(options.logoUrl) ?? undefined)
		.size(logoSize(size))
}

// PEOPLE

export type Person = Readonly<{ name: string; avatarUrl?: string | null }>

/** An owner or assignee: their picture, else initials; `null` is "Unassigned". */
export const personAvatar = <Msg>(h: Hazel.H<Msg>, person: Person | null) =>
	// HAZEL-GAP(pk0-avatar-sizes): today's owner avatars are 24 and 32px; `avatar` regular is 20.
	person === null
		? // HAZEL-GAP(pk0-unassigned): today's "Unassigned" is a dashed ring around a user glyph; the avatar shows `?` on its muted fill.
			h.avatar.initials("?")
		: h.avatar.initials(initialsOf(person.name)).src(safeLogoUrl(person.avatarUrl) ?? undefined)

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
