import type { ClassNameValue } from "tailwind-merge"

export const switchStyles = [
	"[--switch-bg-ring:var(--color-blue-700)]/90 [--switch-bg:var(--color-blue-600)] dark:[--switch-bg-ring:transparent]",
	"[--switch-ring:var(--color-blue-700)]/90 [--switch-shadow:var(--color-blue-900)]/20 [--switch:white]",
	"group relative grid cursor-default grid-cols-[1fr_auto] gap-x-6 gap-y-1 data-disabled:opacity-50 *:data-[slot=indicator]:col-start-2 *:data-[slot=label]:col-start-1 *:data-[slot=label]:row-start-1 *:data-[slot=indicator]:self-start has-[[slot=description]]:**:data-[slot=label]:font-medium sm:*:data-[slot=indicator]:mt-0.5 *:[[slot=description]]:col-start-1 *:[[slot=description]]:row-start-2",
]

export interface SwitchState {
	readonly isSelected: boolean
	readonly isDisabled: boolean
}

/** The track: `twMerge(...switchIndicatorStyles(state))`. Hover and focus rings follow the label (`group`). */
export const switchIndicatorStyles = (values: SwitchState): ClassNameValue[] => [
	"relative isolate inline-flex h-6 w-10 cursor-default rounded-full p-[3px] sm:h-5 sm:w-8",
	"transition duration-200 ease-in-out",
	"inset-ring inset-ring-input bg-input/30",
	"forced-colors:outline forced-colors:[--switch-bg:Highlight]",
	"group-has-focus-visible:ring-2 group-has-focus-visible:ring-ring/20",
	!values.isSelected &&
		!values.isDisabled &&
		"group-hover:inset-ring-muted-fg/30 group-has-focus-visible:inset-ring-ring/70 group-has-focus-visible:bg-ring/20",
	values.isSelected &&
		"inset-ring-(--switch-shadow) bg-(--switch-bg) dark:inset-ring-(--switch-bg-ring) dark:bg-(--switch-bg)",
	values.isDisabled &&
		"dark:group-data-disabled:bg-muted-fg/30 dark:group-data-disabled:group-data-selected:inset-ring-muted-fg/30 dark:group-data-disabled:group-data-selected:bg-(--switch-bg)",
]

/** The thumb: `twJoin(...switchThumbStyles(state))`. */
export const switchThumbStyles = (values: Pick<SwitchState, "isSelected">): ClassNameValue[] => [
	"pointer-events-none relative inline-block size-4.5 translate-x-0 rounded-full border border-transparent bg-white shadow-sm ring ring-fg/5 transition duration-200 ease-in-out sm:size-3.5",
	values.isSelected &&
		"translate-x-4 bg-(--switch) shadow-(--switch-shadow) ring-(--switch-ring) group-data-disabled:shadow-sm group-data-disabled:ring-secondary-fg/5 sm:translate-x-3",
]
