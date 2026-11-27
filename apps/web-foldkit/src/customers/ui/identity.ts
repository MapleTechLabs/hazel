import type { CustomerSource } from "@hazel/domain/customers"
import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { getBrandfetchIcon } from "~/lib/integrations/__data"
import { IconUser } from "../../icons"
import { avatar } from "../../ui/avatar"
import { initialsOf as wordInitials } from "../../ui/semantic"
import { providerOf, sourceLabel } from "../providers"

/**
 * Who and where (Foundations › Source Chips, Avatars And Company Logos): data source marks and
 * chips, company logos with an initials fallback, and owner avatars.
 */

// SOURCES

/** The brand mark's image: Brandfetch for providers, Hazel's own icon for Hazel. */
export const sourceLogoSrc = (source: CustomerSource): string =>
	source === "hazel"
		? "/icon.svg"
		: getBrandfetchIcon(providerOf(source).domain, { theme: "light", type: "icon", size: 64 })

const logoImage = <M>(h: HtmlBuilder<M>, source: CustomerSource, className: string): Html =>
	h.img([
		h.Src(sourceLogoSrc(source)),
		h.Alt(""),
		h.Attribute("loading", "lazy"),
		h.Class(twMerge("shrink-0 rounded-sm object-contain", className)),
	])

/** The bare mark, sized by `className` (default 16px). */
export const sourceLogo = <M>(h: HtmlBuilder<M>, source: CustomerSource, className = "size-4"): Html =>
	logoImage(h, source, className)

/** A mark on a tile (timelines, cards): `sm` 32px, `md` 40px. */
export const sourceMark = <M>(
	h: HtmlBuilder<M>,
	source: CustomerSource,
	options: Readonly<{ size?: "xs" | "sm" | "md"; className?: string }> = {},
): Html =>
	h.span(
		[
			h.Class(
				twMerge(
					"inline-flex shrink-0 items-center justify-center rounded-lg bg-secondary",
					options.size === "md"
						? "size-10"
						: options.size === "xs"
							? "size-6 rounded-md"
							: "size-8",
					options.className,
				),
			),
			h.Title(sourceLabel(source)),
		],
		[
			logoImage(
				h,
				source,
				options.size === "md" ? "size-6" : options.size === "xs" ? "size-4" : "size-5",
			),
		],
	)

const chipClassName =
	"inline-flex h-7 items-center gap-1.5 rounded-md border border-border pr-2 pl-1.5 font-medium text-fg text-xs"

/** `[mark] Name`. */
export const sourceChip = <M>(
	h: HtmlBuilder<M>,
	source: CustomerSource,
	options: Readonly<{ label?: string; className?: string }> = {},
): Html =>
	h.span(
		[h.Class(twMerge(chipClassName, options.className))],
		[logoImage(h, source, "size-4"), options.label ?? sourceLabel(source)],
	)

// TINTS

/**
 * Initials tints, picked by a hash of the name so a company keeps its color everywhere: the theme's
 * subtle pairs (brand, sky, emerald, amber, rose), so they follow dark mode and the brand colour.
 */
const TINTS = [
	"bg-primary-subtle text-primary-subtle-fg",
	"bg-info-subtle text-info-subtle-fg",
	"bg-success-subtle text-success-subtle-fg",
	"bg-warning-subtle text-warning-subtle-fg",
	"bg-danger-subtle text-danger-subtle-fg",
	"bg-secondary text-secondary-fg",
] as const

/** FNV-1a, so the tint is stable across sessions and machines. */
export const tintIndex = (name: string): number => {
	let hash = 0x811c9dc5
	for (const char of name.trim().toLowerCase()) {
		hash ^= char.codePointAt(0) ?? 0
		hash = Math.imul(hash, 0x01000193)
	}
	return (hash >>> 0) % TINTS.length
}

/**
 * `Northwind Labs` → `NL`, `kestrel` → `KE`, `` → `?`. Several words take the kit's initials
 * (`ui/semantic`); a company is often one word or `north-wind`, so one word gives two letters, `-_.`
 * split words too, and nothing gives `?` rather than the kit's empty string.
 */
export const initialsOf = (name: string): string => {
	const words = name
		.trim()
		.split(/[\s\-_.]+/)
		.filter((word) => word.length > 0)
	const [first, second] = words
	if (first === undefined) return "?"
	return second === undefined ? first.slice(0, 2).toUpperCase() : wordInitials(words.join(" "))
}

// COMPANY LOGOS

export type LogoSize = "2xs" | "xs" | "sm" | "md" | "lg"

/** 16 · 20 · 28 · 40 · 48px. */
const LOGO_SIZE = {
	"2xs": "size-4 rounded-sm text-3xs",
	xs: "size-5 rounded-sm text-3xs",
	sm: "size-7 rounded-md text-2xs",
	md: "size-10 rounded-lg text-sm",
	lg: "size-12 rounded-xl text-base",
} as const satisfies Record<LogoSize, string>

/** A provider's logo URL, if it is https (anything else, `http:` or `data:` included, shows initials). */
export const safeLogoUrl = (url: string | null | undefined): string | null => {
	if (!url) return null
	try {
		return new URL(url).protocol === "https:" ? url : null
	} catch {
		return null
	}
}

