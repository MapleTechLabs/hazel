/** Shared by the React and Foldkit apps: keep this file framework-free. Each base is merged with `className`. */
export const dialogBase =
	"peer/dialog group/dialog relative flex max-h-[inherit] flex-col overflow-hidden outline-hidden [--gutter:--spacing(6)] sm:[--gutter:--spacing(8)]"

export const dialogTriggerBase = "cursor-pointer"

export const dialogHeaderBase = "relative space-y-1 p-(--gutter) pb-[calc(var(--gutter)---spacing(3))]"

export const dialogTitleBase = "text-balance font-semibold text-fg text-lg/6 sm:text-base/6"

export const dialogDescriptionBase =
	"text-pretty text-base/6 text-muted-fg group-disabled:opacity-50 sm:text-sm/6"

export const dialogBodyBase = [
	"isolate flex max-h-[calc(var(--visual-viewport-height)-var(--visual-viewport-vertical-padding)-var(--dialog-header-height,0px)-var(--dialog-footer-height,0px))] flex-1 flex-col overflow-auto px-(--gutter) py-1",
	"**:data-[slot=dialog-footer]:px-0 **:data-[slot=dialog-footer]:pt-0",
] as const

export const dialogFooterBase =
	"isolate mt-auto flex flex-col-reverse justify-end gap-3 p-(--gutter) pt-[calc(var(--gutter)---spacing(2))] group-not-has-data-[slot=dialog-body]/dialog:pt-0 group-not-has-data-[slot=dialog-body]/popover:pt-0 sm:flex-row"

export const dialogCloseIconBase =
	"close absolute top-1 right-1 z-50 grid size-8 place-content-center rounded-xl hover:bg-secondary focus:bg-secondary focus:outline-hidden focus-visible:ring-1 focus-visible:ring-primary sm:top-2 sm:right-2 sm:size-7 sm:rounded-md"
