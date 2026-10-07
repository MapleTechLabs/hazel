import { twJoin } from "tailwind-merge"

/** Shared by the React and Foldkit apps: keep this file framework-free. */
export const commandMenuSizes = {
	xs: "sm:max-w-xs",
	sm: "sm:max-w-sm",
	md: "sm:max-w-md",
	lg: "sm:max-w-lg",
	xl: "sm:max-w-xl",
	"2xl": "sm:max-w-2xl",
	"3xl": "sm:max-w-3xl",
}

export type CommandMenuSize = keyof typeof commandMenuSizes

export const commandMenuOverlayClassName = (isBlurred: boolean) =>
	twJoin(
		"fixed inset-0 z-50 h-(--visual-viewport-height,100vh) w-screen overflow-hidden bg-overlay-backdrop",
		"grid grid-rows-[1fr_auto] justify-items-center text-center sm:grid-rows-[1fr_auto_3fr]",
		"entering:fade-in entering:animate-in entering:duration-300 entering:ease-out",
		"exiting:fade-out exiting:animate-out exiting:ease-in",
		isBlurred && "backdrop-blur-sm backdrop-filter",
	)

/** The `cx` arguments of the Modal, before the caller's `className`. */
export const commandMenuModalBase = (size: CommandMenuSize) =>
	[
		"row-start-2 bg-overlay text-left text-overlay-fg shadow-lg outline-none ring ring-muted-fg/15 md:row-start-1 dark:ring-border",
		"max-h-[calc(var(--visual-viewport-height)*0.8)] w-full sm:fixed sm:top-[10%] sm:left-1/2 sm:-translate-x-1/2",
		"rounded-t-2xl md:rounded-xl",
		commandMenuSizes[size],
		"entering:slide-in-from-bottom sm:entering:zoom-in-95 sm:entering:slide-in-from-bottom-0 entering:animate-in entering:duration-300 entering:ease-out",
		"exiting:slide-out-to-bottom sm:exiting:zoom-out-95 sm:exiting:slide-out-to-bottom-0 exiting:animate-out exiting:ease-in",
	] as const

export const commandMenuDialogClassName = "flex max-h-[inherit] flex-col overflow-hidden outline-hidden"
export const commandMenuContentsClassName = "contents"
export const commandMenuSearchBase = "flex w-full items-center px-2.5 py-1"
export const commandMenuLoaderClassName = "size-4.5"
export const commandMenuSearchIconClassName = "size-5 shrink-0 text-muted-fg"
export const commandMenuInputClassName =
	"w-full min-w-0 bg-transparent px-2.5 py-2 text-base text-fg placeholder-muted-fg outline-hidden focus:outline-hidden sm:px-2 sm:py-1.5 sm:text-sm [&::-ms-reveal]:hidden [&::-webkit-search-cancel-button]:hidden"
export const commandMenuEscapeClassName =
	"hidden cursor-default rounded border text-current/90 hover:bg-muted lg:inline lg:px-1.5 lg:py-0.5 lg:text-xs"
export const commandMenuListBase =
	"grid max-h-full flex-1 grid-cols-[auto_1fr] content-start overflow-y-auto border-t p-2 sm:max-h-110 *:[[role=group]]:mb-6 *:[[role=group]]:last:mb-0"
export const commandMenuSectionBase =
	"col-span-full grid grid-cols-[auto_1fr] content-start gap-y-[calc(var(--spacing)*0.25)]"
export const commandMenuSectionHeaderClassName =
	"col-span-full mb-1 block min-w-(--trigger-width) truncate px-2.5 text-muted-fg text-xs"
export const commandMenuItemBase = "items-center gap-y-0.5"
export const commandMenuDescriptionBase = "col-start-3 row-start-1 ml-auto"
export const commandMenuEmptyClassName = "col-span-full p-4 text-center text-muted-fg text-sm"
export const commandMenuSeparatorBase = "-mx-2"
export const commandMenuFooterBase = [
	"col-span-full flex-none border-t px-2 py-1.5 text-muted-fg text-sm",
	"*:[kbd]:inset-ring *:[kbd]:inset-ring-fg/10 *:[kbd]:mx-1 *:[kbd]:inline-grid *:[kbd]:h-4 *:[kbd]:min-w-4 *:[kbd]:place-content-center *:[kbd]:rounded-xs *:[kbd]:bg-secondary",
] as const
export const commandMenuShortcutBase =
	"gap-0.5 font-sans text-[10.5px] uppercase *:inset-ring *:inset-ring-muted-fg/20 *:grid *:size-5.5 *:place-content-center *:rounded-xs *:bg-bg"
