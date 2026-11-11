import { twMerge } from "tailwind-merge"

const todayDot =
	"after:pointer-events-none after:absolute after:start-1/2 after:bottom-1 after:z-10 after:size-0.75 after:-translate-x-1/2 after:rounded-full after:bg-primary"

/** Calendar's CalendarCell className. */
export const calendarCellClassName = (
	state: { readonly isSelected: boolean; readonly isDisabled: boolean; readonly isToday: boolean },
	className?: string,
) =>
	twMerge(
		"relative flex size-11 cursor-default items-center justify-center rounded-lg text-fg tabular-nums outline-hidden hover:bg-secondary-fg/15 sm:size-9 sm:text-sm/6 forced-colors:text-[ButtonText] forced-colors:outline-0",
		state.isSelected &&
			"bg-primary data-pressed:bg-primary text-primary-fg hover:bg-primary/90 data-invalid:bg-danger data-invalid:text-danger-fg forced-colors:bg-[Highlight] forced-colors:text-[Highlight] forced-colors:data-invalid:bg-[Mark]",
		state.isDisabled && "text-muted-fg forced-colors:text-[GrayText]",
		state.isToday && `${todayDot} data-selected:after:bg-primary-fg focus-visible:after:bg-primary-fg`,
		className,
	)

export const calendarHeaderClassName = (className?: string) =>
	twMerge("flex w-full justify-between gap-1.5 pt-1 pr-1 pb-5 pl-1.5 sm:pb-4", className)

export const calendarNavButtonClassName = "size-8 **:data-[slot=icon]:text-fg sm:size-7"

export const calendarMonthSelectTriggerClassName =
	"w-22 text-sm/5 **:data-[slot=select-value]:inline-block **:data-[slot=select-value]:truncate sm:px-2.5 sm:py-1.5 sm:*:text-sm/5"

export const calendarYearSelectTriggerClassName = "text-sm/5 sm:px-2.5 sm:py-1.5 sm:*:text-sm/5"

export const calendarHeaderCellClassName =
	"pb-2 text-center font-semibold text-muted-fg text-sm/6 sm:px-0 sm:py-0.5 lg:text-xs"
