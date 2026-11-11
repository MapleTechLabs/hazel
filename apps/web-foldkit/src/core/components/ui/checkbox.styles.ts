import type { ClassNameValue } from "tailwind-merge"

export const checkboxStyles =
	"group block [--indicator-mt:--spacing(0.75)] data-disabled:opacity-50 sm:[--indicator-mt:--spacing(1)]"

/** The grid inside the checkbox label: `twMerge(...checkboxLayoutStyles)`. */
export const checkboxLayoutStyles = [
	"grid grid-cols-[1.125rem_1fr] gap-y-1 has-data-[slot=label]:gap-x-3 sm:grid-cols-[1rem_1fr]",
	"*:data-[slot=indicator]:col-start-1 *:data-[slot=indicator]:row-start-1 *:data-[slot=indicator]:mt-(--indicator-mt)",
	"*:data-[slot=label]:col-start-2 *:data-[slot=label]:row-start-1",
	"*:[[slot=description]]:col-start-2 *:[[slot=description]]:row-start-2",
	"has-[[slot=description]]:**:data-[slot=label]:font-medium",
]

export interface CheckboxIndicatorState {
	readonly isSelected: boolean
	readonly isIndeterminate: boolean
	readonly isInvalid: boolean
}

/** The box: `twMerge(checkboxIndicatorStyles(state))`. Hover and focus rings follow the label (`group`). */
export const checkboxIndicatorStyles = ({
	isSelected,
	isIndeterminate,
	isInvalid,
}: CheckboxIndicatorState): ClassNameValue[] => [
	"relative inset-ring inset-ring-input isolate flex shrink-0 items-center justify-center rounded text-bg transition group-hover:inset-ring-muted-fg/30",
	"sm:size-4 sm:*:data-[slot=check-indicator]:size-3.5",
	"size-4.5 *:data-[slot=check-indicator]:size-4",
	"in-data-disabled:bg-muted",
	(isSelected || isIndeterminate) && [
		"inset-ring-(--checkbox-ring,var(--color-ring)) bg-(--checkbox-bg,var(--color-primary)) text-(--checkbox-fg,var(--color-primary-fg))",
		"group-data-invalid:inset-ring/70 group-data-invalid:bg-danger group-data-invalid:text-danger-fg dark:group-data-invalid:inset-ring-danger-subtle-fg/70",
	],
	"group-has-focus-visible:inset-ring-(--checkbox-ring,var(--color-ring)) group-has-focus-visible:ring-(--checkbox-ring,var(--color-ring))/20 group-has-focus-visible:ring-3",
	"group-has-focus-visible:group-data-invalid:inset-ring-danger-subtle-fg/70 group-has-focus-visible:group-data-invalid:text-danger-fg group-has-focus-visible:group-data-invalid:ring-danger-subtle-fg/20",
	isInvalid &&
		"inset-ring-danger-subtle-fg/70 bg-danger-subtle/5 text-danger-fg ring-danger-subtle-fg/20 group-hover:inset-ring-danger-subtle-fg/70",
]
