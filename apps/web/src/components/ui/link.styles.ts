import type { ClassNameValue } from "tailwind-merge"

/** Shared by the React and Foldkit apps: keep this file framework-free. Composed with `cx(linkStyles(...), className)`. */
export const linkStyles = (options: { readonly hasHref: boolean }): ClassNameValue[] => [
	"font-medium text-(--text)",
	"outline-0 outline-offset-2 transition-[color,_opacity] focus-visible:outline-2 focus-visible:outline-ring forced-colors:outline-[Highlight]",
	"disabled:cursor-default disabled:text-muted-fg forced-colors:disabled:text-[GrayText]",
	options.hasHref && "cursor-pointer",
]
