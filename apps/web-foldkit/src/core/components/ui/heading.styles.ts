import { tv } from "tailwind-variants"

/**
 * The heading scale. Every heading in the app is one of these four; a new style is a new variant
 * here, not a class string at the call site (`hazel-ui/no-raw-heading`).
 *
 * - `display`: a page's title (settings pages, onboarding steps, empty pages)
 * - `title`: a panel's or a modal page's title
 * - `section`: a section inside a page (a card, a settings group)
 * - `subsection`: a group inside a section, a list's header
 * - `label`: a quiet uppercase eyebrow over a group of rows
 *
 * Balancing sets only `text-wrap-style`: `text-balance` is the `text-wrap` shorthand, which also
 * resets `text-wrap-mode` to `wrap` and so beats a call site's `truncate` (`white-space: nowrap`).
 */
export const headingStyles = tv({
	base: "[text-wrap-style:balance] text-fg",
	variants: {
		variant: {
			display: "font-semibold text-2xl/8 tracking-[-0.02em]",
			title: "font-semibold text-lg/7 tracking-[-0.014em]",
			section: "font-semibold text-base/6 tracking-[-0.011em]",
			subsection: "font-semibold text-sm/5",
			label: "font-medium text-fg-2 text-xs uppercase tracking-wider",
		},
	},
	defaultVariants: { variant: "section" },
})
