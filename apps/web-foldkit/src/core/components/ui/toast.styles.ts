import { tv } from "tailwind-variants"

/**
 * The `@foldkit/ui` Toast stack. The kit pins the container bottom-right with inline styles; the
 * entry `<div>` carries the kit's Animation attributes (`data-closed`, `data-enter`, `data-leave`)
 * and, while swiped, `data-swipe` with an inline `translate`.
 */
export const toastEntryClassName = [
	"w-[356px] max-w-[calc(100vw-2rem)]",
	"transition-[opacity,translate] duration-200 ease-out data-leave:duration-150 data-leave:ease-in",
	"data-closed:translate-y-2 data-closed:opacity-0",
	"data-[swipe=settling]:duration-150 data-[swipe=end]:duration-200",
].join(" ")

/** A stack dropped from the top (a phone's) enters from above rather than below. */
export const toastEntryFromTopClassName = "mx-auto data-closed:-translate-y-2"

/**
 * The card inside an entry: the solid overlay surface for every kind, so the page never shows
 * through it; the kind speaks through its icon's color alone (calm, like the rest of the chrome).
 */
export const toastStyles = tv({
	slots: {
		card: [
			"relative flex w-full items-start gap-2.5 rounded-xl border border-fg/10 bg-overlay p-4 pr-9 text-overlay-fg text-sm shadow-lg",
		],
		icon: "mt-0.5 size-4 shrink-0",
		content: "flex min-w-0 flex-1 flex-col gap-0.5",
		title: "font-medium text-fg",
		description: "text-fg-3",
		action: [
			"shrink-0 self-center rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-fg shadow-control",
			"outline-hidden transition-[background-color,scale] duration-150 ease-out hover:bg-primary/90 active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-2 focus-visible:ring-offset-overlay",
		],
		close: [
			"absolute top-2 right-2 rounded-md p-1 text-fg-2 outline-hidden transition-colors",
			"hover:bg-wash-strong hover:text-fg focus-visible:text-fg focus-visible:ring-2 focus-visible:ring-ring/70",
		],
	},
	variants: {
		kind: {
			info: { icon: "text-info-subtle-fg" },
			success: { icon: "text-success-subtle-fg" },
			warning: { icon: "text-warning-subtle-fg" },
			error: { icon: "text-danger-subtle-fg" },
			loading: { icon: "animate-spin text-fg-2" },
		},
	},
})
