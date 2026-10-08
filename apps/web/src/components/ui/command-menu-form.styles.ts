/** Shared by the React and Foldkit apps: keep this file framework-free. Each base is merged with `className`. */
export const commandMenuFormContainerBase = "flex h-full flex-col overflow-hidden"
export const commandMenuFormHeaderBase = "flex items-center gap-2 border-b px-3 py-2.5 sm:px-2.5 sm:py-2"
export const commandMenuFormBackClassName =
	"flex size-6 cursor-default items-center justify-center rounded text-muted-fg transition-colors hover:bg-muted hover:text-fg"
export const commandMenuFormBackIconClassName = "size-4"
export const commandMenuFormTitlesClassName = "min-w-0 flex-1"
export const commandMenuFormTitleClassName = "truncate font-semibold text-fg text-sm"
export const commandMenuFormSubtitleClassName = "truncate text-muted-fg text-xs"
export const commandMenuFormEscapeClassName =
	"hidden cursor-default rounded border px-1.5 py-0.5 text-muted-fg text-xs hover:bg-muted lg:inline"
export const commandMenuFormBodyBase = "flex-1 overflow-y-auto p-3 sm:p-2.5"
export const commandMenuFormFooterBase = [
	"flex items-center justify-between gap-2 border-t px-3 py-2 sm:px-2.5 sm:py-1.5",
	"text-muted-fg text-xs",
	"*:[kbd]:inset-ring *:[kbd]:inset-ring-fg/10 *:[kbd]:mx-0.5 *:[kbd]:inline-grid *:[kbd]:h-4 *:[kbd]:min-w-4 *:[kbd]:place-content-center *:[kbd]:rounded-xs *:[kbd]:bg-secondary *:[kbd]:px-1",
] as const
export const commandMenuFormFieldBase = "space-y-1.5"
export const commandMenuFormLabelClassName = "block font-medium text-fg text-xs"
export const commandMenuFormErrorClassName = "text-danger-subtle-fg text-xs"
export const commandMenuInputWrapperClassName = "relative"
export const commandMenuInputIconClassName =
	"pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-fg"

/** The `cx` arguments of CommandMenuInput, before the caller's `className`. */
export const commandMenuInputBase = (hasIcon: boolean) =>
	[
		"w-full rounded-md border border-input bg-transparent px-2.5 py-1.5 text-fg text-sm placeholder:text-muted-fg",
		"outline-none focus:border-ring focus:ring-2 focus:ring-ring/20",
		hasIcon && "pl-8",
	] as const

export const commandMenuToggleBase = "flex gap-2"

export const commandMenuToggleOptionClassName = (isSelected: boolean) => {
	const baseClasses =
		"flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors"
	const stateClasses = isSelected
		? "border-primary bg-primary/10 text-primary"
		: "border-border bg-transparent text-muted-fg hover:bg-muted hover:text-fg"
	return `${baseClasses} ${stateClasses}`
}
