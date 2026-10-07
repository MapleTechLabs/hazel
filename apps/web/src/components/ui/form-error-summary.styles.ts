import { tv } from "tailwind-variants"

/** Shared by the React and Foldkit apps: keep this file framework-free. */
export const formErrorSummaryStyles = tv({
	base: [
		"rounded-lg border p-4",
		"bg-danger-subtle/50 border-danger-subtle-fg/20",
		"text-danger-subtle-fg",
		"animate-[field-error-enter_0.2s_ease-out]",
	],
})

export const formErrorSummaryPartStyles = {
	title: "mb-2 font-medium text-sm",
	list: "list-inside list-disc space-y-1 text-sm",
	field: "font-medium",
} as const
