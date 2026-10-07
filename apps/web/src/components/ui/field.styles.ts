import { tv } from "tailwind-variants"

/** Shared by the React and Foldkit apps: keep this file framework-free. */
export const labelStyles = tv({
	base: "select-none text-base/6 text-fg in-disabled:opacity-50 group-disabled:opacity-50 sm:text-sm/6",
})

export const descriptionStyles = tv({
	base: "block text-muted-fg text-sm/6 in-disabled:opacity-50 group-disabled:opacity-50",
})

export const fieldErrorStyles = tv({
	base: [
		"block text-danger-subtle-fg text-sm/6",
		"in-disabled:opacity-50 group-disabled:opacity-50 forced-colors:text-[Mark]",
		"animate-[field-error-enter_0.2s_ease-out]",
	],
})

export const fieldStyles = tv({
	base: [
		"w-full",
		"[&>[data-slot=label]+[data-slot=control]]:mt-2",
		"[&>[data-slot=label]+[slot='description']]:mt-1",
		"[&>[slot='description']+[data-slot=control]]:mt-2",
		"[&>[data-slot=control]+[slot=description]]:mt-2",
		"[&>[data-slot=control]+[slot=errorMessage]]:mt-2",
		"*:data-[slot=label]:font-medium",
	],
})

/** FieldErrors: `twMerge(fieldErrorStyles(), list, className)`, one `item` per error with a `bullet`. */
export const fieldErrorsStyles = {
	list: "m-0 list-none space-y-1 p-0",
	item: "flex items-start gap-1.5",
	bullet: "mt-1.5 size-1 shrink-0 rounded-full bg-danger-subtle-fg",
} as const

export const fieldsetStyles = "*:data-[slot=text]:mt-1 [&>*+[data-slot=control]]:mt-6"

export const legendStyles = "font-semibold text-base/6 data-disabled:opacity-50"
