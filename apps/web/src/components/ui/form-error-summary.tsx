"use client"

import { twMerge } from "tailwind-merge"
import { formErrorSummaryPartStyles, formErrorSummaryStyles } from "./form-error-summary.styles"

export interface FormError {
	/** Field name or label */
	field: string
	/** Error message */
	message: string
}

export interface FormErrorSummaryProps {
	/** Array of form errors to display */
	errors: FormError[]
	/** Optional title for the error summary */
	title?: string
	/** Additional CSS classes */
	className?: string
}

/**
 * Displays a summary of all form errors at the top of a form.
 * Useful for complex forms where users need to see all errors at a glance.
 *
 * @example
 * ```tsx
 * <form.Subscribe selector={(state) => state.errors}>
 *   {(errors) => (
 *     <FormErrorSummary
 *       errors={Object.entries(errors).map(([field, msgs]) => ({
 *         field,
 *         message: msgs[0]?.message ?? "Invalid"
 *       }))}
 *     />
 *   )}
 * </form.Subscribe>
 * ```
 */
export function FormErrorSummary({
	errors,
	title = "Please fix the following errors:",
	className,
}: FormErrorSummaryProps) {
	if (!errors.length) return null

	return (
		<div className={twMerge(formErrorSummaryStyles(), className)} role="alert" aria-live="polite">
			<p className={formErrorSummaryPartStyles.title}>{title}</p>
			<ul className={formErrorSummaryPartStyles.list}>
				{errors.map((error, index) => (
					<li key={index}>
						<span className={formErrorSummaryPartStyles.field}>{error.field}:</span>{" "}
						{error.message}
					</li>
				))}
			</ul>
		</div>
	)
}
