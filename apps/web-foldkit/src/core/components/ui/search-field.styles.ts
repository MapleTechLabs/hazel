export const searchFieldStyles = {
	/** `fieldStyles({ className: field })` on the SearchField root. */
	field: "group/search-field",
	group: "[--input-gutter-end:--spacing(8)]",
	icon: "in-data-disabled:opacity-50",
	/** twJoin'd onto the clear button. */
	clearButton: [
		"touch-target grid place-content-center data-pressed:text-fg text-muted-fg hover:text-fg group-empty/search-field:invisible",
		"px-3 py-2 sm:px-2.5 sm:py-1.5 sm:text-sm/5",
	],
	clearIcon: "size-5 sm:size-4",
}
