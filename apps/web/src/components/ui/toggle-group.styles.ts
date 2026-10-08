import { tv } from "tailwind-variants"

/** Shared by the React and Foldkit apps: keep this file framework-free. */
export const toggleGroupStyles = ({
	orientation,
	selectionMode,
	isCircle,
}: {
	orientation?: "horizontal" | "vertical"
	selectionMode?: "single" | "multiple"
	isCircle?: boolean
}) => [
	"[--toggle-group-radius:var(--radius-lg)] [--toggle-gutter:--spacing(0.5)]",
	"[--toggle-fg:var(--color-fg)] [--toggle-selected-bg:var(--color-primary)] [--toggle-selected-fg:var(--color-primary-fg)]",
	"[--toggle-focused-bg:var(--color-secondary)] [--toggle-focused-fg:var(--color-secondary-fg)]",
	"[--toggle-hover-bg:var(--toggle-focused-bg)] [--toggle-hover-fg:var(--toggle-focused-fg)]",
	"[--toggle-icon:color-mix(in_oklab,var(--toggle-focused-fg)_50%,var(--toggle-focused-bg))]",
	"inset-ring inset-ring-border inline-flex overflow-hidden p-(--toggle-gutter)",
	orientation === "horizontal" ? "flex-row" : "flex-col",
	selectionMode === "single" ? "gap-(--toggle-gutter)" : "gap-0",
	isCircle ? "rounded-full" : "rounded-(--toggle-group-radius)",
	selectionMode === "single" && isCircle && "*:data-[slot=toggle-group-item]:rounded-full",
	selectionMode === "multiple" &&
		isCircle &&
		"*:data-[slot=toggle-group-item]:last:rounded-r-full *:data-[slot=toggle-group-item]:first:rounded-l-full",
]

export const toggleGroupItemStyles = tv({
	base: [
		"relative isolate",
		"inline-flex flex-row items-center font-medium text-(--toggle-fg) outline-hidden",
		"inset-ring inset-ring-transparent",
		"*:data-[slot=icon]:-mx-0.5 *:data-[slot=icon]:shrink-0 *:data-[slot=icon]:self-center *:data-[slot=icon]:text-(--btn-icon) focus-visible:*:data-[slot=icon]:text-(--btn-icon-active)/80 hover:*:data-[slot=icon]:text-(--btn-icon-active)/90",
		"forced-colors:[--btn-icon:ButtonText] forced-colors:hover:[--btn-icon:ButtonText]",
	],
	variants: {
		orientation: {
			horizontal: "justify-center",
			vertical: "justify-start",
		},
		selectionMode: {
			single: "rounded-[calc(var(--toggle-group-radius)-var(--toggle-gutter))]",
			multiple: "rounded-none",
		},
		size: {
			xs: [
				"min-h-8 gap-x-1.5 px-2.5 py-1.5 text-sm sm:min-h-7 sm:px-2 sm:py-1.5 sm:text-xs/4",
				"*:data-[slot=icon]:-mx-px *:data-[slot=icon]:size-3.5 sm:*:data-[slot=icon]:size-3",
				"*:data-[slot=loader]:-mx-px *:data-[slot=loader]:size-3.5 sm:*:data-[slot=loader]:size-3",
			],
			sm: [
				"min-h-9 gap-x-1.5 px-3 py-1.5 sm:min-h-8 sm:px-2.5 sm:py-1.5 sm:text-sm/5",
				"*:data-[slot=icon]:size-4.5 sm:*:data-[slot=icon]:size-4",
				"*:data-[slot=loader]:size-4.5 sm:*:data-[slot=loader]:size-4",
			],
			md: [
				"min-h-10 gap-x-2 px-3.5 py-2 sm:min-h-9 sm:px-3 sm:py-1.5 sm:text-sm/6",
				"*:data-[slot=icon]:size-5 sm:*:data-[slot=icon]:size-4",
				"*:data-[slot=loader]:size-5 sm:*:data-[slot=loader]:size-4",
			],
			lg: [
				"min-h-11 gap-x-2 px-4 py-2.5 sm:min-h-10 sm:px-3.5 sm:py-2 sm:text-sm/6",
				"*:data-[slot=icon]:size-5 sm:*:data-[slot=icon]:size-4.5",
				"*:data-[slot=loader]:size-5 sm:*:data-[slot=loader]:size-4.5",
			],
			"sq-xs":
				"touch-target size-8 *:data-[slot=icon]:size-3.5 *:data-[slot=loader]:size-3.5 sm:size-7 sm:*:data-[slot=icon]:size-3 sm:*:data-[slot=loader]:size-3",
			"sq-sm":
				"touch-target size-9 *:data-[slot=icon]:size-4.5 *:data-[slot=loader]:size-4.5 sm:size-8 sm:*:data-[slot=icon]:size-4 sm:*:data-[slot=loader]:size-4",
			"sq-md":
				"touch-target size-10 *:data-[slot=icon]:size-5 *:data-[slot=loader]:size-5 sm:size-9 sm:*:data-[slot=icon]:size-4.5 sm:*:data-[slot=loader]:size-4.5",
			"sq-lg":
				"touch-target size-11 *:data-[slot=icon]:size-5 *:data-[slot=loader]:size-5 sm:size-10 sm:*:data-[slot=icon]:size-5 sm:*:data-[slot=loader]:size-5",
		},
		isSelected: {
			true: "inset-ring-fg/20 bg-(--toggle-selected-bg) text-(--toggle-selected-fg) [--toggle-icon:var(--primary-fg)] hover:bg-(--toggle-selected-bg)/90",
		},
		isFocused: {
			true: "not-selected:bg-(--toggle-focused-bg) not-selected:text-(--toggle-focused-fg) not-selected:[--toggle-icon:var(--toggle-focused-fg)]",
		},
		isHovered: {
			true: "enabled:not-selected:bg-(--toggle-hover-bg) enabled:not-selected:text-(--toggle-hover-fg) enabled:not-selected:[--toggle-icon:var(--toggle-hover-fg)]",
		},
		isDisabled: {
			true: "opacity-50 forced-colors:text-[GrayText]",
		},
	},
	defaultVariants: {
		size: "md",
	},
	compoundVariants: [
		{
			selectionMode: "multiple",
			orientation: "horizontal",
			className:
				"not-first:-ml-px first:rounded-l-[calc(var(--toggle-group-radius)-var(--toggle-gutter))] last:rounded-r-[calc(var(--toggle-group-radius)-var(--toggle-gutter))]",
		},
		{
			selectionMode: "multiple",
			orientation: "vertical",
			className:
				"not-first:-mt-px first:rounded-t-[calc(var(--toggle-group-radius)-var(--toggle-gutter))] last:rounded-b-[calc(var(--toggle-group-radius)-var(--toggle-gutter))]",
		},
	],
})
