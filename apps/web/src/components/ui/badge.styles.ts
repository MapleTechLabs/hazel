import { tv } from "tailwind-variants"

/** Shared by the React and Foldkit apps: keep this file framework-free. */
export const badgeStyles = tv({
	base: [
		"inline-flex items-center font-medium forced-colors:outline",
		"inset-ring inset-ring-(--badge-ring) bg-(--badge-bg) text-(--badge-fg) [--badge-ring:transparent]",
		"group-hover:bg-(--badge-overlay) group-focus:bg-(--badge-overlay)",
		"*:data-[slot=icon]:shrink-0",
		"duration-200",
		// Tabular numbers for consistent width when displaying counts
		"tabular-nums",
	],
	variants: {
		intent: {
			primary:
				"[--badge-bg:var(--color-primary-subtle)] [--badge-fg:var(--color-primary-subtle-fg)] [--badge-overlay:var(--color-primary)]/20",
			secondary:
				"[--badge-bg:var(--color-secondary)] [--badge-fg:var(--color-secondary-fg)] [--badge-overlay:var(--color-muted-fg)]/25",
			success:
				"[--badge-bg:var(--color-success-subtle)] [--badge-fg:var(--color-success-subtle-fg)] [--badge-overlay:var(--color-success)]/20",
			info: "[--badge-bg:var(--color-info-subtle)] [--badge-fg:var(--color-info-subtle-fg)] [--badge-overlay:var(--color-sky-500)]/20",
			warning:
				"[--badge-bg:var(--color-warning-subtle)] [--badge-fg:var(--color-warning-subtle-fg)] [--badge-overlay:var(--color-warning)]/20",
			danger: "[--badge-bg:var(--color-danger-subtle)] [--badge-fg:var(--color-danger-subtle-fg)] [--badge-overlay:var(--color-danger)]/20",
			outline: "[--badge-overlay:var(--color-secondary)]/20 [--badge-ring:var(--color-border)]",
		},
		size: {
			sm: "gap-x-1 py-px text-[10px]/4 *:data-[slot=icon]:size-2.5",
			md: "gap-x-1.5 py-0.5 text-xs/5 *:data-[slot=icon]:size-3",
		},
		isPill: {
			true: "rounded-lg",
			false: "rounded-sm",
		},
	},
	compoundVariants: [
		{ size: "sm", isPill: true, className: "px-1.5" },
		{ size: "sm", isPill: false, className: "px-1" },
		{ size: "md", isPill: true, className: "px-2" },
		{ size: "md", isPill: false, className: "px-1.5" },
	],
	defaultVariants: {
		intent: "primary",
		size: "md",
		isPill: false,
	},
})
