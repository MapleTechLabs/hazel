import type { DateFieldProps, DateInputProps, DateValue } from "react-aria-components"

import {
	DateField as DateFieldPrimitive,
	DateInput as DateInputPrimitive,
	DateSegment,
} from "react-aria-components"
import { twJoin } from "tailwind-merge"
import { cx } from "~/lib/primitive"
import {
	dateFieldClassName,
	dateInputControlStyles,
	dateInputStyles,
	dateSegmentStyles,
} from "./date-field.styles"
import { fieldStyles } from "./field"

export function DateField<T extends DateValue>({ className, ...props }: DateFieldProps<T>) {
	return (
		<DateFieldPrimitive
			{...props}
			data-slot="control"
			className={cx(fieldStyles({ className: dateFieldClassName }), className)}
		/>
	)
}

export function DateInput({ className, ...props }: Omit<DateInputProps, "children">) {
	return (
		<span data-slot="control" className={dateInputControlStyles}>
			<DateInputPrimitive className={cx(...dateInputStyles, className)} {...props}>
				{(segment) => <DateSegment segment={segment} className={twJoin(...dateSegmentStyles)} />}
			</DateInputPrimitive>
		</span>
	)
}
