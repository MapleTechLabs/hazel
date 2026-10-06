import { twMerge } from "tailwind-merge"

/** Port of `components/ui/link.tsx` class composition (React Aria Link + `cx`). */
export const linkClassName = (options: { readonly hasHref: boolean; readonly className?: string }) =>
	twMerge(
		twMerge(
			"font-medium text-(--text)",
			"outline-0 outline-offset-2 transition-[color,_opacity] focus-visible:outline-2 focus-visible:outline-ring forced-colors:outline-[Highlight]",
			"disabled:cursor-default disabled:text-muted-fg forced-colors:disabled:text-[GrayText]",
			options.hasHref && "cursor-pointer",
		),
		options.className,
	)
