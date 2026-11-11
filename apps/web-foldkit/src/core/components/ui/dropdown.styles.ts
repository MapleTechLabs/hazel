import { twJoin } from "tailwind-merge"
import { tv } from "tailwind-variants"

export const dropdownSectionStyles = tv({
	slots: {
		section: "col-span-full grid grid-cols-[auto_1fr]",
		header: "col-span-full px-3 py-2 font-medium text-muted-fg text-sm/6 sm:px-2.5 sm:py-1.5 sm:text-xs/3",
	},
})

export const dropdownItemStyles = tv({
	base: [
		"min-w-0 [--mr-icon:--spacing(2.5)] sm:[--mr-icon:--spacing(2)]",
		"col-span-full grid grid-cols-[auto_1fr_1.5rem_0.5rem_auto] px-3 py-2 supports-[grid-template-columns:subgrid]:grid-cols-subgrid sm:px-2.5 sm:py-1.5",
		"not-has-[[slot=description]]:items-center",
		"group relative cursor-default select-none rounded-[calc(var(--radius-xl)-(--spacing(1)))] outline-0",
		// text
		"text-base/6 text-fg sm:text-sm/6 forced-colors:text-[CanvasText]",
		// avatar
		"*:data-[slot=avatar]:mr-(--mr-icon) has-[[slot=description]]:*:data-[slot=avatar]:row-span-2 *:data-[slot=avatar]:[--avatar-size:--spacing(6)] sm:*:data-[slot=avatar]:[--avatar-size:--spacing(5)]",
		// icon
		"*:data-[slot=icon]:col-start-1 *:data-[slot=icon]:row-start-1 *:data-[slot=icon]:mr-(--mr-icon) *:data-[slot=icon]:-ml-0.5 *:data-[slot=icon]:shrink-0 [&_[data-slot='icon']:not([class*='text-'])]:text-fg-2",
		"not-has-[[slot=description]]:*:data-[slot=icon]:size-5 sm:not-has-[[slot=description]]:*:data-[slot=icon]:size-4",
		"has-[[slot=description]]:*:data-[slot=icon]:h-lh has-[[slot=description]]:[&_[data-slot='icon']:not([class*='w-'])]:w-5 sm:has-[[slot=description]]:[&_[data-slot='icon']:not([class*='w-'])]:w-4",
		"[&>[slot=label]+[data-slot=icon]]:absolute [&>[slot=label]+[data-slot=icon]]:right-1",
		// force color adjust
		"forced-color-adjust-none forced-colors:data-focused:bg-[Highlight] forced-colors:data-focused:text-[HighlightText] forced-colors:data-focused:*:data-[slot=icon]:text-[HighlightText]",
	],
	variants: {
		intent: {
			danger: [
				"text-danger-subtle-fg data-focused:text-danger-subtle-fg [&_[data-slot='icon']:not([class*='text-'])]:text-danger-subtle-fg/70",
				"*:[[slot=description]]:text-danger-subtle-fg/80 data-focused:*:[[slot=description]]:text-danger-subtle-fg data-focused:*:[[slot=label]]:text-danger-subtle-fg",
				"data-focused:bg-danger-subtle data-focused:text-danger-subtle-fg forced-colors:data-focused:text-[Mark] data-focused:[&_[data-slot='icon']:not([class*='text-'])]:text-danger-subtle-fg",
				"*:data-[slot=keyboard]:text-danger-subtle-fg/70 data-focused:*:data-[slot=keyboard]:text-danger-subtle-fg",
			],
			warning: [
				"text-warning-subtle-fg data-focused:text-warning-subtle-fg [&_[data-slot='icon']:not([class*='text-'])]:text-warning-subtle-fg/70",
				"*:[[slot=description]]:text-warning-subtle-fg/80 data-focused:*:[[slot=description]]:text-warning-subtle-fg data-focused:*:[[slot=label]]:text-warning-subtle-fg",
				"data-focused:bg-warning-subtle data-focused:text-warning-subtle-fg data-focused:[&_[data-slot='icon']:not([class*='text-'])]:text-warning-subtle-fg",
				"*:data-[slot=keyboard]:text-warning-subtle-fg/70 data-focused:*:data-[slot=keyboard]:text-warning-subtle-fg",
			],
		},
		isDisabled: {
			true: "opacity-50 forced-colors:text-[GrayText]",
		},
		isSelected: {
			true: [
				"[&_[data-slot='icon']:not([class*='text-'])]:text-fg",
				"has-data-[slot=avatar]:pr-6 has-data-[slot=icon]:pr-6",
			],
		},
		isFocused: {
			true: [
				"*:data-[slot=keyboard]:text-fg-2 [&_[data-slot='icon']:not([class*='text-'])]:text-fg-3",
				"bg-wash-strong text-fg forced-colors:bg-[Highlight] forced-colors:text-[HighlightText]",
				"[&_.text-muted-fg]:text-fg-2 *:[[slot=description]]:text-fg-2 *:[[slot=label]]:text-fg",
			],
		},
		isHovered: {
			true: [
				"*:data-[slot=keyboard]:text-fg-2 [&_[data-slot='icon']:not([class*='text-'])]:text-fg-3",
				"bg-wash-strong text-fg forced-colors:bg-[Highlight] forced-colors:text-[HighlightText]",
				"[&_.text-muted-fg]:text-fg-2 *:[[slot=description]]:text-fg-2 *:[[slot=label]]:text-fg",
			],
		},
	},
})

/** The check shown on a selected item (dropdown and menu items). */
export const dropdownCheckIndicatorClassName = twJoin(
	"mr-1.5 -ml-0.5 h-lh w-4 shrink-0",
	"group-has-data-[slot=icon]:absolute group-has-data-[slot=icon]:top-1/2 group-has-data-[slot=icon]:right-0.5 group-has-data-[slot=icon]:-translate-y-1/2",
	"group-has-data-[slot=avatar]:absolute group-has-data-[slot=avatar]:top-1/2 group-has-data-[slot=avatar]:right-0.5 group-has-data-[slot=avatar]:-translate-y-1/2",
)

/** Base classes, each merged with the caller's `className` by `twMerge`. */
export const dropdownLabelBase = "col-start-2"
export const dropdownDescriptionBase = "col-start-2 font-normal text-muted-fg text-sm"
export const dropdownSeparatorBase = "col-span-full -mx-1 my-1 h-px bg-border"
export const dropdownKeyboardBase =
	"absolute right-2 pl-2 group-hover:text-primary-fg group-data-focused:text-primary-fg"
