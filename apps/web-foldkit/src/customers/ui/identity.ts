import type { CustomerSource } from "@hazel/domain/customers"
import type { Html, HtmlBuilder } from "foldkit/html"
import { twMerge } from "tailwind-merge"
import { getBrandfetchIcon } from "~/lib/integrations/__data"
import { IconExternalLink, IconUser } from "../../icons"

/**
 * Who and where (Foundations › Source Chips, Avatars And Company Logos): data source marks and
 * chips, company logos with an initials fallback, and owner avatars.
 */

// SOURCES

export const SOURCE_LABEL = {
	clerk: "Clerk",
	stripe: "Stripe",
	autumn: "Autumn",
	maple: "Maple",
	hazel: "Hazel",
} as const satisfies Record<CustomerSource, string>

const SOURCE_DOMAIN = {
	clerk: "clerk.com",
	stripe: "stripe.com",
	autumn: "useautumn.com",
	maple: "maple.dev",
} as const satisfies Record<Exclude<CustomerSource, "hazel">, string>

/** The brand mark's image: Brandfetch for providers, Hazel's own icon for Hazel. */
export const sourceLogoSrc = (source: CustomerSource): string =>
	source === "hazel"
		? "/icon.svg"
		: getBrandfetchIcon(SOURCE_DOMAIN[source], { theme: "light", type: "icon", size: 64 })

const logoImage = <M>(h: HtmlBuilder<M>, source: CustomerSource, className: string): Html =>
	h.img([
		h.Src(sourceLogoSrc(source)),
		h.Alt(""),
		h.Attribute("loading", "lazy"),
		h.Class(twMerge("shrink-0 rounded-[4px] object-contain", className)),
	])

/** The bare mark, sized by `className` (default 16px). */
export const sourceLogo = <M>(h: HtmlBuilder<M>, source: CustomerSource, className = "size-4"): Html =>
	logoImage(h, source, className)

/** A mark on a tile (timelines, cards): `sm` 32px, `md` 40px. */
export const sourceMark = <M>(
	h: HtmlBuilder<M>,
	source: CustomerSource,
	options: Readonly<{ size?: "sm" | "md"; className?: string }> = {},
): Html =>
	h.span(
		[
			h.Class(
				twMerge(
					"inline-flex shrink-0 items-center justify-center rounded-lg bg-secondary",
					options.size === "md" ? "size-10" : "size-8",
					options.className,
				),
			),
			h.Title(SOURCE_LABEL[source]),
		],
		[logoImage(h, source, options.size === "md" ? "size-6" : "size-5")],
	)

const chipClassName =
	"inline-flex h-7 items-center gap-1.5 rounded-md border border-border px-1.5 font-medium text-fg text-sm"

/** `[mark] Stripe`. */
export const sourceChip = <M>(
	h: HtmlBuilder<M>,
	source: CustomerSource,
	options: Readonly<{ label?: string; className?: string }> = {},
): Html =>
	h.span(
		[h.Class(twMerge(chipClassName, options.className))],
		[logoImage(h, source, "size-4"), options.label ?? SOURCE_LABEL[source]],
	)

/** `[mark] cus_Q8f2Lk ↗`: links out to the provider's record in a new tab. */
export const sourceLinkChip = <M>(
	h: HtmlBuilder<M>,
	options: Readonly<{ source: CustomerSource; label: string; href: string; className?: string }>,
): Html =>
	h.a(
		[
			h.Href(options.href),
			h.Target("_blank"),
			h.Rel("noreferrer"),
			h.AriaLabel(`${options.label} in ${SOURCE_LABEL[options.source]}`),
			h.Class(
				twMerge(
					chipClassName,
					"group bg-secondary/60 font-mono text-xs hover:bg-secondary focus-visible:outline-2 focus-visible:outline-ring",
					options.className,
				),
			),
		],
		[
			logoImage(h, options.source, "size-4"),
			options.label,
			IconExternalLink(h, { className: "size-3 text-muted-fg group-hover:text-fg" }),
		],
	)

