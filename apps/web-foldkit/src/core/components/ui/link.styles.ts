import type { ClassNameValue } from "tailwind-merge"

/** Composed with `cx(linkStyles(...), className)`. */
export const linkStyles = (options: { readonly hasHref: boolean }): ClassNameValue[] => [
	"font-medium text-(--text)",
	"outline-0 outline-offset-2 transition-[color,_opacity] focus-visible:outline-2 focus-visible:outline-ring forced-colors:outline-[Highlight]",
	"data-disabled:cursor-default data-disabled:text-muted-fg forced-colors:data-disabled:text-[GrayText]",
	options.hasHref && "cursor-pointer",
]
