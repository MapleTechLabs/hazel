/** Each base is merged with `className`. */
export const dialogBase =
	"peer/dialog group/dialog relative flex max-h-[inherit] flex-col overflow-hidden outline-hidden [--gutter:--spacing(6)] sm:[--gutter:--spacing(8)]"

export const dialogHeaderBase = "relative space-y-1 p-(--gutter) pb-[calc(var(--gutter)---spacing(3))]"

export const dialogTitleBase =
	"text-balance font-semibold text-fg text-lg/6 tracking-[-0.011em] sm:text-base/6"

export const dialogDescriptionBase =
	"text-pretty text-base/6 text-muted-fg group-data-disabled:opacity-50 sm:text-sm/6"

export const dialogBodyBase = [
	"isolate flex min-h-0 flex-1 flex-col overflow-auto px-(--gutter) py-1",
	"**:data-[slot=dialog-footer]:px-0 **:data-[slot=dialog-footer]:pt-0",
] as const

export const dialogFooterBase =
	"isolate mt-auto flex flex-col-reverse justify-end gap-3 p-(--gutter) pt-[calc(var(--gutter)---spacing(2))] group-not-has-data-[slot=dialog-body]/dialog:pt-0 group-not-has-data-[slot=dialog-body]/popover:pt-0 sm:flex-row"

export const dialogCloseIconBase =
	"close absolute top-1 right-1 z-50 grid size-8 place-content-center rounded-lg text-fg-2 outline-hidden transition-colors duration-150 ease-out hover:bg-wash-strong hover:text-fg focus-visible:bg-wash-strong focus-visible:text-fg focus-visible:ring-2 focus-visible:ring-ring/70 sm:top-2 sm:right-2 sm:size-7 sm:rounded-md"
