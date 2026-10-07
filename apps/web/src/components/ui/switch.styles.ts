import type { ClassNameValue } from "tailwind-merge"

/** Shared by the React and Foldkit apps: keep this file framework-free. */
export const switchStyles = [
	"[--switch-bg-ring:var(--color-blue-700)]/90 [--switch-bg:var(--color-blue-600)] dark:[--switch-bg-ring:transparent]",
	"[--switch-ring:var(--color-blue-700)]/90 [--switch-shadow:var(--color-blue-900)]/20 [--switch:white]",
	"group relative grid cursor-default grid-cols-[1fr_auto] gap-x-6 gap-y-1 disabled:opacity-50 *:data-[slot=indicator]:col-start-2 *:data-[slot=label]:col-start-1 *:data-[slot=label]:row-start-1 *:data-[slot=indicator]:self-start has-[[slot=description]]:**:data-[slot=label]:font-medium sm:*:data-[slot=indicator]:mt-0.5 *:[[slot=description]]:col-start-1 *:[[slot=description]]:row-start-2",
]

export interface SwitchState {
	readonly isHovered: boolean
	readonly isFocusVisible: boolean
	readonly isSelected: boolean
	readonly isDisabled: boolean
}

/** The track: `twMerge(...switchIndicatorStyles(state))`. */
export const switchIndicatorStyles = (values: SwitchState): ClassNameValue[] => [
	"relative isolate inline-flex h-6 w-10 cursor-default rounded-full p-[3px] sm:h-5 sm:w-8",
	"transition duration-200 ease-in-out",
	"inset-ring inset-ring-input bg-input/30",
	"forced-colors:outline forced-colors:[--switch-bg:Highlight]",
	values.isHovered && "inset-ring-muted-fg/30",
	values.isFocusVisible &&
		"inset-ring-ring/70 selected:inset-ring-ring/30 bg-ring/20 ring-2 ring-ring/20 dark:inset-ring-ring/70",
	values.isSelected &&
		"inset-ring-(--switch-shadow) bg-(--switch-bg) dark:inset-ring-(--switch-bg-ring) dark:bg-(--switch-bg)",
	values.isDisabled &&
		"dark:group-disabled:bg-muted-fg/30 dark:group-disabled:group-selected:inset-ring-muted-fg/30 dark:group-disabled:group-selected:bg-(--switch-bg)",
]

/** The thumb: `twJoin(...switchThumbStyles(state))`. */
export const switchThumbStyles = (values: Pick<SwitchState, "isSelected">): ClassNameValue[] => [
	"pointer-events-none relative inline-block size-4.5 translate-x-0 rounded-full border border-transparent bg-white shadow-sm ring ring-fg/5 transition duration-200 ease-in-out sm:size-3.5",
	values.isSelected &&
		"translate-x-4 bg-(--switch) shadow-(--switch-shadow) ring-(--switch-ring) group-disabled:shadow-sm group-disabled:ring-secondary-fg/5 sm:translate-x-3",
]
