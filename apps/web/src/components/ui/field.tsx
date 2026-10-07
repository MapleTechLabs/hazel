"use client"

import type { FieldErrorProps, LabelProps, TextProps } from "react-aria-components"
import { FieldError as FieldErrorPrimitive, Label as LabelPrimitive, Text } from "react-aria-components"
import { twMerge } from "tailwind-merge"
import { cx } from "~/lib/primitive"

export { descriptionStyles, fieldErrorStyles, fieldStyles, labelStyles } from "./field.styles"
import { descriptionStyles, fieldErrorStyles, labelStyles } from "./field.styles"

const Label = ({ className, ...props }: LabelProps) => {
	return <LabelPrimitive data-slot="label" {...props} className={labelStyles({ className })} />
}

const Description = ({ className, ...props }: TextProps) => {
	return <Text {...props} slot="description" className={descriptionStyles({ className })} />
}

const FieldError = ({ className, ...props }: FieldErrorProps) => {
	return <FieldErrorPrimitive {...props} className={cx(fieldErrorStyles(), className)} />
}

/**
 * Props for FieldErrors component that displays multiple validation errors
 */
export interface FieldErrorsProps {
	/** Array of error objects with message property */
	errors: Array<{ message?: string }> | undefined
	/** Additional CSS classes */
	className?: string
}

/**
 * Displays multiple field validation errors as a list.
 * Use this instead of FieldError when you want to show all errors, not just the first one.
 *
 * @example
 * ```tsx
 * <FieldErrors errors={field.state.meta.isTouched ? field.state.meta.errors : undefined} />
 * ```
 */
const FieldErrors = ({ errors, className }: FieldErrorsProps) => {
	if (!errors?.length) return null

	return (
		<ul
			className={twMerge(fieldErrorStyles(), "m-0 list-none space-y-1 p-0", className)}
			role="alert"
			aria-live="polite"
		>
			{errors.map((error, index) => (
				<li key={index} className="flex items-start gap-1.5">
					<span
						className="mt-1.5 size-1 shrink-0 rounded-full bg-danger-subtle-fg"
						aria-hidden="true"
					/>
					<span>{error.message}</span>
				</li>
			))}
		</ul>
	)
}

const Fieldset = ({ className, ...props }: React.ComponentProps<"fieldset">) => {
	return (
		<fieldset
			className={twMerge("*:data-[slot=text]:mt-1 [&>*+[data-slot=control]]:mt-6", className)}
			{...props}
		/>
	)
}

const Legend = ({ className, ...props }: React.ComponentProps<"legend">) => {
	return (
		<legend
			data-slot="legend"
			{...props}
			className={twMerge("font-semibold text-base/6 data-disabled:opacity-50", className)}
		/>
	)
}

export { Description, FieldError, FieldErrors, Fieldset, Legend, Label }
