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
