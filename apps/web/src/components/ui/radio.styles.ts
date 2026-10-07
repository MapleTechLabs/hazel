import type { ClassNameValue } from "tailwind-merge"

/** Shared by the React and Foldkit apps: keep this file framework-free. */
export const radioGroupStyles = [
	"space-y-3 **:data-[slot=label]:font-normal",
	"has-[slot=description]:space-y-6 has-[slot=description]:**:data-[slot=label]:font-medium",
]

export const radioStyles = "group block disabled:opacity-50"

/** The grid inside the radio label: `twMerge(...radioLayoutStyles)`. */
export const radioLayoutStyles = [
	"grid grid-cols-[1.125rem_1fr] gap-x-3 gap-y-1 sm:grid-cols-[1rem_1fr]",
	"*:data-[slot=indicator]:col-start-1 *:data-[slot=indicator]:row-start-1 *:data-[slot=indicator]:mt-0.75 sm:*:data-[slot=indicator]:mt-1",
	"*:data-[slot=label]:col-start-2 *:data-[slot=label]:row-start-1",
	"*:[[slot=description]]:col-start-2 *:[[slot=description]]:row-start-2",
	"has-[[slot=description]]:**:data-[slot=label]:font-medium",
]

export interface RadioIndicatorState {
	readonly isSelected: boolean
	readonly isFocusVisible: boolean
	readonly isInvalid: boolean
}

/** The dot: `twMerge(radioIndicatorStyles(state))`. */
export const radioIndicatorStyles = ({
	isSelected,
	isFocusVisible,
	isInvalid,
}: RadioIndicatorState): ClassNameValue[] => [
	"relative inset-ring inset-ring-input isolate flex size-4.5 shrink-0 items-center justify-center rounded-full text-bg transition before:absolute before:inset-auto before:size-2 before:shrink-0 before:rounded-full before:content-[''] hover:before:bg-muted-fg/20 sm:size-4 sm:before:size-1.7",
	isSelected && [
		"inset-ring-primary bg-primary text-primary-fg before:bg-bg hover:before:bg-muted/90",
		"group-invalid:inset-ring-danger-subtle-fg/70 group-invalid:bg-danger group-invalid:text-danger-fg",
	],
	isFocusVisible && [
		"inset-ring-primary ring-3 ring-ring/20",
		"group-invalid:inset-ring-danger-subtle-fg/70 group-invalid:text-danger-fg group-invalid:ring-danger-subtle-fg/20",
	],
	isInvalid && "inset-ring-danger-subtle-fg/70 bg-danger-subtle/5 text-danger-fg ring-danger-subtle-fg/20",
]