/** The company's logo, else its initials on a tint. Decorative: the name is always next to it. */
export const companyLogo = <M>(
	h: HtmlBuilder<M>,
	options: Readonly<{ name: string; logoUrl?: string | null; size?: LogoSize; className?: string }>,
): Html => {
	const size = LOGO_SIZE[options.size ?? "sm"]
	const logoUrl = safeLogoUrl(options.logoUrl)
	return logoUrl !== null
		? h.img([
				h.Src(logoUrl),
				h.Alt(""),
				h.Attribute("loading", "lazy"),
				h.Attribute("referrerpolicy", "no-referrer"),
				h.Class(twMerge("shrink-0 bg-secondary object-cover", size, options.className)),
			])
		: h.span(
				[
					h.AriaHidden(true),
					h.Class(
						twMerge(
							"inline-flex shrink-0 select-none items-center justify-center font-semibold",
							size,
							TINTS[tintIndex(options.name)],
							options.className,
						),
					),
				],
				// At 16px two letters do not fit: the first one only.
				[options.size === "2xs" ? initialsOf(options.name).slice(0, 1) : initialsOf(options.name)],
			)
}

// PEOPLE

export type AvatarSize = "sm" | "md"

/** 24 · 32px. */
const AVATAR_SIZE = {
	sm: "size-6 text-3xs",
	md: "size-8 text-xs",
} as const satisfies Record<AvatarSize, string>

/**
 * The kit `avatar` (its shape, picture and fill), round, inside a box that carries the size, the
 * hover name and the stack's ring; the kit has no title or ring of its own.
 */
const avatarBox = <M>(
	h: HtmlBuilder<M>,
	options: Readonly<{
		title: string
		size: AvatarSize
		className?: string
		ring?: boolean
		/** The picture, or what stands in for it (initials, a glyph). */
		placeholder: Html
		/** The kit avatar's own fill and text, e.g. an initials tint. */
		avatarClassName?: string
	}>,
): Html =>
	h.span(
		[
			h.Title(options.title),
			h.Class(
				twMerge(
					"inline-flex shrink-0 rounded-full",
					AVATAR_SIZE[options.size],
					options.ring === true && "ring-2 ring-bg",
					options.className,
				),
			),
		],
		[
			avatar(h, {
				size: options.size === "md" ? "sm" : "xs",
				isSquare: false,
				placeholder: options.placeholder,
				className: twMerge("size-full select-none font-semibold", options.avatarClassName),
			}),
		],
	)

/** An owner or assignee: their picture, else initials on a tint; `null` is the dashed "Unassigned". */
export const personAvatar = <M>(
	h: HtmlBuilder<M>,
	person: Readonly<{ name: string; avatarUrl?: string | null }> | null,
	options: Readonly<{ size?: AvatarSize; className?: string; ring?: boolean }> = {},
): Html => {
	const size = options.size ?? "sm"
	if (person === null)
		return avatarBox(h, {
			title: "Unassigned",
			size,
			className: options.className,
			placeholder: IconUser(h, { className: "size-3" }),
			avatarClassName: "border border-muted-fg/60 border-dashed bg-transparent text-muted-fg",
		})
	const avatarUrl = safeLogoUrl(person.avatarUrl)
	return avatarBox(h, {
		title: person.name,
		size,
		className: options.className,
		ring: options.ring,
		// The kit's `src` sends the referrer; a third-party picture must not learn which page showed it.
		placeholder:
			avatarUrl !== null
				? h.img([
						h.Src(avatarUrl),
						h.Alt(""),
						h.Attribute("referrerpolicy", "no-referrer"),
						h.Class("size-full rounded-full object-cover"),
					])
				: h.span(
						[],
						[
							h.span([h.AriaHidden(true)], [initialsOf(person.name)]),
							h.span([h.Class("sr-only")], [person.name]),
						],
					),
		avatarClassName: avatarUrl !== null ? undefined : TINTS[tintIndex(person.name)],
	})
}

/** `personAvatar` leading a menu item: the dropdown's `avatar` slot sizes it (an `icon` slot is too small). */
export const menuAvatar = <M>(
	h: HtmlBuilder<M>,
	person: Readonly<{ name: string; avatarUrl?: string | null }> | null,
): Html =>
	h.span(
		[h.DataAttribute("slot", "avatar"), h.Class("inline-flex size-(--avatar-size)")],
		[personAvatar(h, person, { className: "size-full" })],
	)

/** Avatar plus name; `null` reads "Unassigned". */
export const personLabel = <M>(
	h: HtmlBuilder<M>,
	person: Readonly<{ name: string; avatarUrl?: string | null }> | null,
	options: Readonly<{ className?: string }> = {},
): Html =>
	h.span(
		[h.Class(twMerge("inline-flex min-w-0 items-center gap-2 text-sm", options.className))],
		[
			personAvatar(h, person),
			h.span(
				[h.Class(twMerge("truncate", person === null ? "text-muted-fg" : "text-fg"))],
				[person?.name ?? "Unassigned"],
			),
		],
	)
