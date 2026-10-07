"use client"

import { twMerge } from "tailwind-merge"

import IconCheck from "~/components/icons/icon-check"
import { IconLoader } from "~/components/icons/icon-loader"
import { validationStateIconStyles, validationStateStyles } from "./field-validation-state.styles"

export type ValidationState = "idle" | "validating" | "valid" | "invalid"

export interface FieldValidationStateProps {
	/** Current validation state */
	state: ValidationState
	/** Additional CSS classes */
	className?: string
}

/**
 * Visual indicator for field validation state.
 * Shows a loader when validating, checkmark when valid, or X when invalid.
 *
 * @example
 * ```tsx
 * <div className="relative">
 *   <Input ... />
 *   <FieldValidationState
 *     state={field.state.meta.isValidating ? "validating" :
 *            field.state.meta.isTouched && !field.state.meta.errors?.length ? "valid" :
 *            field.state.meta.errors?.length ? "invalid" : "idle"}
 *   />
 * </div>
 * ```
 */
export function FieldValidationState({ state, className }: FieldValidationStateProps) {
	if (state === "idle") return null

	return (
		<span className={twMerge(validationStateStyles({ state }), className)} aria-hidden="true">
			{state === "validating" && (
				<IconLoader className={validationStateIconStyles} title="Validating..." />
			)}
			{state === "valid" && <IconCheck className={validationStateIconStyles} title="Valid" />}
			{state === "invalid" && <InvalidIcon className={validationStateIconStyles} />}
		</span>
	)
}

/**
 * Simple X icon for invalid state
 */
function InvalidIcon({ className }: { className?: string }) {
	return (
		<svg
			className={className}
			viewBox="0 0 12 12"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			aria-hidden="true"
		>
			<path
				d="M2.25 9.75L9.75 2.25M9.75 9.75L2.25 2.25"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	)
}

/**
 * Helper hook to compute validation state from TanStack Form field meta
 */
export function getValidationState(meta: {
	isValidating?: boolean
	isTouched?: boolean
	errors?: unknown[] | undefined
}): ValidationState {
	if (meta.isValidating) return "validating"
	if (meta.isTouched) {
		return meta.errors?.length ? "invalid" : "valid"
	}
	return "idle"
}