// TINTS

/** Initials tints, picked by a hash of the name so a company keeps its color everywhere. */
const TINTS = [
	"bg-purple-500/15 text-purple-700 dark:text-purple-300",
	"bg-sky-500/15 text-sky-700 dark:text-sky-300",
	"bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
	"bg-amber-500/15 text-amber-700 dark:text-amber-300",
	"bg-rose-500/15 text-rose-700 dark:text-rose-300",
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

/** `Northwind Labs` → `NL`, `kestrel` → `KE`, `` → `?`. */
export const initialsOf = (name: string): string => {
	const words = name
		.trim()
		.split(/[\s\-_.]+/)
		.filter((word) => word.length > 0)
	const [first, second] = words
	if (first === undefined) return "?"
	return (second === undefined ? first.slice(0, 2) : `${first.charAt(0)}${second.charAt(0)}`).toUpperCase()
}

// COMPANY LOGOS

export type LogoSize = "xs" | "sm" | "md" | "lg"

/** 20 · 28 · 40 · 48px. */
const LOGO_SIZE = {
	xs: "size-5 rounded-[5px] text-[9px]",
	sm: "size-7 rounded-md text-[11px]",
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
				[initialsOf(options.name)],
			)
}

// PEOPLE

export type AvatarSize = "sm" | "md"

const AVATAR_SIZE = {
	sm: "size-6 text-[10px]",
	md: "size-8 text-xs",
} as const satisfies Record<AvatarSize, string>

/** An owner or assignee: their picture, else initials on a tint; `null` is the dashed "Unassigned". */
export const personAvatar = <M>(
	h: HtmlBuilder<M>,
	person: Readonly<{ name: string; avatarUrl?: string | null }> | null,
	options: Readonly<{ size?: AvatarSize; className?: string; ring?: boolean }> = {},
): Html => {
	const size = AVATAR_SIZE[options.size ?? "sm"]
	const ring = options.ring ? "ring-2 ring-bg" : ""
	if (person === null)
		return h.span(
			[
				h.Title("Unassigned"),
				h.Class(
					twMerge(
						"inline-flex shrink-0 items-center justify-center rounded-full border border-muted-fg/60 border-dashed text-muted-fg",
						size,
						options.className,
					),
				),
			],
			[IconUser(h, { className: "size-3" })],
		)
	return person.avatarUrl
		? h.img([
				h.Src(person.avatarUrl),
				h.Alt(""),
				h.Title(person.name),
				h.Class(twMerge("shrink-0 rounded-full object-cover", size, ring, options.className)),
			])
		: h.span(
				[
					h.Title(person.name),
					h.Class(
						twMerge(
							"inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold",
							size,
							TINTS[tintIndex(person.name)],
							ring,
							options.className,
						),
					),
				],
				[
					h.span([h.AriaHidden(true)], [initialsOf(person.name)]),
					h.span([h.Class("sr-only")], [person.name]),
				],
			)
}

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

/** Overlapping avatars, then `+N` past `max`. */
export const avatarStack = <M>(
	h: HtmlBuilder<M>,
	people: ReadonlyArray<Readonly<{ name: string; avatarUrl?: string | null }>>,
	options: Readonly<{ max?: number; className?: string }> = {},
): Html => {
	const max = options.max ?? 3
	const shown = people.slice(0, people.length > max ? max - 1 : max)
	const rest = people.length - shown.length
	return h.span(
		[h.Class(twMerge("inline-flex items-center -space-x-1.5", options.className))],
		[
			...shown.map((person) => personAvatar(h, person, { ring: true })),
			...(rest > 0
				? [
						h.span(
							[
								h.Class(
									"inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary text-[10px] text-secondary-fg ring-2 ring-bg",
								),
								h.Title(
									people
										.slice(shown.length)
										.map((person) => person.name)
										.join(", "),
								),
							],
							[`+${rest}`],
						),
					]
				: []),
		],
	)
}
