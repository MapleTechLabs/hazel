import { twJoin } from "tailwind-merge"

/** Shared by the React and Foldkit apps: keep this file framework-free. */

/** DatePickerOverlay's PopoverContent className. */
export const datePickerOverlayClassName = (months: number | undefined) =>
	twJoin(
		"flex min-w-auto max-w-none snap-x justify-center p-4 sm:min-w-66 sm:p-2 sm:pt-3",
		months === 1 ? "sm:max-w-2xs" : "sm:max-w-none",
	)

/** DatePickerTrigger's calendar button. */
export const datePickerTriggerClassName = twJoin(
	"touch-target grid place-content-center outline-hidden",
	"pressed:text-fg text-muted-fg hover:text-fg focus-visible:text-fg",
	"px-[calc(--spacing(3.5)-1px)] py-[calc(--spacing(2.5)-1px)] sm:px-[calc(--spacing(3)-1px)] sm:py-[calc(--spacing(1.5)-1px)] sm:text-sm/6",
	"*:data-[slot=icon]:size-4.5 sm:*:data-[slot=icon]:size-4",
)

export const datePickerGroupClassName = "*:data-[slot=control]:w-full"
