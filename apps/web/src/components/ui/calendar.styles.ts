import { twMerge } from "tailwind-merge"

/** Shared by the React and Foldkit apps: keep this file framework-free. */

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
			"bg-primary pressed:bg-primary text-primary-fg hover:bg-primary/90 data-invalid:bg-danger data-invalid:text-danger-fg forced-colors:bg-[Highlight] forced-colors:text-[Highlight] forced-colors:data-invalid:bg-[Mark]",
		state.isDisabled && "text-muted-fg forced-colors:text-[GrayText]",
		state.isToday && `${todayDot} selected:after:bg-primary-fg focus-visible:after:bg-primary-fg`,
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

export const rangeCalendarGridsClassName =
	"flex snap-x items-start justify-stretch gap-6 overflow-auto sm:gap-10"

export const rangeCalendarGridClassName = "[&_td]:border-collapse [&_td]:px-0 [&_td]:py-0.5"

/** RangeCalendar's CalendarCell className. */
export const rangeCalendarCellClassName = (isToday: boolean) =>
	twMerge([
		"shrink-0 [--cell-fg:var(--color-primary-subtle-fg)] [--cell:var(--color-primary-subtle)]",
		"group/calendar-cell relative size-11 cursor-default outside-month:text-muted-fg leading-[2.286rem] outline-hidden selection-start:rounded-s-lg selection-end:rounded-e-lg sm:size-9 sm:text-sm",
		"selected:bg-(--cell) selected:text-(--cell-fg)",
		"selected:after:bg-primary-fg focus-visible:after:bg-primary-fg",
		"invalid:selected:bg-danger-subtle",
		"[td:first-child_&]:rounded-s-lg [td:last-child_&]:rounded-e-lg",
		"forced-colors:selected:bg-[Highlight] forced-colors:selected:text-[HighlightText] forced-colors:invalid:selected:bg-[Mark]",
		isToday && `${todayDot} selected:after:bg-primary-fg`,
	])

/** The `<span>` inside a RangeCalendar cell. */
export const rangeCalendarCellInnerClassName = (state: {
	readonly isSelected: boolean
	readonly isSelectionEdge: boolean
	readonly isDisabled: boolean
}) =>
	twMerge(
		"flex size-full items-center justify-center rounded-lg tabular-nums forced-color-adjust-none",
		state.isSelected && state.isSelectionEdge
			? "bg-primary text-primary-fg group-invalid/calendar-cell:bg-danger group-invalid/calendar-cell:text-danger-fg forced-colors:bg-[Highlight] forced-colors:text-[HighlightText] forced-colors:group-invalid/calendar-cell:bg-[Mark]"
			: state.isSelected
				? [
						// hover
						"group-hover/calendar-cell:bg-primary/15",
						// pressed
						"group-pressed/calendar-cell:bg-(--cell)",
						// invalid
						"group-invalid/calendar-cell:text-danger-subtle-fg group-invalid/calendar-cell:group-hover/calendar-cell:bg-danger/15 group-invalid/calendar-cell:group-pressed/calendar-cell:bg-danger/30",
						// forced-colors
						"forced-colors:text-[HighlightText] forced-colors:group-pressed/calendar-cell:bg-[Highlight] forced-colors:group-hover/calendar-cell:bg-[Highlight] forced-colors:group-invalid/calendar-cell:group-pressed/calendar-cell:bg-[Mark] forced-colors:group-invalid:group-hover/calendar-cell:bg-[Mark]",
					]
				: "group-hover/calendar-cell:bg-secondary-fg/15 group-pressed/calendar-cell:bg-secondary-fg/20 forced-colors:group-pressed/calendar-cell:bg-[Highlight]",
		state.isDisabled && "opacity-50 forced-colors:text-[GrayText]",
	)
