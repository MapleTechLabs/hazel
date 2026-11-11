import { twJoin } from "tailwind-merge"

export const modalSizes = {
	"2xs": "sm:max-w-2xs",
	xs: "sm:max-w-xs",
	sm: "sm:max-w-sm",
	md: "sm:max-w-md",
	lg: "sm:max-w-lg",
	xl: "sm:max-w-xl",
	"2xl": "sm:max-w-2xl",
	"3xl": "sm:max-w-3xl",
	"4xl": "sm:max-w-4xl",
	"5xl": "sm:max-w-5xl",
	fullscreen: "",
}

export type ModalSize = keyof typeof modalSizes

/**
 * Overlay motion: panels and backdrops fade (and scale or slide) in from `@starting-style` when they
 * render, in 200ms. `prefers-reduced-motion` collapses every transition in `styles.css`.
 */
export const modalBackdropClassName =
	"fixed inset-0 bg-overlay-backdrop transition-opacity duration-200 ease-out starting:opacity-0"

/** Centers the panel (bottom-anchored on small screens); clicks outside the panel reach the backdrop. */
export const modalLayoutClassName = (size: ModalSize) =>
	twJoin(
		"pointer-events-none fixed inset-0 grid h-dvh grid-rows-[1fr_auto] justify-items-center sm:grid-rows-[1fr_auto_3fr]",
		size === "fullscreen" ? "md:p-3" : "md:p-4",
	)

/** The `twMerge` arguments of the modal panel, before the caller's `className`. */
export const modalContentBase = (size: ModalSize) =>
	[
		"pointer-events-auto row-start-2 flex w-full flex-col text-left align-middle",
		"[--visual-viewport-vertical-padding:16px]",
		size === "fullscreen"
			? "sm:rounded-md sm:[--visual-viewport-vertical-padding:16px]"
			: "sm:rounded-xl sm:[--visual-viewport-vertical-padding:32px]",
		"max-h-[calc(100dvh-var(--visual-viewport-vertical-padding))]",
		"relative overflow-hidden bg-overlay text-overlay-fg",
		"rounded-t-2xl shadow-lg ring ring-fg/5 dark:ring-border",
		modalSizes[size],
		"origin-center transition-[opacity,translate,scale] duration-200 ease-out",
		"starting:translate-y-4 starting:opacity-0 sm:starting:translate-y-0 sm:starting:scale-95",
	] as const
