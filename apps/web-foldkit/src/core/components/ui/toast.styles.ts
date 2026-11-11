import { tv } from "tailwind-variants"

/**
 * The `@foldkit/ui` Toast stack. The kit pins the container bottom-right with inline styles; the
 * entry `<div>` carries the kit's Animation attributes (`data-closed`, `data-enter`, `data-leave`)
 * and, while swiped, `data-swipe` with an inline `translate`.
 */
export const toastEntryClassName = [
	"w-[356px] max-w-[calc(100vw-2rem)]",
	"transition-[opacity,translate] duration-200 ease-out data-leave:duration-150 data-leave:ease-in",
	"data-closed:translate-y-2 data-closed:opacity-0",
	"data-[swipe=settling]:duration-150 data-[swipe=end]:duration-200",
].join(" ")

/** The card inside an entry: the overlay surface, tinted per kind like sonner's `richColors`. */
export const toastStyles = tv({
	slots: {
		card: [
			"relative flex w-full items-start gap-2.5 rounded-xl border p-4 pr-9 text-sm shadow-lg",
			"bg-(--toast-bg) text-(--toast-fg) border-(--toast-border)",
		],
		icon: "mt-0.5 size-4 shrink-0",
		content: "flex min-w-0 flex-1 flex-col gap-0.5",
		title: "font-medium",
		description: "opacity-90",
		action: [
			"shrink-0 self-center rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-fg",
			"outline-hidden transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring",
		],
		close: [
			"absolute top-2 right-2 rounded-md p-1 opacity-60 outline-hidden transition-opacity",
			"hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring",
		],
	},
	variants: {
		kind: {
			info: {
				card: "[--toast-bg:var(--color-info-subtle)] [--toast-border:color-mix(in_oklab,var(--color-info-subtle-fg)_20%,transparent)] [--toast-fg:var(--color-info-subtle-fg)]",
			},
			success: {
				card: "[--toast-bg:var(--color-success-subtle)] [--toast-border:color-mix(in_oklab,var(--color-success-subtle-fg)_20%,transparent)] [--toast-fg:var(--color-success-subtle-fg)]",
			},
			warning: {
				card: "[--toast-bg:var(--color-warning-subtle)] [--toast-border:color-mix(in_oklab,var(--color-warning-subtle-fg)_20%,transparent)] [--toast-fg:var(--color-warning-subtle-fg)]",
			},
			error: {
				card: "[--toast-bg:var(--color-danger-subtle)] [--toast-border:color-mix(in_oklab,var(--color-danger-subtle-fg)_20%,transparent)] [--toast-fg:var(--color-danger-subtle-fg)]",
			},
			loading: {
				card: "[--toast-bg:var(--color-overlay)] [--toast-border:var(--color-border)] [--toast-fg:var(--color-overlay-fg)]",
				icon: "animate-spin",
			},
		},
	},
})
