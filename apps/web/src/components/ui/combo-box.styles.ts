/** Shared by the React and Foldkit apps: keep this file framework-free. */
export const comboBoxPopoverBase = "min-w-(--trigger-width) scroll-py-1 overflow-y-auto overscroll-contain"

export const comboBoxListBoxBase =
	"grid max-h-96 w-full grid-cols-[auto_1fr] flex-col gap-y-1 p-1 outline-hidden *:[[role='group']+[role=group]]:mt-4 *:[[role='group']+[role=separator]]:mt-1"

export const comboBoxInputWrapperClassName =
	"relative isolate block has-[[data-slot=icon]:last-child]:[&_input]:pr-10"

export const comboBoxButtonClassName =
	"absolute top-0 right-0 grid h-full w-11 cursor-default place-content-center sm:w-9"

export const comboBoxChevronClassName = "-mr-1 size-5 text-muted-fg sm:size-4"
