import { getLocalTimeZone, today } from "@internationalized/date"
import type { DateValue, RangeCalendarProps } from "react-aria-components"
import {
	CalendarCell,
	CalendarGrid,
	CalendarGridBody,
	RangeCalendar as RangeCalendarPrimitive,
} from "react-aria-components"
import { CalendarGridHeader, CalendarHeader } from "./calendar"
import {
	rangeCalendarCellClassName,
	rangeCalendarCellInnerClassName,
	rangeCalendarGridClassName,
	rangeCalendarGridsClassName,
} from "./calendar.styles"

export function RangeCalendar<T extends DateValue>({
	className,
	visibleDuration = { months: 1 },
	...props
}: RangeCalendarProps<T>) {
	const now = today(getLocalTimeZone())
	return (
		<RangeCalendarPrimitive data-slot="calendar" visibleDuration={visibleDuration} {...props}>
			<CalendarHeader isRange />
			<div className={rangeCalendarGridsClassName}>
				{Array.from({ length: visibleDuration?.months ?? 1 }).map((_, index) => {
					const id = index + 1
					return (
						<CalendarGrid
							key={index}
							offset={id >= 2 ? { months: id - 1 } : undefined}
							className={rangeCalendarGridClassName}
						>
							<CalendarGridHeader />
							<CalendarGridBody className="snap-start">
								{(date) => (
									<CalendarCell
										date={date}
										className={rangeCalendarCellClassName(date.compare(now) === 0)}
									>
										{({
											formattedDate,
											isSelected,
											isSelectionStart,
											isSelectionEnd,
											isDisabled,
										}) => (
											<span
												className={rangeCalendarCellInnerClassName({
													isSelected,
													isSelectionEdge: isSelectionStart || isSelectionEnd,
													isDisabled,
												})}
											>
												{formattedDate}
											</span>
										)}
									</CalendarCell>
								)}
							</CalendarGridBody>
						</CalendarGrid>
					)
				})}
			</div>
		</RangeCalendarPrimitive>
	)
}
