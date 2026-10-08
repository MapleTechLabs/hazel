import { twJoin } from "tailwind-merge"

/** Shared by the React and Foldkit apps: keep this file framework-free. */

/** sonner `toastOptions.className`, applied to every toast `<li>`. */
export const toastClassName = twJoin(
	"not-has-data-[slot=note]:backdrop-blur-3xl *:data-icon:mt-0.5 *:data-icon:self-start has-data-description:*:data-icon:mt-1",
	"**:data-action:[--normal-bg:var(--color-primary-fg)] **:data-action:[--normal-text:var(--color-primary)]",
)

/** sonner `Toaster` className, on the `<ol data-sonner-toaster>`. */
export const toasterClassName = "toaster group"

/** sonner `Toaster` style: the theme's colors for every toast kind, in this key order. */
export const toasterStyle = {
	"--normal-bg": "var(--color-overlay)",
	"--normal-text": "var(--color-overlay-fg)",
	"--normal-border": "var(--color-border)",

	"--success-bg": "var(--color-success-subtle)",
	"--success-border": "color-mix(in oklab, var(--success-subtle-fg) 20%, transparent)",
	"--success-text": "var(--color-success-subtle-fg)",

	"--error-bg": "var(--color-danger-subtle)",
	"--error-border": "color-mix(in oklab, var(--danger-subtle-fg) 20%, transparent)",
	"--error-text": "var(--color-danger-subtle-fg)",

	"--warning-bg": "var(--color-warning-subtle)",
	"--warning-border": "color-mix(in oklab, var(--warning-subtle-fg) 20%, transparent)",
	"--warning-text": "var(--color-warning-subtle-fg)",

	"--info-bg": "var(--color-info-subtle)",
	"--info-border": "color-mix(in oklab, var(--info-subtle-fg) 20%, transparent)",
	"--info-text": "var(--color-info-subtle-fg)",
} as const
