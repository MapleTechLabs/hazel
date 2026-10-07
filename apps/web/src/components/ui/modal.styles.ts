import { twJoin } from "tailwind-merge"

/** Shared by the React and Foldkit apps: keep this file framework-free. */
export const modalSizes = {
	"2xs": "sm:max-w-2xs",
	xs: "sm:max-w-xs",
	sm: "sm:max-w-sm",
	md: "sm:max-w-md",
	lg: "sm:max-w-lg",
	xl: "sm:max-w-xl",
	"2xl": "sm:max-w-2xl",
	"3xl": "sm:max-w-3xl",
	"4xl": "sm:max-w-4xl",
	"5xl": "sm:max-w-5xl",
	fullscreen: "",
}

export type ModalSize = keyof typeof modalSizes

export const modalOverlayClassName = (size: ModalSize, isBlurred: boolean) =>
	twJoin(
		"fixed inset-0 z-50 h-(--visual-viewport-height,100vh) bg-overlay-backdrop",
		"grid grid-rows-[1fr_auto] justify-items-center sm:grid-rows-[1fr_auto_3fr]",
		size === "fullscreen" ? "md:p-3" : "md:p-4",
		"entering:fade-in entering:animate-in entering:duration-300 entering:ease-out",
		"exiting:fade-out exiting:animate-out exiting:ease-in",
		isBlurred && "backdrop-blur-[1px]",
	)

/** The `cx` arguments of the modal panel, before the caller's `className`. */
export const modalContentBase = (size: ModalSize) =>
	[
		"row-start-2 w-full text-left align-middle",
		"[--visual-viewport-vertical-padding:16px]",
		size === "fullscreen"
			? "sm:rounded-md sm:[--visual-viewport-vertical-padding:16px]"
			: "sm:rounded-xl sm:[--visual-viewport-vertical-padding:32px]",
		"relative overflow-hidden bg-overlay text-overlay-fg",
		"rounded-t-2xl shadow-lg ring ring-fg/5 dark:ring-border",
		modalSizes[size],
		// Ensure scale animation originates from center for proper visual effect
		"origin-center",
		"entering:slide-in-from-bottom sm:entering:zoom-in-95 sm:entering:slide-in-from-bottom-0 entering:animate-in entering:duration-300 entering:ease-out",
		"exiting:slide-out-to-bottom sm:exiting:zoom-out-95 sm:exiting:slide-out-to-bottom-0 exiting:animate-out exiting:ease-in",
	] as const
