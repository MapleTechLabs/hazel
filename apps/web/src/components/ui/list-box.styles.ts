import { twJoin, twMerge } from "tailwind-merge"

/** Shared by the React and Foldkit apps: keep this file framework-free. */

export const listBoxBase =
	"grid max-h-96 w-full min-w-56 scroll-py-1 grid-cols-[auto_1fr] flex-col gap-y-1 overflow-y-auto overscroll-contain rounded-xl border bg-bg p-1 outline-hidden [scrollbar-width:thin] has-data-[slot=drag-icon]:grid-cols-[auto_auto_1fr] [&::-webkit-scrollbar]:size-0.5 *:[[role='group']+[role=group]]:mt-4 *:[[role='group']+[role=separator]]:mt-1"

/** The `className` ListBoxItem hands to `dropdownItemStyles`. */
export const listBoxItemClassName = (hasHref: boolean, className?: string) =>
	twJoin(
		"group not-has-[[slot=description]]:items-start",
		"has-data-[slot=drag-icon]:*:[[slot=label]]:col-start-3",
		"has-data-[slot=drag-icon]:*:data-[slot=icon]:col-start-2",
		hasHref ? "cursor-pointer" : "cursor-default",
		className,
	)

export const listBoxCheckIconClassName =
	"-mx-0.5 mr-2 h-[1lh] w-5 shrink-0 group-allows-dragging:col-start-2 sm:w-4"

export const listBoxSectionClassName = (className?: string) =>
	twMerge("gap-y-1 *:data-[slot=list-box-item]:last:-mb-1.5", className)
