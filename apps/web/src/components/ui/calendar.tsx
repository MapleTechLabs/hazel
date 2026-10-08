"use client"

import { ChevronLeftIcon, ChevronRightIcon } from "@heroicons/react/24/solid"
import { type CalendarDate, getLocalTimeZone, today } from "@internationalized/date"
import { useDateFormatter } from "@react-aria/i18n"
import { use } from "react"
import {
	CalendarCell,
	CalendarGrid,
	CalendarGridBody,
	CalendarGridHeader as CalendarGridHeaderPrimitive,
	CalendarHeaderCell,
	Calendar as CalendarPrimitive,
	type CalendarProps as CalendarPrimitiveProps,
	CalendarStateContext,
	composeRenderProps,
	type DateValue,
	Heading,
	RangeCalendarStateContext,
	useLocale,
} from "react-aria-components"
import { Button } from "./button"
import {
	calendarCellClassName,
	calendarHeaderCellClassName,
	calendarHeaderClassName,
	calendarMonthSelectTriggerClassName,
	calendarNavButtonClassName,
	calendarYearSelectTriggerClassName,
} from "./calendar.styles"
import { Select, SelectContent, SelectItem, SelectLabel, SelectTrigger } from "./select"

interface CalendarProps<T extends DateValue> extends Omit<CalendarPrimitiveProps<T>, "visibleDuration"> {
	className?: string
}

const Calendar = <T extends DateValue>({ className, ...props }: CalendarProps<T>) => {
	const now = today(getLocalTimeZone())

	return (
		<CalendarPrimitive data-slot="calendar" {...props}>
			<CalendarHeader />
			<CalendarGrid>
				<CalendarGridHeader />
				<CalendarGridBody>
					{(date) => (
						<CalendarCell
							date={date}
							className={composeRenderProps(
								className,
								(className, { isSelected, isDisabled }) =>
									calendarCellClassName(
										{ isSelected, isDisabled, isToday: date.compare(now) === 0 },
										className,
									),
							)}
						/>
					)}
				</CalendarGridBody>
			</CalendarGrid>
		</CalendarPrimitive>
	)
}

const CalendarHeader = ({
	isRange,
	className,
	...props
}: React.ComponentProps<"header"> & { isRange?: boolean }) => {
	const { direction } = useLocale()
	return (
		<header data-slot="calendar-header" className={calendarHeaderClassName(className)} {...props}>
			<div className="flex items-center gap-1.5">
				<SelectMonth />
				<SelectYear />
			</div>
			<Heading className="sr-only" />
			<div className="flex items-center gap-1">
				<Button
					size="sq-sm"
					className={calendarNavButtonClassName}
					isCircle
					intent="plain"
					slot="previous"
				>
					{direction === "rtl" ? <ChevronRightIcon /> : <ChevronLeftIcon />}
				</Button>
				<Button
					size="sq-sm"
					className={calendarNavButtonClassName}
					isCircle
					intent="plain"
					slot="next"
				>
					{direction === "rtl" ? <ChevronLeftIcon /> : <ChevronRightIcon />}
				</Button>
			</div>
		</header>
	)
}

interface CalendarDropdown {
	id: number
	date: CalendarDate
	formatted: string
}

const SelectMonth = () => {
	const calendarState = use(CalendarStateContext)
	const rangeCalendarState = use(RangeCalendarStateContext)
	const state = calendarState || rangeCalendarState!
	const formatter = useDateFormatter({
		month: "short",
		timeZone: state.timeZone,
	})

	const months: CalendarDropdown[] = []
	const numMonths = state.focusedDate.calendar.getMonthsInYear(state.focusedDate)
	for (let i = 1; i <= numMonths; i++) {
		const date = state.focusedDate.set({ month: i })
		months.push({
			id: i,
			date,
			formatted: formatter.format(date.toDate(state.timeZone)),
		})
	}

	return (
		<Select
			className="[popover-width:8rem]"
			aria-label="Month"
			style={{ flex: 1, width: "fit-content" }}
			value={state.focusedDate.month}
			onChange={(key) => {
				if (typeof key === "number" && months[key - 1]) {
					state.setFocusedDate(months[key - 1]!.date)
				}
			}}
		>
			<SelectTrigger className={calendarMonthSelectTriggerClassName} />
			<SelectContent className="min-w-0" items={months}>
				{(item) => (
					<SelectItem>
						<SelectLabel>{item.formatted}</SelectLabel>
					</SelectItem>
				)}
			</SelectContent>
		</Select>
	)
}

const SelectYear = () => {
	const calendarState = use(CalendarStateContext)
	const rangeCalendarState = use(RangeCalendarStateContext)
	const state = calendarState || rangeCalendarState!
	const formatter = useDateFormatter({
		year: "numeric",
		timeZone: state.timeZone,
	})

	const years: CalendarDropdown[] = []
	for (let i = -20; i <= 20; i++) {
		const date = state.focusedDate.add({ years: i })
		years.push({
			id: years.length,
			date,
			formatted: formatter.format(date.toDate(state.timeZone)),
		})
	}
	return (
		<Select
			aria-label="Year"
			value={20}
			onChange={(key) => {
				if (typeof key === "number" && years[key]) {
					state.setFocusedDate(years[key].date)
				}
			}}
		>
			<SelectTrigger className={calendarYearSelectTriggerClassName} />
			<SelectContent items={years}>
				{(item) => (
					<SelectItem>
						<SelectLabel>{item.formatted}</SelectLabel>
					</SelectItem>
				)}
			</SelectContent>
		</Select>
	)
}

const CalendarGridHeader = () => {
	return (
		<CalendarGridHeaderPrimitive>
			{(day) => <CalendarHeaderCell className={calendarHeaderCellClassName}>{day}</CalendarHeaderCell>}
		</CalendarGridHeaderPrimitive>
	)
}

export type { CalendarProps }
export { Calendar, SelectMonth, SelectYear, CalendarHeader, CalendarGridHeader }
