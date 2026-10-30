/** Composed with `cx(twJoin(textareaStyles), className)`. */
export const textareaStyles = [
	"field-sizing-content relative block min-h-16 w-full appearance-none rounded-lg px-[calc(--spacing(3.5)-1px)] py-[calc(--spacing(2.5)-1px)] sm:px-[calc(--spacing(3)-1px)] sm:py-[calc(--spacing(1.5)-1px)]",
	"text-base/6 text-fg placeholder:text-muted-fg sm:text-sm/6",
	"border border-transparent bg-field enabled:hover:bg-field-hover",
	"outline-hidden focus:border-ring/70 focus:ring-3 focus:ring-ring/20 focus:enabled:hover:border-ring/80",
	"data-invalid:border-danger-subtle-fg/70 focus:data-invalid:border-danger-subtle-fg/70 focus:data-invalid:ring-danger-subtle-fg/20 data-invalid:enabled:hover:border-danger-subtle-fg/80 data-invalid:focus:enabled:hover:border-danger-subtle-fg/80",
	"data-disabled:bg-muted forced-colors:in-data-disabled:text-[GrayText]",
	"in-data-disabled:bg-muted forced-colors:in-data-disabled:text-[GrayText]",
	"dark:scheme-dark",
] satisfies string[]

/** Textarea's wrapper span. */
export const textareaControlStyles = "relative block w-full"
